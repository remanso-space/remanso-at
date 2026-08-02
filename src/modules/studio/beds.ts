// The procedural ambient bed engine (slice 6). A seeded, position-addressable pure
// function: `render(bed, seed, startSample, count, out)` fills `out` with the bed's
// samples for the window [startSample, startSample + count). The value at any absolute
// sample index is a deterministic function of (bed, seed, index) alone — a window taken
// from the middle of the stream is bit-identical to the same slice of a full render.
//
// That property is why this is written as a function of index and not a Web Audio node
// graph. A graph driven by Math.random() LFOs is neither seedable nor windowable: you
// cannot ask it for "the 30 seconds starting at 4:10" and get the same audio twice, and
// once the renderer windows the timeline you would have to write the whole thing again as
// plain samples. So it is written once, here, as samples.
//
// How position-addressability is achieved without carrying state between calls: the white
// noise source is stateless (a hash of seed and absolute index), and every stateful part
// of a recipe — the pink/brown integrators, the biquad filters, the wind cutoff walk — is
// replayed forward from index 0 on each call. Replaying from the origin is O(startSample +
// count), which is exactly right for the renderer, where each bed clip is rendered once in
// a single forward pass (startSample = the clip's inSec). The windowed-equality spec pins
// the guarantee directly, the same shape as renderChain.spec.ts.
//
// Filtered-noise families only. There is no fireplace and there are no birds — those need
// event scheduling and sample libraries, and the whole point of a procedural bed is that
// it carries no licence. See the plan's ambient recipes.

import type { BedId } from "./edl.types"

const SR = 48_000

// A stateless white sample in [-1, 1] for one absolute index. Two integer hashes
// (splitmix-style) of the seed mixed with the index — cheap, and decorrelated enough that
// the shaping filters see flat noise. Seed and index are folded together first so two
// beds with adjacent seeds do not share a stream.
const hash = (x: number): number => {
  let a = x | 0
  a = Math.imul(a ^ (a >>> 16), 0x45d9f3b)
  a = Math.imul(a ^ (a >>> 16), 0x45d9f3b)
  return (a ^ (a >>> 16)) >>> 0
}

const whiteAt = (seed: number, n: number): number => {
  const mixed = (Math.imul(seed | 0, 0x9e3779b1) ^ n) | 0
  return hash(mixed) / 0x7fffffff - 1
}

interface Biquad {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

interface BiquadState {
  x1: number
  x2: number
  y1: number
  y2: number
}

const freshState = (): BiquadState => ({ x1: 0, x2: 0, y1: 0, y2: 0 })

const step = (f: Biquad, s: BiquadState, x: number): number => {
  const y = f.b0 * x + f.b1 * s.x1 + f.b2 * s.x2 - f.a1 * s.y1 - f.a2 * s.y2
  s.x2 = s.x1
  s.x1 = x
  s.y2 = s.y1
  s.y1 = y
  return y
}

// RBJ biquads — the same forms renderChain and loudness use, so nothing about the DSP is
// novel; only the noise driving them is.
const lowpass = (f0: number, sr: number, q = Math.SQRT1_2): Biquad => {
  const w0 = (2 * Math.PI * f0) / sr
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  const a0 = 1 + alpha
  return {
    b0: (1 - cos) / 2 / a0,
    b1: (1 - cos) / a0,
    b2: (1 - cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  }
}

const highpass = (f0: number, sr: number, q = Math.SQRT1_2): Biquad => {
  const w0 = (2 * Math.PI * f0) / sr
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  const a0 = 1 + alpha
  return {
    b0: (1 + cos) / 2 / a0,
    b1: -(1 + cos) / a0,
    b2: (1 + cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  }
}

const bandpass = (f0: number, sr: number, q = 1): Biquad => {
  const w0 = (2 * Math.PI * f0) / sr
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  const a0 = 1 + alpha
  return {
    b0: alpha / a0,
    b1: 0,
    b2: -alpha / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  }
}

// A slow sine LFO in [0, 1], stateless in the absolute index — the modulation is itself
// position-addressable, so nothing about it needs replaying.
const lfo01 = (hz: number, n: number, sr: number, phase = 0): number =>
  (Math.sin((2 * Math.PI * hz * n) / sr + phase) + 1) / 2

// Coefficients are recomputed only at block boundaries aligned to the absolute index, so
// a windowed render hits the same boundaries as a whole render and the two stay identical.
// 128 samples is ~2.7 ms at 48 kHz — far faster than any bed's modulation.
const MOD_BLOCK = 128

// A pink-noise stepper (Paul Kellet's economy filter). Stateful, replayed from 0.
const pinkStepper = () => {
  let b0 = 0
  let b1 = 0
  let b2 = 0
  let b3 = 0
  let b4 = 0
  let b5 = 0
  let b6 = 0
  return (white: number): number => {
    b0 = 0.99886 * b0 + white * 0.0555179
    b1 = 0.99332 * b1 + white * 0.0750759
    b2 = 0.969 * b2 + white * 0.153852
    b3 = 0.8665 * b3 + white * 0.3104856
    b4 = 0.55 * b4 + white * 0.5329522
    b5 = -0.7616 * b5 - white * 0.016898
    const out = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11
    b6 = white * 0.115926
    return out
  }
}

// A brown-noise stepper: the leaky integrator from the plan, scaled back up to a usable
// level (brown is quiet). `b = (b + 0.02*white) / 1.02`.
const brownStepper = () => {
  let b = 0
  return (white: number): number => {
    b = (b + 0.02 * white) / 1.02
    return b * 3.5
  }
}

/** One bed's sample-at-index closure. Advanced in order from n = 0 on every render call. */
type Stepper = (n: number) => number

const makeStepper = (bed: BedId, seed: number, sr: number): Stepper => {
  switch (bed) {
    case "pink": {
      const pink = pinkStepper()
      return (n) => pink(whiteAt(seed, n)) * 0.7
    }

    case "brown": {
      const brown = brownStepper()
      return (n) => brown(whiteAt(seed, n)) * 0.7
    }

    case "roomTone": {
      // Pink, low-passed at 4 kHz, held at roughly -60 dBFS. A near-inaudible floor to
      // paper over the seams left where pauses were cut.
      const pink = pinkStepper()
      const lp = lowpass(4000, sr)
      const lpS = freshState()
      const level = Math.pow(10, -60 / 20)
      return (n) => step(lp, lpS, pink(whiteAt(seed, n))) * level * 8
    }

    case "rain": {
      // Pink → high-pass 500 Hz → low-pass swept 5–7 kHz by a 0.05 Hz LFO.
      const pink = pinkStepper()
      const hp = highpass(500, sr)
      const hpS = freshState()
      const lpS = freshState()
      let lp = lowpass(6000, sr)
      return (n) => {
        if (n % MOD_BLOCK === 0) lp = lowpass(5000 + 2000 * lfo01(0.05, n, sr), sr)
        return step(lp, lpS, step(hp, hpS, pink(whiteAt(seed, n)))) * 0.9
      }
    }

    case "river": {
      // Pink → band-pass 200–2000 Hz, centre driven by two LFOs at 0.03 and 0.07 Hz. The
      // frequency ratio is irrational, so the modulation never repeats.
      const pink = pinkStepper()
      const bpS = freshState()
      let bp = bandpass(1000, sr, 0.8)
      return (n) => {
        if (n % MOD_BLOCK === 0) {
          const c = 200 + 1800 * (0.5 * lfo01(0.03, n, sr) + 0.5 * lfo01(0.07, n, sr))
          bp = bandpass(c, sr, 0.8)
        }
        return step(bp, bpS, pink(whiteAt(seed, n))) * 1.4
      }
    }

    case "wind": {
      // Brown → resonant low-pass (Q 6) whose cutoff wanders 100–800 Hz on a slow bounded
      // random walk. The walk is replayed from 0 like every other stateful part, so it is
      // as position-addressable as the sines.
      const brown = brownStepper()
      const lpS = freshState()
      let cutoff = 400
      let lp = lowpass(cutoff, sr, 6)
      return (n) => {
        if (n % MOD_BLOCK === 0) {
          cutoff += whiteAt(seed ^ 0x5f, n) * 12
          if (cutoff < 100) cutoff = 100
          if (cutoff > 800) cutoff = 800
          lp = lowpass(cutoff, sr, 6)
        }
        return step(lp, lpS, brown(whiteAt(seed, n))) * 1.2
      }
    }

    case "surf": {
      // Brown → low-pass 1.5 kHz, amplitude swelling on a 0.09 Hz wave envelope so the
      // wash rises and falls like breaking water. Still filtered noise — no samples.
      const brown = brownStepper()
      const lp = lowpass(1500, sr)
      const lpS = freshState()
      return (n) => {
        const swell = 0.25 + 0.75 * Math.pow(lfo01(0.09, n, sr), 2)
        return step(lp, lpS, brown(whiteAt(seed, n))) * swell * 1.3
      }
    }
  }
}

/**
 * Fill `out` with `count` samples of the bed starting at absolute sample `startSample`.
 * `out.length` must be at least `count`. Pure: same (bed, seed, startSample, count) always
 * yields the same samples, and the window is a bit-exact slice of any wider render.
 */
export const renderBed = (
  bed: BedId,
  seed: number,
  startSample: number,
  count: number,
  out: Float32Array,
  sampleRate = SR,
): void => {
  const stepper = makeStepper(bed, seed, sampleRate)
  const end = startSample + count
  for (let n = 0; n < end; n += 1) {
    // A resonant filter can ring past full scale on an unlucky seed; a tanh softclip
    // bounds every bed to (-1, 1) while staying near-linear at the low levels a bed
    // actually plays at. Applied per index, so it does not disturb position-addressability.
    const s = Math.tanh(stepper(n))
    if (n >= startSample) out[n - startSample] = s
  }
}

/** Allocate-and-return convenience for callers that do not own a buffer. */
export const renderBedBuffer = (
  bed: BedId,
  seed: number,
  startSample: number,
  count: number,
  sampleRate = SR,
): Float32Array => {
  const out = new Float32Array(count)
  renderBed(bed, seed, startSample, count, out, sampleRate)
  return out
}

/** Every bed the engine knows how to render — for a picker in the cue UI. */
export const BED_IDS: BedId[] = ["rain", "river", "wind", "surf", "brown", "pink", "roomTone"]

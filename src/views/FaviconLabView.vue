<script setup lang="ts">
import { onMounted, ref, useTemplateRef } from "vue"

// Unlisted scratch page for picking a favicon. Clicking a candidate swaps the live
// <link rel="icon"> so the choice is judged where it will be seen — the browser tab.

type Stroke = { d: string; alpha: number }

type Candidate = {
  id: string
  title: string
  note: string
  /** Flower box in the 64×64 icon grid: [x, y, size]. */
  flower: [number, number, number]
  strokes: Stroke[]
  /** Draw the arcs over the flower rather than around it. */
  over?: boolean
}

const PINK = "#e36598"
const DEFAULT_FLOWER: [number, number, number] = [11.5, 11.5, 41]

const candidates: Candidate[] = [
  {
    id: "a-circles",
    title: "A — full circles",
    note: "Closed concentric rings. Pond read, but risks a record-button silhouette.",
    flower: DEFAULT_FLOWER,
    strokes: [
      { d: "M7 32 A25 25 0 1 1 57 32 A25 25 0 1 1 7 32", alpha: 0.55 },
      { d: "M1.5 32 A30.5 30.5 0 1 1 62.5 32 A30.5 30.5 0 1 1 1.5 32", alpha: 0.28 },
    ],
  },
  {
    id: "b-side",
    title: "B — side arcs",
    note: "Mirrored arcs left and right. Broadcast grammar, flower breathes.",
    flower: DEFAULT_FLOWER,
    strokes: [
      { d: "M53.7 19.5 A25 25 0 0 1 53.7 44.5", alpha: 0.6 },
      { d: "M10.3 19.5 A25 25 0 0 0 10.3 44.5", alpha: 0.6 },
      { d: "M58 17 A30 30 0 0 1 58 47", alpha: 0.3 },
      { d: "M6 17 A30 30 0 0 0 6 47", alpha: 0.3 },
    ],
  },
  {
    id: "c-below",
    title: "C — arcs below",
    note: "Water line under the flower. Quietest, but reads as a base.",
    flower: DEFAULT_FLOWER,
    strokes: [
      { d: "M13 47 A21 8 0 0 0 51 47", alpha: 0.6 },
      { d: "M5 52 A29 10 0 0 0 59 52", alpha: 0.3 },
    ],
  },
  {
    id: "c1-above",
    title: "C1 — arcs above, clear",
    note: "Arches off the bract tip. Flower drops and shrinks for headroom.",
    flower: [14, 21, 36],
    strokes: [
      { d: "M15 22 A19 7 0 0 1 49 22", alpha: 0.6 },
      { d: "M6 20 A28 10 0 0 1 58 20", alpha: 0.3 },
    ],
  },
  {
    id: "c2-over",
    title: "C2 — arcs over the flower",
    note: "Full-size flower, arcs cross the bracts. One object, low contrast.",
    flower: DEFAULT_FLOWER,
    over: true,
    strokes: [
      { d: "M13 26 A21 8 0 0 1 51 26", alpha: 0.75 },
      { d: "M5 24 A29 10 0 0 1 59 24", alpha: 0.4 },
    ],
  },
  {
    id: "c3-sandwich",
    title: "C3 — above and below",
    note: "Flower inside the ripple field. Open sides, but four strokes is a lot.",
    flower: [16.6, 16.6, 31],
    strokes: [
      { d: "M15 20 A19 7 0 0 1 49 20", alpha: 0.55 },
      { d: "M15 44 A19 7 0 0 0 49 44", alpha: 0.55 },
      { d: "M6 17 A28 10 0 0 1 58 17", alpha: 0.28 },
      { d: "M6 47 A28 10 0 0 0 58 47", alpha: 0.28 },
    ],
  },
]

const big = useTemplateRef<HTMLCanvasElement[]>("big")
const small = useTemplateRef<HTMLCanvasElement[]>("small")
const tiny = useTemplateRef<HTMLCanvasElement[]>("tiny")
const picked = ref("")

/**
 * Geometry is authored in a 64×64 grid and scaled, so the same numbers drive the 128px study
 * and the 32px favicon; only the stroke weight is re-tuned per size.
 */
function draw(canvas: HTMLCanvasElement, mark: HTMLImageElement, c: Candidate, px: number) {
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  canvas.width = px
  canvas.height = px
  ctx.clearRect(0, 0, px, px)
  ctx.scale(px / 64, px / 64)
  ctx.strokeStyle = PINK
  ctx.lineCap = "round"
  ctx.lineWidth = px >= 96 ? 2.4 : px >= 48 ? 3.4 : 4.4

  const paintFlower = () => ctx.drawImage(mark, c.flower[0], c.flower[1], c.flower[2], c.flower[2])
  const paintStrokes = () => {
    for (const s of c.strokes) {
      ctx.globalAlpha = s.alpha
      ctx.stroke(new Path2D(s.d))
    }
    ctx.globalAlpha = 1
  }

  if (c.over) {
    paintFlower()
    paintStrokes()
  } else {
    paintStrokes()
    paintFlower()
  }
}

function pick(index: number) {
  const canvas = small.value?.[index]
  if (!canvas) return
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (link) link.href = canvas.toDataURL("image/png")
  picked.value = candidates[index].id
}

onMounted(() => {
  const mark = new Image()
  mark.src = "/mark.png"
  mark.decode().then(() => {
    candidates.forEach((c, i) => {
      const b = big.value?.[i]
      const s = small.value?.[i]
      const t = tiny.value?.[i]
      if (b) draw(b, mark, c, 128)
      if (s) draw(s, mark, c, 32)
      if (t) draw(t, mark, c, 32)
    })
  })
})
</script>

<template>
  <section class="lab">
    <p class="hw-label eyebrow">§ — favicon lab</p>
    <h1 class="display">Which ripple?</h1>
    <p class="lede">
      Click a candidate to load it into this tab's favicon. Look up at the tab strip, not at this
      page — that is the only size that decides anything. Reload to get the shipped icon back.
    </p>

    <div class="grid">
      <button
        v-for="(c, i) in candidates"
        :key="c.id"
        type="button"
        class="cand"
        :class="{ picked: picked === c.id }"
        @click="pick(i)"
      >
        <div class="canvases">
          <canvas ref="big" class="big" width="128" height="128" />
          <canvas ref="small" class="small" width="32" height="32" />
          <canvas ref="tiny" class="tiny" width="32" height="32" />
        </div>
        <h2>{{ c.title }}</h2>
        <p>{{ c.note }}</p>
      </button>
    </div>
  </section>
</template>

<style scoped>
.lab {
  max-width: 68rem;
  margin: 0 auto;
  padding: 3rem 2rem 4rem;
}

.lede {
  max-width: 42rem;
  margin-bottom: 2.5rem;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
  gap: 1.5rem;
}

.cand {
  display: block;
  text-align: left;
  padding: 1.25rem;
  border: 1px solid var(--hw-rule);
  border-radius: 0.75rem;
  background: var(--hw-surface);
  cursor: pointer;
}

.cand:hover {
  border-color: var(--hw-pink);
}

.cand.picked {
  border-color: var(--hw-pink);
  box-shadow: 0 0 0 2px var(--hw-pink-wash-2);
}

.canvases {
  display: flex;
  align-items: flex-end;
  gap: 1rem;
  margin-bottom: 1rem;
}

.big {
  width: 128px;
  height: 128px;
}

.small {
  width: 32px;
  height: 32px;
}

.tiny {
  width: 16px;
  height: 16px;
}

.cand h2 {
  font-family: var(--hw-serif);
  font-size: 1.05rem;
  margin-bottom: 0.35rem;
}

.cand p {
  color: var(--hw-ink-soft);
  font-size: 0.9rem;
  line-height: 1.5;
}
</style>

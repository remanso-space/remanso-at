// Hand-written from lexicons/space/remanso/note.json. remanso.at does not render
// notes (that stays on remanso.space), but the studio lists your published notes
// to pick one to record against, so it reads these records.
//
// Corrects the drift the plan flagged: fontSize is `integer` in the lexicon, so
// it is typed `number` here — remanso.space's copy says `string`. theme,
// discoverable and language are added from the lexicon in the same pass.
export interface PublicNoteBlob {
  $type: string
  ref: { $link: string }
  mimeType: string
  size: number
}

export interface PublicNoteImage {
  image: PublicNoteBlob
  alt?: string
}

export interface PublicNote {
  $type: string
  title: string
  content: string
  language?: string
  images?: PublicNoteImage[]
  publishedAt?: string
  createdAt?: string
  fontFamily?: string
  fontSize?: number
  theme?: "light" | "dark"
  discoverable?: boolean
}

export interface PublicNoteRecord {
  uri: string
  cid: string
  value: PublicNote
}

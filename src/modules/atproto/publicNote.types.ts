// Hand-written from lexicons/space/remanso/note.json.
//
// `fontSize` is `integer` in the lexicon and typed `number` here; remanso.space's copy of
// these types says `string` and is the one that drifted.
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

const SELECTION_MAX_BYTES = 16 * 1024
const SELECTION_HEAD_BYTES = 12 * 1024
const SELECTION_TAIL_BYTES = 4 * 1024

/** UTF-8-byte bounded selection preserving useful context from both ends. */
export function truncateSelection(text: string): { text: string; truncated: boolean; originalBytes: number } {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(text)
  if (bytes.byteLength <= SELECTION_MAX_BYTES) return { text, truncated: false, originalBytes: bytes.byteLength }
  const decoder = new TextDecoder('utf-8', { fatal: false })
  const head = decoder.decode(bytes.slice(0, SELECTION_HEAD_BYTES)).replace(/\uFFFD$/u, '')
  const tail = decoder.decode(bytes.slice(bytes.byteLength - SELECTION_TAIL_BYTES)).replace(/^\uFFFD/u, '')
  return {
    text: `${head}\n\n… selection truncated …\n\n${tail}`,
    truncated: true,
    originalBytes: bytes.byteLength,
  }
}


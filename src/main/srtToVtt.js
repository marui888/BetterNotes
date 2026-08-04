export function convertSrtToVtt(srtText) {
  const normalized = String(srtText || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')

  const body = normalized
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
    .replace(/(^|\n)\s*\d+\s*\n(?=\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3})/g, '$1')
    .trim()

  return `WEBVTT\n\n${body}\n`
}

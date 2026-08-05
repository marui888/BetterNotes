export function getAutoPlaySkipReason(word) {
  const value = String(word || '').trim()
  if (/^\d+$/.test(value)) return 'number-only'
  if (/^list\s*\d+$/i.test(value)) return 'list-number'
  if (!/^[A-Za-z]+$/.test(value)) return 'non-alpha'
  return ''
}

export function isAutoPlayableWord(word) {
  return !getAutoPlaySkipReason(word)
}

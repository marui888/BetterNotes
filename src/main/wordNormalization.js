export const WORD_NORMALIZATION_VERSION = 1

export function normalizeWordV1(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
}

export function getDisplayWordV1(value) {
  return String(value ?? '').trim()
}

export function createCanonicalWordIdentity(value, language = 'en') {
  return {
    language: String(language || 'en').trim() || 'en',
    normalizationVersion: WORD_NORMALIZATION_VERSION,
    normalizedWord: normalizeWordV1(value),
  }
}

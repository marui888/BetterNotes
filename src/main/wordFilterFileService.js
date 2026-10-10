import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { WORD_NORMALIZATION_VERSION } from './wordNormalization'

export const WORD_FILTER_FILE_TYPE = 'better-notes.word-filter'
export const WORD_FILTER_FILE_VERSION = 1
export const WORD_FILTER_FILE_SUFFIX = '.bn-word-filter.json'

function normalizeNullableObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function validateConditions(conditions) {
  const source = normalizeNullableObject(conditions?.source)
  const file = normalizeNullableObject(conditions?.file)
  const tag = normalizeNullableObject(conditions?.tag)
  const word = normalizeNullableObject(conditions?.word)

  if (source && !String(source.folderPath || '').trim()) {
    return { ok: false, reason: 'word-filter-source-path-required' }
  }
  if (file && (!String(file.sourceFolderPath || '').trim() || !String(file.relativePath || '').trim())) {
    return { ok: false, reason: 'word-filter-file-reference-invalid' }
  }
  if (tag && !String(tag.name || '').trim()) {
    return { ok: false, reason: 'word-filter-tag-name-required' }
  }

  return {
    ok: true,
    conditions: {
      source: source ? { folderPath: String(source.folderPath).trim() } : null,
      file: file ? {
        sourceFolderPath: String(file.sourceFolderPath).trim(),
        relativePath: String(file.relativePath).trim(),
      } : null,
      tag: tag ? { name: String(tag.name).trim() } : null,
      word: word && String(word.value || '') ? {
        mode: 'contains',
        value: String(word.value),
        caseSensitive: false,
      } : null,
    },
  }
}

export function validateWordFilterDefinition(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'word-filter-root-invalid' }
  }
  if (value.type !== WORD_FILTER_FILE_TYPE) {
    return { ok: false, reason: 'word-filter-type-invalid' }
  }
  if (Number(value.version) !== WORD_FILTER_FILE_VERSION) {
    return { ok: false, reason: 'word-filter-version-unsupported' }
  }
  if (Number(value.normalizationVersion) !== WORD_NORMALIZATION_VERSION) {
    return { ok: false, reason: 'word-filter-normalization-version-unsupported' }
  }

  const validated = validateConditions(value.conditions)
  if (!validated.ok) return validated

  return {
    ok: true,
    definition: {
      type: WORD_FILTER_FILE_TYPE,
      version: WORD_FILTER_FILE_VERSION,
      filterId: String(value.filterId || '').trim() || randomUUID(),
      name: String(value.name || '').trim() || 'Word Filter',
      createdAt: String(value.createdAt || '').trim() || new Date().toISOString(),
      updatedAt: String(value.updatedAt || '').trim() || new Date().toISOString(),
      normalizationVersion: WORD_NORMALIZATION_VERSION,
      conditions: validated.conditions,
    },
  }
}

export async function readWordFilterFile(filePath) {
  const normalizedPath = path.resolve(String(filePath || ''))
  let parsed
  try {
    parsed = JSON.parse(await fs.readFile(normalizedPath, 'utf8'))
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof SyntaxError ? 'word-filter-json-invalid' : 'word-filter-read-failed',
      filePath: normalizedPath,
      error: error?.message || String(error),
    }
  }

  const result = validateWordFilterDefinition(parsed)
  return result.ok
    ? { ...result, filePath: normalizedPath, fileName: path.basename(normalizedPath) }
    : { ...result, filePath: normalizedPath, fileName: path.basename(normalizedPath) }
}

export async function saveWordFilterFile(filePath, conditions) {
  let normalizedPath = path.resolve(String(filePath || ''))
  if (!normalizedPath.toLowerCase().endsWith(WORD_FILTER_FILE_SUFFIX)) {
    normalizedPath = normalizedPath.toLowerCase().endsWith('.json')
      ? `${normalizedPath.slice(0, -5)}${WORD_FILTER_FILE_SUFFIX}`
      : `${normalizedPath}${WORD_FILTER_FILE_SUFFIX}`
  }

  const now = new Date().toISOString()
  let existing = null
  try {
    const candidate = JSON.parse(await fs.readFile(normalizedPath, 'utf8'))
    const validated = validateWordFilterDefinition(candidate)
    if (validated.ok) existing = validated.definition
  } catch {
    // A new file, or an unrelated existing file that will be replaced after Save confirmation.
  }

  const validatedConditions = validateConditions(conditions)
  if (!validatedConditions.ok) return validatedConditions
  const baseName = path.basename(normalizedPath, WORD_FILTER_FILE_SUFFIX)
  const definition = {
    type: WORD_FILTER_FILE_TYPE,
    version: WORD_FILTER_FILE_VERSION,
    filterId: existing?.filterId || randomUUID(),
    name: existing?.name || baseName || 'Word Filter',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    normalizationVersion: WORD_NORMALIZATION_VERSION,
    conditions: validatedConditions.conditions,
  }

  await fs.writeFile(normalizedPath, `${JSON.stringify(definition, null, 2)}\n`, 'utf8')
  return {
    ok: true,
    filePath: normalizedPath,
    fileName: path.basename(normalizedPath),
    definition,
  }
}

import fs from 'node:fs/promises'
import path from 'node:path'
import {
  createMixedFilterDefinition,
  validateMixedFilterDefinition,
} from './mixedNoteLibraryService'

export const MIXED_NOTE_FILTER_SUFFIX = '.bn-mixed-note-filter.json'

export async function readMixedNoteFilterFile(filePath) {
  const resolved = path.resolve(String(filePath || ''))
  try {
    const parsed = JSON.parse(await fs.readFile(resolved, 'utf8'))
    const result = validateMixedFilterDefinition(parsed)
    return { ...result, filePath: resolved, fileName: path.basename(resolved) }
  } catch (error) {
    return { ok: false, reason: error instanceof SyntaxError ? 'mixed-filter-json-invalid' : 'mixed-filter-read-failed',
      filePath: resolved, fileName: path.basename(resolved), error: error?.message || String(error) }
  }
}

export async function saveMixedNoteFilterFile(filePath, conditions) {
  let resolved = path.resolve(String(filePath || ''))
  if (!resolved.toLowerCase().endsWith(MIXED_NOTE_FILTER_SUFFIX)) {
    resolved = resolved.toLowerCase().endsWith('.json')
      ? `${resolved.slice(0, -5)}${MIXED_NOTE_FILTER_SUFFIX}` : `${resolved}${MIXED_NOTE_FILTER_SUFFIX}`
  }
  let existing = null
  try {
    const candidate = validateMixedFilterDefinition(JSON.parse(await fs.readFile(resolved, 'utf8')))
    if (candidate.ok) existing = candidate.definition
  } catch { /* new file */ }
  const definition = createMixedFilterDefinition(conditions, existing,
    path.basename(resolved, MIXED_NOTE_FILTER_SUFFIX) || 'Mixed Note Filter')
  await fs.writeFile(resolved, `${JSON.stringify(definition, null, 2)}\n`, 'utf8')
  return { ok: true, filePath: resolved, fileName: path.basename(resolved), definition }
}

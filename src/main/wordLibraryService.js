import fs from 'node:fs/promises'
import path from 'node:path'
import { listTxtFilesInFolder, readWordFile } from './wordFileService'
import { getDisplayWordV1, normalizeWordV1, WORD_NORMALIZATION_VERSION } from './wordNormalization'
import { useWordLibraryDatabase } from './wordLibraryDatabase'

const DEFAULT_LANGUAGE = 'en'
const activeScans = new Map()

function normalizeFolderPath(folderPath) {
  const value = typeof folderPath === 'string'
    ? folderPath.trim().replace(/^["']|["']$/g, '')
    : ''
  return value ? path.resolve(value) : ''
}

function createFolderPathKey(folderPath) {
  const normalizedPath = normalizeFolderPath(folderPath).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalizedPath.toLocaleLowerCase('en-US') : normalizedPath
}

function normalizeSourceRow(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    folderPath: row.folder_path,
    displayName: row.display_name,
    isEnabled: Boolean(row.is_enabled),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    lastScannedAt: row.last_scanned_at == null ? null : Number(row.last_scanned_at),
    lastScanStatus: row.last_scan_status || '',
    lastScanError: row.last_scan_error || '',
    fileCount: Number(row.file_count || 0),
    occurrenceCount: Number(row.occurrence_count || 0),
    wordCount: Number(row.word_count || 0),
  }
}

const SOURCE_SELECT_SQL = `
  SELECT
    s.*,
    COUNT(DISTINCT sf.id) AS file_count,
    COUNT(wo.id) AS occurrence_count,
    COUNT(DISTINCT wo.word_id) AS word_count
  FROM sources s
  LEFT JOIN source_files sf ON sf.source_id = s.id
  LEFT JOIN word_occurrences wo ON wo.source_file_id = sf.id
`

function getSourceRow(database, sourceId) {
  return database.prepare(`${SOURCE_SELECT_SQL} WHERE s.id = ? GROUP BY s.id`).get(sourceId)
}

export function listWordLibrarySources() {
  return useWordLibraryDatabase((database) => (
    database.prepare(`${SOURCE_SELECT_SQL} GROUP BY s.id ORDER BY s.is_enabled DESC, s.updated_at DESC, s.id DESC`)
      .all()
      .map(normalizeSourceRow)
  ))
}

export function getWordLibrarySource(sourceId) {
  const numericId = Number(sourceId)
  if (!Number.isInteger(numericId) || numericId <= 0) return null
  return useWordLibraryDatabase((database) => normalizeSourceRow(getSourceRow(database, numericId)))
}

export async function addWordLibrarySource(folderPath) {
  const normalizedPath = normalizeFolderPath(folderPath)
  if (!normalizedPath) {
    return { ok: false, reason: 'source-folder-not-set' }
  }

  let folderStat
  try {
    folderStat = await fs.stat(normalizedPath)
  } catch {
    return { ok: false, reason: 'source-folder-not-found', folderPath: normalizedPath }
  }
  if (!folderStat.isDirectory()) {
    return { ok: false, reason: 'source-folder-not-directory', folderPath: normalizedPath }
  }

  return useWordLibraryDatabase((database) => {
    const folderPathKey = createFolderPathKey(normalizedPath)
    const existing = database.prepare('SELECT id FROM sources WHERE folder_path_key = ?').get(folderPathKey)
    if (existing) {
      return {
        ok: true,
        alreadyExists: true,
        source: normalizeSourceRow(getSourceRow(database, existing.id)),
      }
    }

    const now = Date.now()
    const result = database.prepare(`
      INSERT INTO sources (
        folder_path, folder_path_key, display_name, is_enabled, created_at, updated_at,
        last_scan_status, last_scan_error
      ) VALUES (?, ?, ?, 0, ?, ?, 'not-scanned', '')
    `).run(normalizedPath, folderPathKey, path.basename(normalizedPath), now, now)

    return {
      ok: true,
      alreadyExists: false,
      source: normalizeSourceRow(getSourceRow(database, Number(result.lastInsertRowid))),
    }
  })
}

export function applyWordLibrarySourceSelection(enabledSourceIds) {
  const requestedIds = new Set(
    (Array.isArray(enabledSourceIds) ? enabledSourceIds : [])
      .map(toOptionalPositiveInteger)
      .filter(Boolean)
  )

  return useWordLibraryDatabase((database) => {
    const sourceRows = database.prepare('SELECT id FROM sources').all()
    const existingIds = new Set(sourceRows.map((row) => Number(row.id)))
    const enabledIds = [...requestedIds].filter((sourceId) => existingIds.has(sourceId))
    const enabledIdSet = new Set(enabledIds)
    const updateSource = database.prepare(`
      UPDATE sources SET is_enabled = ?, updated_at = ? WHERE id = ?
    `)
    const now = Date.now()

    database.exec('BEGIN IMMEDIATE')
    try {
      for (const row of sourceRows) {
        const sourceId = Number(row.id)
        updateSource.run(enabledIdSet.has(sourceId) ? 1 : 0, now, sourceId)
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }

    return {
      ok: true,
      enabledSourceIds: enabledIds,
      sources: listWordLibrarySources(),
    }
  })
}

export function deleteWordLibrarySource(sourceId) {
  const numericId = Number(sourceId)
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return { ok: false, reason: 'invalid-source-id' }
  }

  return useWordLibraryDatabase((database) => {
    database.exec('BEGIN IMMEDIATE')
    try {
      const source = normalizeSourceRow(getSourceRow(database, numericId))
      if (!source) {
        database.exec('ROLLBACK')
        return { ok: false, reason: 'source-not-found', sourceId: numericId }
      }

      database.prepare('DELETE FROM sources WHERE id = ?').run(numericId)
      deleteUnusedIndexRows(database)
      database.exec('COMMIT')
      return { ok: true, source }
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  })
}

function prepareIndexedFile(fileInfo, readResult, stat) {
  const warnings = []
  const records = []

  for (let index = 0; index < readResult.records.length; index += 1) {
    const record = readResult.records[index]
    const normalizedWord = normalizeWordV1(record.word)
    if (!normalizedWord) {
      warnings.push({
        type: 'empty-word',
        filePath: fileInfo.filePath,
        lineNumber: index + 1,
      })
      continue
    }

    records.push({
      lineNumber: index + 1,
      sourceWord: String(record.word ?? ''),
      displayWord: getDisplayWordV1(record.word),
      normalizedWord,
      markers: Array.from({ length: 5 }, (_, markerIndex) => String(record.markers?.[markerIndex] ?? '')),
      annotation: String(record.annotation ?? ''),
      rawLine: String(record.raw ?? ''),
    })
  }

  return {
    fileName: fileInfo.fileName,
    filePath: fileInfo.filePath,
    fileSize: Number(stat.size || 0),
    modifiedAtMs: Number(stat.mtimeMs || 0),
    encoding: readResult.encoding || '',
    records,
    warnings,
  }
}

async function readSourceFiles(source) {
  const files = await listTxtFilesInFolder(source.folderPath)
  const indexedFiles = []
  const failures = []
  const warnings = []

  for (const fileInfo of files) {
    try {
      const [readResult, stat] = await Promise.all([
        readWordFile(fileInfo.filePath, { includeTxtFiles: false }),
        fs.stat(fileInfo.filePath),
      ])
      if (!readResult?.ok) {
        failures.push({ filePath: fileInfo.filePath, reason: readResult?.reason || 'read-failed' })
        continue
      }
      const indexedFile = prepareIndexedFile(fileInfo, readResult, stat)
      indexedFiles.push(indexedFile)
      warnings.push(...indexedFile.warnings)
    } catch (error) {
      failures.push({ filePath: fileInfo.filePath, reason: error?.message || String(error) })
    }
  }

  return { indexedFiles, failures, warnings }
}

function createIndexStatements(database) {
  return {
    insertFile: database.prepare(`
      INSERT INTO source_files (
        source_id, relative_path, file_path, file_size, modified_at_ms, encoding, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    upsertWord: database.prepare(`
      INSERT INTO words (
        language, normalization_version, normalized_word, display_word, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(language, normalization_version, normalized_word)
      DO UPDATE SET updated_at = excluded.updated_at
    `),
    findWord: database.prepare(`
      SELECT id FROM words
      WHERE language = ? AND normalization_version = ? AND normalized_word = ?
    `),
    insertOccurrence: database.prepare(`
      INSERT INTO word_occurrences (
        source_file_id, word_id, line_number, source_word,
        marker_1, marker_2, marker_3, marker_4, marker_5, marker_6,
        annotation, raw_line, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
  }
}

function insertPreparedFile(statements, source, file, now) {
  const relativePath = path.relative(source.folderPath, file.filePath) || file.fileName
  const fileResult = statements.insertFile.run(
    source.id,
    relativePath,
    file.filePath,
    file.fileSize,
    file.modifiedAtMs,
    file.encoding,
    now
  )
  const sourceFileId = Number(fileResult.lastInsertRowid)
  let occurrenceCount = 0

  for (const record of file.records) {
    statements.upsertWord.run(
      DEFAULT_LANGUAGE,
      WORD_NORMALIZATION_VERSION,
      record.normalizedWord,
      record.displayWord,
      now,
      now
    )
    const wordId = Number(statements.findWord.get(
      DEFAULT_LANGUAGE,
      WORD_NORMALIZATION_VERSION,
      record.normalizedWord
    ).id)
    statements.insertOccurrence.run(
      sourceFileId,
      wordId,
      record.lineNumber,
      record.sourceWord,
      ...record.markers,
      '',
      record.annotation,
      record.rawLine,
      now,
      now
    )
    occurrenceCount += 1
  }

  return occurrenceCount
}

function deleteUnusedIndexRows(database) {
  const now = Date.now()
  const orphanWords = database.prepare(`
    SELECT id FROM words
    WHERE NOT EXISTS (SELECT 1 FROM word_occurrences wo WHERE wo.word_id = words.id)
  `).all()
  const orphanWordIds = orphanWords.map((row) => Number(row.id))
  if (orphanWordIds.length > 0) {
    const placeholders = orphanWordIds.map(() => '?').join(', ')
    const planItems = database.prepare(`
      SELECT id, plan_id FROM study_plan_items WHERE word_id IN (${placeholders})
    `).all(...orphanWordIds)
    const removedPlanItemIds = new Set(planItems.map((row) => Number(row.id)))

    if (removedPlanItemIds.size > 0) {
      const activeSessions = database.prepare(`
        SELECT id, session_json FROM study_sessions WHERE ended_at IS NULL
      `).all()
      const updateSession = database.prepare(`
        UPDATE study_sessions SET session_json = ?, ended_at = ? WHERE id = ?
      `)
      for (const session of activeSessions) {
        const state = parseStudySessionState(session.session_json)
        if (!state.isValid || !state.queueItemIds.some((id) => removedPlanItemIds.has(id))) continue
        const removedBeforeCurrent = state.queueItemIds
          .slice(0, state.currentIndex)
          .filter((id) => removedPlanItemIds.has(id)).length
        state.queueItemIds = state.queueItemIds.filter((id) => !removedPlanItemIds.has(id))
        state.currentIndex = Math.max(0, state.currentIndex - removedBeforeCurrent)
        const completed = state.currentIndex >= state.queueItemIds.length
        updateSession.run(JSON.stringify(state), completed ? now : null, session.id)
      }

      const affectedPlanIds = [...new Set(planItems.map((row) => Number(row.plan_id)))]
      const touchPlan = database.prepare('UPDATE study_plans SET updated_at = ? WHERE id = ?')
      affectedPlanIds.forEach((planId) => touchPlan.run(now, planId))
      database.prepare(`DELETE FROM study_plan_items WHERE word_id IN (${placeholders})`)
        .run(...orphanWordIds)
    }

    database.prepare(`DELETE FROM words WHERE id IN (${placeholders})`).run(...orphanWordIds)
  }
  database.prepare(`
    DELETE FROM tags
    WHERE NOT EXISTS (
      SELECT 1 FROM word_occurrence_tags wot WHERE wot.tag_id = tags.id
    )
  `).run()
}

function replaceSourceIndex(source, scanData) {
  return useWordLibraryDatabase((database) => {
    const now = Date.now()
    const statements = createIndexStatements(database)

    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare('DELETE FROM source_files WHERE source_id = ?').run(source.id)

      let occurrenceCount = 0
      for (const file of scanData.indexedFiles) {
        occurrenceCount += insertPreparedFile(statements, source, file, now)
      }

      deleteUnusedIndexRows(database)

      const scanStatus = scanData.failures.length > 0 ? 'partial' : 'ready'
      const scanError = scanData.failures.map((item) => `${item.filePath}: ${item.reason}`).join('\n')
      database.prepare(`
        UPDATE sources
        SET updated_at = ?, last_scanned_at = ?, last_scan_status = ?, last_scan_error = ?
        WHERE id = ?
      `).run(now, now, scanStatus, scanError, source.id)

      database.exec('COMMIT')
      return {
        ok: true,
        status: scanStatus,
        source: normalizeSourceRow(getSourceRow(database, source.id)),
        fileCount: scanData.indexedFiles.length,
        occurrenceCount,
        warningCount: scanData.warnings.length,
        failureCount: scanData.failures.length,
        warnings: scanData.warnings,
        failures: scanData.failures,
      }
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  })
}

async function performSourceScan(sourceId) {
  const source = getWordLibrarySource(sourceId)
  if (!source) return { ok: false, reason: 'source-not-found', sourceId: Number(sourceId) }

  try {
    const scanData = await readSourceFiles(source)
    return replaceSourceIndex(source, scanData)
  } catch (error) {
    useWordLibraryDatabase((database) => {
      database.prepare(`
        UPDATE sources
        SET updated_at = ?, last_scanned_at = ?, last_scan_status = 'failed', last_scan_error = ?
        WHERE id = ?
      `).run(Date.now(), Date.now(), error?.message || String(error), source.id)
    })
    throw error
  }
}

export function scanWordLibrarySource(sourceId) {
  const numericId = Number(sourceId)
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return Promise.resolve({ ok: false, reason: 'invalid-source-id' })
  }
  if (activeScans.has(numericId)) return activeScans.get(numericId)

  const scanPromise = performSourceScan(numericId)
    .finally(() => activeScans.delete(numericId))
  activeScans.set(numericId, scanPromise)
  return scanPromise
}

export async function reindexWordLibraryFile(filePath) {
  const normalizedPath = path.resolve(String(filePath || ''))
  if (!normalizedPath || path.extname(normalizedPath).toLowerCase() !== '.txt') {
    return { ok: false, reason: 'invalid-text-file' }
  }

  const sourceRows = useWordLibraryDatabase((database) => database.prepare(`
    SELECT id, folder_path, display_name
    FROM sources
    WHERE folder_path_key = ? AND is_enabled = 1
  `).all(createFolderPathKey(path.dirname(normalizedPath))))

  if (sourceRows.length === 0) {
    return { ok: true, indexed: false, reason: 'file-not-in-enabled-source' }
  }

  const fileInfo = { fileName: path.basename(normalizedPath), filePath: normalizedPath }
  const [readResult, stat] = await Promise.all([
    readWordFile(normalizedPath, { includeTxtFiles: false }),
    fs.stat(normalizedPath),
  ])
  if (!readResult?.ok) return readResult
  const indexedFile = prepareIndexedFile(fileInfo, readResult, stat)

  const result = useWordLibraryDatabase((database) => {
    const now = Date.now()
    const statements = createIndexStatements(database)
    database.exec('BEGIN IMMEDIATE')
    try {
      let occurrenceCount = 0
      for (const row of sourceRows) {
        const source = {
          id: Number(row.id),
          folderPath: row.folder_path,
          displayName: row.display_name,
        }
        const relativePath = path.relative(source.folderPath, normalizedPath) || fileInfo.fileName
        database.prepare(`
          DELETE FROM source_files WHERE source_id = ? AND relative_path = ?
        `).run(source.id, relativePath)
        occurrenceCount += insertPreparedFile(statements, source, indexedFile, now)
        database.prepare('UPDATE sources SET updated_at = ? WHERE id = ?').run(now, source.id)
      }
      deleteUnusedIndexRows(database)
      database.exec('COMMIT')
      return {
        ok: true,
        indexed: true,
        sourceCount: sourceRows.length,
        occurrenceCount,
        warningCount: indexedFile.warnings.length,
        warnings: indexedFile.warnings,
      }
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  })

  return result
}

function toOptionalPositiveInteger(value) {
  const numericValue = Number(value)
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : null
}

function escapeSqlLike(value) {
  return String(value ?? '').replace(/[\\%_]/g, '\\$&')
}

// Treat horizontal/vertical control whitespace as spaces before checking the
// source word. Repeated spaces do not change the formatted result, which is
// equivalent to collapsing each run to one space without mutating the source.
const WORD_OCCURRENCE_SPACED_SQL = `TRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
  wo.source_word, char(9), ' '), char(10), ' '), char(11), ' '), char(12), ' '), char(13), ' '))`
const WORD_OCCURRENCE_FORMATTED_SQL = `(
  ${WORD_OCCURRENCE_SPACED_SQL} <> ''
  AND SUBSTR(${WORD_OCCURRENCE_SPACED_SQL}, 1, 1) GLOB '[A-Za-z]'
  AND SUBSTR(${WORD_OCCURRENCE_SPACED_SQL}, -1, 1) GLOB '[A-Za-z]'
  AND ${WORD_OCCURRENCE_SPACED_SQL} NOT GLOB '*[^A-Za-z -]*'
)`
const WORD_GROUP_UNFORMATTED_SQL = `MAX(CASE WHEN ${WORD_OCCURRENCE_FORMATTED_SQL} THEN 0 ELSE 1 END)`

function buildLibraryFilterWhere(filters = {}, wordIds = [], options = {}) {
  const sourceId = toOptionalPositiveInteger(filters.sourceId)
  const fileId = toOptionalPositiveInteger(filters.fileId)
  const tagId = toOptionalPositiveInteger(filters.tagId)
  const word = normalizeWordV1(filters.word)
  const clauses = options.requireEnabled === false ? [] : ['s.is_enabled = 1']
  const parameters = []

  if (options.enforceSourceScope) {
    const sourceIds = Array.isArray(options.sourceIds)
      ? options.sourceIds.map(toOptionalPositiveInteger).filter(Boolean)
      : []
    if (sourceIds.length > 0) {
      clauses.push(`s.id IN (${sourceIds.map(() => '?').join(', ')})`)
      parameters.push(...sourceIds)
    } else {
      clauses.push('1 = 0')
    }
  }

  if (sourceId) {
    clauses.push('s.id = ?')
    parameters.push(sourceId)
  }
  if (fileId) {
    clauses.push('sf.id = ?')
    parameters.push(fileId)
  }
  if (tagId) {
    clauses.push(`EXISTS (
      SELECT 1
      FROM word_occurrence_tags filter_wot
      WHERE filter_wot.occurrence_id = wo.id AND filter_wot.tag_id = ?
    )`)
    parameters.push(tagId)
  }
  if (word) {
    clauses.push("w.normalized_word COLLATE NOCASE LIKE ? ESCAPE '\\'")
    parameters.push(`%${escapeSqlLike(word)}%`)
  }
  if (wordIds.length > 0) {
    clauses.push(`w.id IN (${wordIds.map(() => '?').join(', ')})`)
    parameters.push(...wordIds)
  }

  return { sql: clauses.length > 0 ? clauses.join('\n AND ') : '1 = 1', parameters }
}

function normalizeRelativePathKey(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\.\//, '')
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

function createStableWordFilterInDatabase(database, filters = {}) {
  const sourceId = toOptionalPositiveInteger(filters.sourceId)
  const fileId = toOptionalPositiveInteger(filters.fileId)
  const tagId = toOptionalPositiveInteger(filters.tagId)
  let source = null
  let file = null
  let tag = null

  if (sourceId) {
    source = database.prepare(`
      SELECT id, folder_path FROM sources WHERE id = ? AND is_enabled = 1
    `).get(sourceId)
    if (!source) return { ok: false, reason: 'word-filter-source-unresolved' }
  }
  if (fileId) {
    file = database.prepare(`
      SELECT sf.id, sf.relative_path, s.id AS source_id, s.folder_path
      FROM source_files sf
      JOIN sources s ON s.id = sf.source_id
      WHERE sf.id = ? AND s.is_enabled = 1
    `).get(fileId)
    if (!file || (source && Number(file.source_id) !== Number(source.id))) {
      return { ok: false, reason: 'word-filter-file-unresolved' }
    }
  }
  if (tagId) {
    tag = database.prepare('SELECT id, name FROM tags WHERE id = ?').get(tagId)
    if (!tag) return { ok: false, reason: 'word-filter-tag-unresolved' }
  }

  return {
    ok: true,
    conditions: {
      source: source ? { folderPath: source.folder_path } : null,
      file: file ? {
        sourceFolderPath: file.folder_path,
        relativePath: file.relative_path,
      } : null,
      tag: tag ? { name: tag.name } : null,
      word: String(filters.word || '') ? {
        mode: 'contains',
        value: String(filters.word),
        caseSensitive: false,
      } : null,
    },
  }
}

export function createStableWordFilter(filters = {}) {
  return useWordLibraryDatabase((database) => createStableWordFilterInDatabase(database, filters))
}

function resolveStableWordFilterInDatabase(database, definition, options = {}) {
  const conditions = definition?.conditions || {}
  const resolved = { sourceId: '', fileId: '', tagId: '', word: '' }
  const enabledSql = options.requireEnabled === false ? '' : ' AND is_enabled = 1'

  if (conditions.source) {
    const source = database.prepare(`
      SELECT id FROM sources WHERE folder_path_key = ?${enabledSql}
    `).get(createFolderPathKey(conditions.source.folderPath))
    if (!source) return { ok: false, reason: 'word-filter-source-unresolved' }
    resolved.sourceId = Number(source.id)
  }

  if (conditions.file) {
    const source = database.prepare(`
      SELECT id FROM sources WHERE folder_path_key = ?${enabledSql}
    `).get(createFolderPathKey(conditions.file.sourceFolderPath))
    if (!source) return { ok: false, reason: 'word-filter-file-source-unresolved' }
    const candidates = database.prepare(`
      SELECT id, relative_path FROM source_files WHERE source_id = ?
    `).all(source.id)
    const relativePathKey = normalizeRelativePathKey(conditions.file.relativePath)
    const file = candidates.find((row) => normalizeRelativePathKey(row.relative_path) === relativePathKey)
    if (!file) return { ok: false, reason: 'word-filter-file-unresolved' }
    if (resolved.sourceId && resolved.sourceId !== Number(source.id)) {
      return { ok: false, reason: 'word-filter-source-file-mismatch' }
    }
    resolved.fileId = Number(file.id)
  }

  if (conditions.tag) {
    const tag = options.requireEnabled === false
      ? database.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(conditions.tag.name)
      : database.prepare(`
        SELECT t.id
        FROM tags t
        JOIN word_occurrence_tags wot ON wot.tag_id = t.id
        JOIN word_occurrences wo ON wo.id = wot.occurrence_id
        JOIN source_files sf ON sf.id = wo.source_file_id
        JOIN sources s ON s.id = sf.source_id
        WHERE t.name = ? COLLATE NOCASE AND s.is_enabled = 1
        LIMIT 1
      `).get(conditions.tag.name)
    if (!tag) return { ok: false, reason: 'word-filter-tag-unresolved' }
    resolved.tagId = Number(tag.id)
  }

  if (conditions.word) {
    if (conditions.word.mode !== 'contains' || conditions.word.caseSensitive === true) {
      return { ok: false, reason: 'word-filter-word-rule-unsupported' }
    }
    resolved.word = String(conditions.word.value || '')
  }

  return { ok: true, filters: resolved }
}

export function resolveStableWordFilter(definition) {
  return useWordLibraryDatabase((database) => resolveStableWordFilterInDatabase(database, definition))
}

export function previewStableWordFilter(definition) {
  return useWordLibraryDatabase((database) => {
    const resolution = resolveStableWordFilterInDatabase(database, definition)
    if (!resolution.ok) return resolution
    return {
      ok: true,
      filters: resolution.filters,
      matchedCount: selectMatchingWordIds(database, resolution.filters).length,
    }
  })
}

export function listWordLibraryFilterOptions() {
  return useWordLibraryDatabase((database) => {
    const sources = database.prepare(`
      SELECT id, display_name, folder_path
      FROM sources
      WHERE is_enabled = 1
      ORDER BY display_name COLLATE NOCASE, folder_path
    `).all().map((row) => ({
      id: Number(row.id),
      displayName: row.display_name,
      folderPath: row.folder_path,
    }))

    const files = database.prepare(`
      SELECT sf.id, sf.source_id, sf.file_path, sf.relative_path, s.display_name AS source_name
      FROM source_files sf
      JOIN sources s ON s.id = sf.source_id
      WHERE s.is_enabled = 1
      ORDER BY s.display_name COLLATE NOCASE, sf.relative_path COLLATE NOCASE
    `).all().map((row) => ({
      id: Number(row.id),
      sourceId: Number(row.source_id),
      filePath: row.file_path,
      relativePath: row.relative_path,
      fileName: path.basename(row.file_path),
      sourceName: row.source_name,
    }))

    const tags = database.prepare(`
      SELECT DISTINCT t.id, t.name
      FROM tags t
      JOIN word_occurrence_tags wot ON wot.tag_id = t.id
      JOIN word_occurrences wo ON wo.id = wot.occurrence_id
      JOIN source_files sf ON sf.id = wo.source_file_id
      JOIN sources s ON s.id = sf.source_id
      WHERE s.is_enabled = 1
      ORDER BY t.name COLLATE NOCASE, t.name
    `).all().map((row) => ({ id: Number(row.id), name: row.name }))

    return { sources, files, tags }
  })
}

export function queryWordLibrary(filters = {}, options = {}) {
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 250))
  const offset = Math.max(0, Number(options.offset) || 0)
  const sortType = ['source', 'occurrences'].includes(options.sortType) ? options.sortType : 'text'
  const sortDirection = options.sortDirection === 'desc' ? 'desc' : 'asc'
  const directionSql = sortDirection === 'desc' ? 'DESC' : 'ASC'
  const formatDisplay = ['formatted', 'unformatted'].includes(options.formatDisplay)
    ? options.formatDisplay
    : 'all'
  const formatHaving = formatDisplay === 'formatted'
    ? `HAVING ${WORD_GROUP_UNFORMATTED_SQL} = 0`
    : formatDisplay === 'unformatted'
      ? `HAVING ${WORD_GROUP_UNFORMATTED_SQL} = 1`
      : ''
  const sourceSortAggregate = sortDirection === 'desc' ? 'MAX' : 'MIN'
  const sourceSortSql = `${sourceSortAggregate}((s.display_name || char(31) || sf.relative_path
    || char(31) || printf('%012d', wo.line_number)) COLLATE NOCASE)`
  const orderSql = sortType === 'source'
    ? `${sourceSortSql} ${directionSql}, w.normalized_word COLLATE NOCASE, w.normalized_word, w.id`
    : sortType === 'occurrences'
      ? `COUNT(DISTINCT wo.id) ${directionSql}, w.normalized_word COLLATE NOCASE, w.normalized_word, w.id`
      : `w.normalized_word COLLATE NOCASE ${directionSql}, w.normalized_word ${directionSql}, w.id ${directionSql}`

  return useWordLibraryDatabase((database) => {
    const baseWhere = buildLibraryFilterWhere(filters)
    const formatCountsRow = database.prepare(`
      SELECT
        COUNT(*) AS all_count,
        COALESCE(SUM(CASE WHEN grouped.has_unformatted = 0 THEN 1 ELSE 0 END), 0) AS formatted_count,
        COALESCE(SUM(CASE WHEN grouped.has_unformatted = 1 THEN 1 ELSE 0 END), 0) AS unformatted_count
      FROM (
        SELECT w.id, ${WORD_GROUP_UNFORMATTED_SQL} AS has_unformatted
        FROM words w
        JOIN word_occurrences wo ON wo.word_id = w.id
        JOIN source_files sf ON sf.id = wo.source_file_id
        JOIN sources s ON s.id = sf.source_id
        WHERE ${baseWhere.sql}
        GROUP BY w.id
      ) grouped
    `).get(...baseWhere.parameters)
    const totalRow = database.prepare(`
      SELECT COUNT(*) AS total FROM (
        SELECT w.id
        FROM words w
        JOIN word_occurrences wo ON wo.word_id = w.id
        JOIN source_files sf ON sf.id = wo.source_file_id
        JOIN sources s ON s.id = sf.source_id
        WHERE ${baseWhere.sql}
        GROUP BY w.id
        ${formatHaving}
      ) displayed
    `).get(...baseWhere.parameters)

    const wordRows = database.prepare(`
      SELECT
        w.id,
        w.language,
        w.normalization_version,
        w.normalized_word,
        w.display_word,
        COUNT(DISTINCT wo.id) AS occurrence_count
      FROM words w
      JOIN word_occurrences wo ON wo.word_id = w.id
      JOIN source_files sf ON sf.id = wo.source_file_id
      JOIN sources s ON s.id = sf.source_id
      WHERE ${baseWhere.sql}
      GROUP BY w.id
      ${formatHaving}
      ORDER BY ${orderSql}
      LIMIT ? OFFSET ?
    `).all(...baseWhere.parameters, limit, offset)

    const wordIds = wordRows.map((row) => Number(row.id))
    if (wordIds.length === 0) {
      return {
        words: [], total: Number(totalRow?.total || 0), limit, offset,
        formatCounts: {
          formatted: Number(formatCountsRow?.formatted_count || 0),
          unformatted: Number(formatCountsRow?.unformatted_count || 0),
          all: Number(formatCountsRow?.all_count || 0),
        },
      }
    }

    const occurrenceWhere = buildLibraryFilterWhere(filters, wordIds)
    const occurrenceRows = database.prepare(`
      SELECT
        wo.id,
        wo.word_id,
        wo.line_number,
        wo.source_word,
        wo.marker_1,
        wo.marker_2,
        wo.marker_3,
        wo.marker_4,
        wo.marker_5,
        wo.marker_6,
        wo.annotation,
        wo.raw_line,
        CASE WHEN ${WORD_OCCURRENCE_FORMATTED_SQL} THEN 0 ELSE 1 END AS is_unformatted,
        sf.id AS file_id,
        sf.file_path,
        sf.relative_path,
        s.id AS source_id,
        s.display_name AS source_name,
        s.folder_path
      FROM word_occurrences wo
      JOIN words w ON w.id = wo.word_id
      JOIN source_files sf ON sf.id = wo.source_file_id
      JOIN sources s ON s.id = sf.source_id
      WHERE ${occurrenceWhere.sql}
      ORDER BY w.normalized_word COLLATE NOCASE, w.normalized_word,
               s.display_name COLLATE NOCASE, sf.relative_path COLLATE NOCASE, wo.line_number
    `).all(...occurrenceWhere.parameters)

    const occurrencesByWord = new Map()
    for (const row of occurrenceRows) {
      const wordId = Number(row.word_id)
      const items = occurrencesByWord.get(wordId) || []
      items.push({
        id: Number(row.id),
        wordId,
        sourceId: Number(row.source_id),
        sourceName: row.source_name,
        folderPath: row.folder_path,
        fileId: Number(row.file_id),
        filePath: row.file_path,
        fileName: path.basename(row.file_path),
        relativePath: row.relative_path,
        lineNumber: Number(row.line_number),
        sourceWord: row.source_word,
        markers: [row.marker_1, row.marker_2, row.marker_3, row.marker_4, row.marker_5],
        annotation: row.annotation,
        rawLine: row.raw_line,
        isUnformatted: Boolean(row.is_unformatted),
      })
      occurrencesByWord.set(wordId, items)
    }

    return {
      words: wordRows.map((row) => ({
        id: Number(row.id),
        language: row.language,
        normalizationVersion: Number(row.normalization_version),
        normalizedWord: row.normalized_word,
        displayWord: row.display_word,
        occurrenceCount: Number(row.occurrence_count),
        occurrences: occurrencesByWord.get(Number(row.id)) || [],
      })),
      total: Number(totalRow?.total || 0),
      limit,
      offset,
      formatCounts: {
        formatted: Number(formatCountsRow?.formatted_count || 0),
        unformatted: Number(formatCountsRow?.unformatted_count || 0),
        all: Number(formatCountsRow?.all_count || 0),
      },
    }
  })
}

function selectMatchingWordIds(database, filters, queryOptions = {}) {
  const where = buildLibraryFilterWhere(filters, [], queryOptions)
  return database.prepare(`
    SELECT DISTINCT w.id
    FROM words w
    JOIN word_occurrences wo ON wo.word_id = w.id
    JOIN source_files sf ON sf.id = wo.source_file_id
    JOIN sources s ON s.id = sf.source_id
    WHERE ${where.sql}
    ORDER BY w.normalized_word COLLATE NOCASE, w.normalized_word
  `).all(...where.parameters).map((row) => Number(row.id))
}

function resolveStudyPlanFilters(database, planRow) {
  let storedFilter
  try {
    storedFilter = JSON.parse(planRow?.source_filter_json || '{}')
  } catch {
    return { ok: false, reason: 'invalid-study-plan-filter' }
  }
  if (!storedFilter?.filterSnapshot) {
    return { ok: false, reason: 'invalid-study-plan-filter' }
  }

  const resolution = resolveStableWordFilterInDatabase(
    database,
    storedFilter.filterSnapshot,
    { requireEnabled: false }
  )
  if (!resolution.ok) return resolution

  const sourceScopeFolderPaths = Array.isArray(storedFilter.sourceScopeFolderPaths)
    ? storedFilter.sourceScopeFolderPaths
    : []
  const findSource = database.prepare('SELECT id FROM sources WHERE folder_path_key = ?')
  const sourceIds = sourceScopeFolderPaths
    .map((folderPath) => Number(findSource.get(createFolderPathKey(folderPath))?.id || 0))
    .filter(Boolean)

  return {
    ...resolution,
    queryOptions: {
      requireEnabled: false,
      enforceSourceScope: true,
      sourceIds,
    },
  }
}

function getLiveWordOccurrenceCounts(database, filters, wordIds, queryOptions = {}) {
  if (!wordIds.length) return new Map()
  const where = buildLibraryFilterWhere(filters, wordIds, queryOptions)
  const rows = database.prepare(`
    SELECT wo.word_id, COUNT(DISTINCT wo.id) AS occurrence_count
    FROM words w
    JOIN word_occurrences wo ON wo.word_id = w.id
    JOIN source_files sf ON sf.id = wo.source_file_id
    JOIN sources s ON s.id = sf.source_id
    WHERE ${where.sql}
    GROUP BY wo.word_id
  `).all(...where.parameters)
  return new Map(rows.map((row) => [Number(row.word_id), Number(row.occurrence_count || 0)]))
}

function normalizeStudyPlanRow(row) {
  if (!row) return null
  let filterSnapshot = {}
  try {
    filterSnapshot = JSON.parse(row.source_filter_json || '{}')
  } catch {
    filterSnapshot = {}
  }

  return {
    id: Number(row.id),
    name: row.name,
    filterSnapshot,
    normalizationVersion: Number(row.normalization_version),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    totalCount: Number(row.total_count || 0),
    unseenCount: Number(row.unseen_count || 0),
    reviewedCount: Number(row.reviewed_count || 0),
    masteredCount: Number(row.mastered_count || 0),
    suspendedCount: Number(row.suspended_count || 0),
    specialCount: Number(row.special_count || 0),
  }
}

const STUDY_PLAN_SELECT_SQL = `
  SELECT
    p.*,
    COUNT(spi.id) AS total_count,
    SUM(CASE WHEN spi.status = 'unseen' THEN 1 ELSE 0 END) AS unseen_count,
    SUM(CASE WHEN spi.status = 'reviewed' THEN 1 ELSE 0 END) AS reviewed_count,
    SUM(CASE WHEN spi.status = 'mastered' THEN 1 ELSE 0 END) AS mastered_count,
    SUM(CASE WHEN spi.status = 'suspended' THEN 1 ELSE 0 END) AS suspended_count,
    SUM(CASE WHEN spi.is_special = 1 THEN 1 ELSE 0 END) AS special_count
  FROM study_plans p
  LEFT JOIN study_plan_items spi ON spi.plan_id = p.id
`

function getStudyPlanRow(database, planId) {
  return database.prepare(`${STUDY_PLAN_SELECT_SQL} WHERE p.id = ? GROUP BY p.id`).get(planId)
}

export function listStudyPlans() {
  return useWordLibraryDatabase((database) => (
    database.prepare(`${STUDY_PLAN_SELECT_SQL} GROUP BY p.id ORDER BY p.updated_at DESC, p.id DESC`)
      .all()
      .map(normalizeStudyPlanRow)
  ))
}

export function deleteStudyPlan(planId) {
  const numericPlanId = toOptionalPositiveInteger(planId)
  if (!numericPlanId) return { ok: false, reason: 'invalid-study-plan-id' }

  return useWordLibraryDatabase((database) => {
    const plan = normalizeStudyPlanRow(getStudyPlanRow(database, numericPlanId))
    if (!plan) return { ok: false, reason: 'study-plan-not-found' }
    const activeSession = database.prepare(`
      SELECT id FROM study_sessions WHERE plan_id = ? AND ended_at IS NULL LIMIT 1
    `).get(numericPlanId)

    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare('DELETE FROM review_events WHERE plan_id = ?').run(numericPlanId)
      database.prepare('DELETE FROM study_sessions WHERE plan_id = ?').run(numericPlanId)
      database.prepare('DELETE FROM study_plans WHERE id = ?').run(numericPlanId)
      database.exec('COMMIT')
      return { ok: true, plan, hadActiveSession: Boolean(activeSession) }
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  })
}

export function createStudyPlan(name, definition, filterFilePath = '') {
  const normalizedName = String(name || '').trim()
  if (!normalizedName) return { ok: false, reason: 'study-plan-name-required' }

  return useWordLibraryDatabase((database) => {
    const resolution = resolveStableWordFilterInDatabase(database, definition)
    if (!resolution.ok) return resolution
    const wordIds = selectMatchingWordIds(database, resolution.filters)
    const sourceScopeFolderPaths = database.prepare(`
      SELECT folder_path FROM sources WHERE is_enabled = 1 ORDER BY id
    `).all().map((row) => row.folder_path)
    const now = Date.now()

    database.exec('BEGIN IMMEDIATE')
    try {
      const planResult = database.prepare(`
        INSERT INTO study_plans (
          name, source_filter_json, normalization_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        normalizedName,
        JSON.stringify({
          version: 2,
          filterFilePath: String(filterFilePath || ''),
          filterSnapshot: definition,
          sourceScopeFolderPaths,
          occurrenceDataModel: 'live-reference-v1',
        }),
        WORD_NORMALIZATION_VERSION,
        now,
        now
      )
      const planId = Number(planResult.lastInsertRowid)
      const insertItem = database.prepare(`
        INSERT INTO study_plan_items (
          plan_id, word_id, item_order, status, is_special, added_at, status_at
        ) VALUES (?, ?, ?, 'unseen', 0, ?, ?)
      `)
      wordIds.forEach((wordId, index) => {
        insertItem.run(planId, wordId, index + 1, now, now)
      })
      database.exec('COMMIT')

      return {
        ok: true,
        plan: normalizeStudyPlanRow(getStudyPlanRow(database, planId)),
        addedCount: wordIds.length,
      }
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  })
}

export function refreshStudyPlanScope(planId) {
  const numericPlanId = toOptionalPositiveInteger(planId)
  if (!numericPlanId) return { ok: false, reason: 'invalid-study-plan-id' }

  return useWordLibraryDatabase((database) => {
    const planRow = database.prepare('SELECT * FROM study_plans WHERE id = ?').get(numericPlanId)
    if (!planRow) return { ok: false, reason: 'study-plan-not-found' }

    const resolution = resolveStudyPlanFilters(database, planRow)
    if (!resolution.ok) return resolution
    const wordIds = selectMatchingWordIds(database, resolution.filters, resolution.queryOptions)
    const now = Date.now()

    database.exec('BEGIN IMMEDIATE')
    try {
      const maxOrder = Number(database.prepare(`
        SELECT COALESCE(MAX(item_order), 0) AS max_order
        FROM study_plan_items WHERE plan_id = ?
      `).get(numericPlanId)?.max_order || 0)
      const insertItem = database.prepare(`
        INSERT OR IGNORE INTO study_plan_items (
          plan_id, word_id, item_order, status, is_special, added_at, status_at
        ) VALUES (?, ?, ?, 'unseen', 0, ?, ?)
      `)
      let addedCount = 0
      let nextOrder = maxOrder + 1
      for (const wordId of wordIds) {
        const result = insertItem.run(numericPlanId, wordId, nextOrder, now, now)
        if (result.changes > 0) {
          addedCount += 1
          nextOrder += 1
        }
      }
      database.prepare(`
        UPDATE study_plans SET updated_at = ? WHERE id = ?
      `).run(now, numericPlanId)
      database.exec('COMMIT')

      return {
        ok: true,
        plan: normalizeStudyPlanRow(getStudyPlanRow(database, numericPlanId)),
        matchedCount: wordIds.length,
        addedCount,
      }
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  })
}

export function listStudyPlanItems(planId, options = {}) {
  const numericPlanId = toOptionalPositiveInteger(planId)
  if (!numericPlanId) return { ok: false, reason: 'invalid-study-plan-id', items: [], total: 0 }
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 250))
  const offset = Math.max(0, Number(options.offset) || 0)

  return useWordLibraryDatabase((database) => {
    const planRow = getStudyPlanRow(database, numericPlanId)
    const plan = normalizeStudyPlanRow(planRow)
    if (!plan) return { ok: false, reason: 'study-plan-not-found', items: [], total: 0 }
    const resolution = resolveStudyPlanFilters(database, planRow)
    if (!resolution.ok) return { ...resolution, items: [], total: plan.totalCount }

    const rows = database.prepare(`
      SELECT
        spi.id,
        spi.word_id,
        spi.item_order,
        spi.status,
        spi.is_special,
        spi.added_at,
        spi.status_at,
        spi.last_reviewed_at,
        w.language,
        w.normalization_version,
        w.normalized_word,
        w.display_word
      FROM study_plan_items spi
      JOIN words w ON w.id = spi.word_id
      WHERE spi.plan_id = ?
      ORDER BY spi.item_order, spi.id
      LIMIT ? OFFSET ?
    `).all(numericPlanId, limit, offset)
    const occurrenceCounts = getLiveWordOccurrenceCounts(
      database,
      resolution.filters,
      rows.map((row) => Number(row.word_id)),
      resolution.queryOptions
    )

    return {
      ok: true,
      plan,
      items: rows.map((row) => ({
        id: Number(row.id),
        wordId: Number(row.word_id),
        itemOrder: Number(row.item_order),
        status: row.status,
        isSpecial: Boolean(row.is_special),
        addedAt: Number(row.added_at),
        statusAt: Number(row.status_at),
        lastReviewedAt: row.last_reviewed_at == null ? null : Number(row.last_reviewed_at),
        language: row.language,
        normalizationVersion: Number(row.normalization_version),
        normalizedWord: row.normalized_word,
        displayWord: row.display_word,
        occurrenceCount: occurrenceCounts.get(Number(row.word_id)) || 0,
      })),
      total: plan.totalCount,
      limit,
      offset,
    }
  })
}

export function getStudyPlanItemOccurrences(planId, planItemId) {
  const numericPlanId = toOptionalPositiveInteger(planId)
  const numericPlanItemId = toOptionalPositiveInteger(planItemId)
  if (!numericPlanId || !numericPlanItemId) {
    return { ok: false, reason: 'invalid-study-plan-item', occurrences: [] }
  }

  return useWordLibraryDatabase((database) => {
    const planRow = database.prepare('SELECT * FROM study_plans WHERE id = ?')
      .get(numericPlanId)
    if (!planRow) return { ok: false, reason: 'study-plan-not-found', occurrences: [] }

    const item = database.prepare(`
      SELECT id, word_id FROM study_plan_items WHERE id = ? AND plan_id = ?
    `).get(numericPlanItemId, numericPlanId)
    if (!item) return { ok: false, reason: 'study-plan-item-not-found', occurrences: [] }
    const resolution = resolveStudyPlanFilters(database, planRow)
    if (!resolution.ok) return { ...resolution, occurrences: [] }
    const where = buildLibraryFilterWhere(
      resolution.filters,
      [Number(item.word_id)],
      resolution.queryOptions
    )

    const rows = database.prepare(`
      SELECT wo.*, s.display_name AS source_name, s.folder_path,
             sf.relative_path, sf.file_path
      FROM words w
      JOIN word_occurrences wo ON wo.word_id = w.id
      JOIN source_files sf ON sf.id = wo.source_file_id
      JOIN sources s ON s.id = sf.source_id
      WHERE ${where.sql}
      ORDER BY s.display_name COLLATE NOCASE, sf.relative_path COLLATE NOCASE,
               wo.line_number, wo.id
    `).all(...where.parameters)
    return {
      ok: true,
      occurrences: rows.map((row) => ({
        id: Number(row.id),
        planItemId: numericPlanItemId,
        sourceName: row.source_name,
        folderPath: row.folder_path,
        relativePath: row.relative_path,
        filePath: row.file_path,
        lineNumber: Number(row.line_number),
        sourceWord: row.source_word,
        markers: [row.marker_1, row.marker_2, row.marker_3, row.marker_4, row.marker_5],
        annotation: row.annotation,
        rawLine: row.raw_line,
      })),
    }
  })
}

function parseStudySessionState(value) {
  try {
    const parsed = JSON.parse(value || '{}')
    if (!parsed || Number(parsed.version) !== 1 || !Array.isArray(parsed.queueItemIds)) {
      return { version: 1, queueItemIds: [], currentIndex: 0, isValid: false }
    }
    return {
      version: 1,
      queueItemIds: Array.isArray(parsed.queueItemIds)
        ? parsed.queueItemIds.map(toOptionalPositiveInteger).filter(Boolean)
        : [],
      currentIndex: Math.max(0, Number(parsed.currentIndex) || 0),
      isValid: true,
    }
  } catch {
    return { version: 1, queueItemIds: [], currentIndex: 0, isValid: false }
  }
}

function getReviewItemRow(database, sessionRow, planItemId) {
  const item = database.prepare(`
    SELECT
      spi.id,
      spi.plan_id,
      spi.word_id,
      spi.item_order,
      spi.status,
      spi.is_special,
      spi.last_reviewed_at,
      w.language,
      w.normalization_version,
      w.normalized_word,
      w.display_word
    FROM study_plan_items spi
    JOIN words w ON w.id = spi.word_id
    WHERE spi.id = ? AND spi.plan_id = ?
  `).get(planItemId, sessionRow.plan_id)
  if (!item) return null
  const resolution = resolveStudyPlanFilters(database, sessionRow)
  const occurrenceCounts = resolution.ok
    ? getLiveWordOccurrenceCounts(
      database,
      resolution.filters,
      [Number(item.word_id)],
      resolution.queryOptions
    )
    : new Map()
  return { ...item, occurrence_count: occurrenceCounts.get(Number(item.word_id)) || 0 }
}

function normalizeReviewItem(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    planId: Number(row.plan_id),
    wordId: Number(row.word_id),
    itemOrder: Number(row.item_order),
    status: row.status,
    isSpecial: Boolean(row.is_special),
    lastReviewedAt: row.last_reviewed_at == null ? null : Number(row.last_reviewed_at),
    language: row.language,
    normalizationVersion: Number(row.normalization_version),
    normalizedWord: row.normalized_word,
    displayWord: row.display_word,
    occurrenceCount: Number(row.occurrence_count || 0),
  }
}

function normalizeStudySessionRow(database, row) {
  if (!row) return null
  const state = parseStudySessionState(row.session_json)
  const queueLength = state.queueItemIds.length
  const currentIndex = Math.min(state.currentIndex, queueLength)
  const currentItemId = currentIndex < queueLength ? state.queueItemIds[currentIndex] : null
  const currentItem = currentItemId
    ? normalizeReviewItem(getReviewItemRow(database, row, currentItemId))
    : null
  return {
    id: Number(row.id),
    planId: Number(row.plan_id),
    planName: row.plan_name || '',
    startedAt: Number(row.started_at),
    endedAt: row.ended_at == null ? null : Number(row.ended_at),
    isActive: row.ended_at == null,
    queueLength,
    currentIndex,
    completedCount: currentIndex,
    remainingCount: Math.max(0, queueLength - currentIndex),
    currentItem,
  }
}

function getStudySessionRow(database, sessionId) {
  return database.prepare(`
    SELECT ss.*, p.name AS plan_name, p.source_filter_json
    FROM study_sessions ss
    JOIN study_plans p ON p.id = ss.plan_id
    WHERE ss.id = ?
  `).get(sessionId)
}

function getActiveStudySessionRow(database) {
  const rows = database.prepare(`
    SELECT ss.*, p.name AS plan_name, p.source_filter_json
    FROM study_sessions ss
    JOIN study_plans p ON p.id = ss.plan_id
    WHERE ss.ended_at IS NULL
    ORDER BY ss.started_at DESC, ss.id DESC
  `).all()
  if (rows.length > 1) {
    const now = Date.now()
    const endDuplicate = database.prepare('UPDATE study_sessions SET ended_at = ? WHERE id = ?')
    rows.slice(1).forEach((row) => endDuplicate.run(now, row.id))
  }
  return rows[0]
}

export function getActiveStudySession() {
  return useWordLibraryDatabase((database) => {
    const row = getActiveStudySessionRow(database)
    if (!row) return { ok: true, session: null }
    const state = parseStudySessionState(row.session_json)
    if (!state.isValid) {
      database.prepare('UPDATE study_sessions SET ended_at = ? WHERE id = ?').run(Date.now(), row.id)
      return {
        ok: true,
        session: null,
        recovered: true,
        reason: 'study-session-state-invalid',
      }
    }
    if (state.currentIndex >= state.queueItemIds.length) {
      database.prepare('UPDATE study_sessions SET ended_at = ? WHERE id = ?').run(Date.now(), row.id)
      return { ok: true, session: null, recovered: true, reason: 'study-session-completed' }
    }
    if (
      state.currentIndex < state.queueItemIds.length
      && !getReviewItemRow(database, row, state.queueItemIds[state.currentIndex])
    ) {
      database.prepare('UPDATE study_sessions SET ended_at = ? WHERE id = ?').run(Date.now(), row.id)
      return {
        ok: true,
        session: null,
        recovered: true,
        reason: 'study-session-current-item-missing',
      }
    }
    return { ok: true, session: normalizeStudySessionRow(database, row) }
  })
}

export function startStudySession(planId) {
  const numericPlanId = toOptionalPositiveInteger(planId)
  if (!numericPlanId) return { ok: false, reason: 'invalid-study-plan-id' }

  return useWordLibraryDatabase((database) => {
    const plan = normalizeStudyPlanRow(getStudyPlanRow(database, numericPlanId))
    if (!plan) return { ok: false, reason: 'study-plan-not-found' }

    const activeRow = getActiveStudySessionRow(database)
    if (activeRow) {
      const session = normalizeStudySessionRow(database, activeRow)
      return session.planId === numericPlanId
        ? { ok: true, resumed: true, session }
        : { ok: false, reason: 'another-study-session-active', session }
    }

    const queueItemIds = database.prepare(`
      SELECT id
      FROM study_plan_items
      WHERE plan_id = ?
        AND status <> 'suspended'
        AND (status = 'unseen' OR is_special = 1)
      ORDER BY item_order, id
    `).all(numericPlanId).map((row) => Number(row.id))
    if (queueItemIds.length === 0) {
      return { ok: false, reason: 'no-review-items' }
    }

    const now = Date.now()
    const sessionState = { version: 1, queueItemIds, currentIndex: 0 }
    const result = database.prepare(`
      INSERT INTO study_sessions (plan_id, started_at, ended_at, session_json)
      VALUES (?, ?, NULL, ?)
    `).run(numericPlanId, now, JSON.stringify(sessionState))
    const sessionId = Number(result.lastInsertRowid)
    return {
      ok: true,
      resumed: false,
      session: normalizeStudySessionRow(database, getStudySessionRow(database, sessionId)),
    }
  })
}

export function endStudySession(sessionId) {
  const numericSessionId = toOptionalPositiveInteger(sessionId)
  if (!numericSessionId) return { ok: false, reason: 'invalid-study-session-id' }

  return useWordLibraryDatabase((database) => {
    const row = getStudySessionRow(database, numericSessionId)
    if (!row) return { ok: false, reason: 'study-session-not-found' }
    if (row.ended_at == null) {
      database.prepare('UPDATE study_sessions SET ended_at = ? WHERE id = ?').run(Date.now(), numericSessionId)
    }
    return {
      ok: true,
      session: normalizeStudySessionRow(database, getStudySessionRow(database, numericSessionId)),
    }
  })
}

export function applyStudyReviewAction(sessionId, action) {
  const numericSessionId = toOptionalPositiveInteger(sessionId)
  const normalizedAction = String(action || '')
  if (!numericSessionId) return { ok: false, reason: 'invalid-study-session-id' }
  if (!['reviewed', 'skip', 'toggle-special'].includes(normalizedAction)) {
    return { ok: false, reason: 'invalid-study-review-action' }
  }

  return useWordLibraryDatabase((database) => {
    database.exec('BEGIN IMMEDIATE')
    try {
      const sessionRow = getStudySessionRow(database, numericSessionId)
      if (!sessionRow) {
        database.exec('ROLLBACK')
        return { ok: false, reason: 'study-session-not-found' }
      }
      if (sessionRow.ended_at != null) {
        database.exec('ROLLBACK')
        return { ok: false, reason: 'study-session-ended' }
      }

      const state = parseStudySessionState(sessionRow.session_json)
      if (!state.isValid) {
        database.prepare('UPDATE study_sessions SET ended_at = ? WHERE id = ?')
          .run(Date.now(), numericSessionId)
        database.exec('COMMIT')
        return { ok: false, recovered: true, reason: 'study-session-state-invalid' }
      }
      const planItemId = state.queueItemIds[state.currentIndex]
      const itemRow = planItemId ? getReviewItemRow(database, sessionRow, planItemId) : null
      if (!itemRow) {
        const now = Date.now()
        database.prepare('UPDATE study_sessions SET ended_at = ? WHERE id = ?').run(now, numericSessionId)
        database.exec('COMMIT')
        return {
          ok: false,
          recovered: true,
          reason: 'study-session-current-item-missing',
        }
      }

      const now = Date.now()
      const previousStatus = itemRow.status
      const wasSpecial = Boolean(itemRow.is_special)
      let nextStatus = previousStatus
      let eventType = normalizedAction
      let advance = false

      if (normalizedAction === 'reviewed') {
        nextStatus = 'reviewed'
        advance = true
        database.prepare(`
          UPDATE study_plan_items
          SET status = 'reviewed', status_at = ?, last_reviewed_at = ?
          WHERE id = ?
        `).run(now, now, itemRow.id)
      } else if (normalizedAction === 'skip') {
        advance = true
      } else {
        eventType = wasSpecial ? 'special-off' : 'special-on'
        database.prepare(`
          UPDATE study_plan_items SET is_special = ?, status_at = ? WHERE id = ?
        `).run(wasSpecial ? 0 : 1, now, itemRow.id)
      }

      database.prepare(`
        INSERT INTO review_events (
          session_id, plan_id, word_id, language, normalization_version,
          normalized_word, event_type, previous_status, next_status,
          was_special, details_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        numericSessionId,
        Number(sessionRow.plan_id),
        Number(itemRow.word_id),
        itemRow.language,
        Number(itemRow.normalization_version),
        itemRow.normalized_word,
        eventType,
        previousStatus,
        nextStatus,
        wasSpecial ? 1 : 0,
        JSON.stringify({ queueIndex: state.currentIndex }),
        now
      )

      if (advance) state.currentIndex += 1
      const completed = state.currentIndex >= state.queueItemIds.length
      database.prepare(`
        UPDATE study_sessions SET session_json = ?, ended_at = ? WHERE id = ?
      `).run(JSON.stringify(state), completed ? now : null, numericSessionId)
      database.prepare('UPDATE study_plans SET updated_at = ? WHERE id = ?')
        .run(now, Number(sessionRow.plan_id))
      database.exec('COMMIT')

      return {
        ok: true,
        action: eventType,
        completed,
        session: normalizeStudySessionRow(database, getStudySessionRow(database, numericSessionId)),
      }
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  })
}

export function reviewStudyPlanTo(planId, planItemId, options = {}) {
  const numericPlanId = toOptionalPositiveInteger(planId)
  const numericPlanItemId = toOptionalPositiveInteger(planItemId)
  if (!numericPlanId || !numericPlanItemId) {
    return { ok: false, reason: 'invalid-study-plan-item' }
  }

  return useWordLibraryDatabase((database) => {
    database.exec('BEGIN IMMEDIATE')
    try {
      const target = database.prepare(`
        SELECT spi.*, w.language, w.normalization_version, w.normalized_word
        FROM study_plan_items spi
        JOIN words w ON w.id = spi.word_id
        WHERE spi.id = ? AND spi.plan_id = ?
      `).get(numericPlanItemId, numericPlanId)
      if (!target) {
        database.exec('ROLLBACK')
        return { ok: false, reason: 'study-plan-item-not-found' }
      }
      if (target.status === 'suspended') {
        database.exec('ROLLBACK')
        return { ok: false, reason: 'suspended-study-plan-item' }
      }

      let activeRow = getActiveStudySessionRow(database)
      if (activeRow && Number(activeRow.plan_id) !== numericPlanId) {
        if (!options.replaceActiveSession) {
          const activeSession = normalizeStudySessionRow(database, activeRow)
          database.exec('ROLLBACK')
          return { ok: false, reason: 'another-study-session-active', session: activeSession }
        }
        database.prepare('UPDATE study_sessions SET ended_at = ? WHERE id = ?')
          .run(Date.now(), activeRow.id)
        activeRow = null
      }

      const tailQueue = database.prepare(`
        SELECT id
        FROM study_plan_items
        WHERE plan_id = ?
          AND status <> 'suspended'
          AND (
            id = ?
            OR (
              (item_order > ? OR (item_order = ? AND id > ?))
              AND (status = 'unseen' OR is_special = 1)
            )
          )
        ORDER BY item_order, id
      `).all(
        numericPlanId,
        numericPlanItemId,
        Number(target.item_order),
        Number(target.item_order),
        numericPlanItemId
      ).map((row) => Number(row.id))

      const now = Date.now()
      let sessionId
      let state
      let createdSession = false
      let previousIndex = null
      if (activeRow) {
        state = parseStudySessionState(activeRow.session_json)
        if (!state.isValid) {
          database.prepare('UPDATE study_sessions SET ended_at = ? WHERE id = ?').run(now, activeRow.id)
          database.exec('COMMIT')
          return { ok: false, recovered: true, reason: 'study-session-state-invalid' }
        }
        previousIndex = state.currentIndex
        const completedPrefix = state.queueItemIds.slice(0, state.currentIndex)
        state = {
          version: 1,
          queueItemIds: [...completedPrefix, ...tailQueue],
          currentIndex: completedPrefix.length,
        }
        sessionId = Number(activeRow.id)
        database.prepare(`
          UPDATE study_sessions SET session_json = ?, ended_at = NULL WHERE id = ?
        `).run(JSON.stringify(state), sessionId)
      } else {
        state = { version: 1, queueItemIds: tailQueue, currentIndex: 0 }
        const result = database.prepare(`
          INSERT INTO study_sessions (plan_id, started_at, ended_at, session_json)
          VALUES (?, ?, NULL, ?)
        `).run(numericPlanId, now, JSON.stringify(state))
        sessionId = Number(result.lastInsertRowid)
        createdSession = true
      }

      database.prepare(`
        INSERT INTO review_events (
          session_id, plan_id, word_id, language, normalization_version,
          normalized_word, event_type, previous_status, next_status,
          was_special, details_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'review-to', ?, ?, ?, ?, ?)
      `).run(
        sessionId,
        numericPlanId,
        Number(target.word_id),
        target.language,
        Number(target.normalization_version),
        target.normalized_word,
        target.status,
        target.status,
        target.is_special ? 1 : 0,
        JSON.stringify({
          targetPlanItemId: numericPlanItemId,
          previousIndex,
          nextIndex: state.currentIndex,
          createdSession,
        }),
        now
      )
      database.prepare('UPDATE study_plans SET updated_at = ? WHERE id = ?').run(now, numericPlanId)
      database.exec('COMMIT')

      return {
        ok: true,
        createdSession,
        session: normalizeStudySessionRow(database, getStudySessionRow(database, sessionId)),
      }
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  })
}

function normalizeReviewHistorySession(row) {
  const state = parseStudySessionState(row.session_json)
  const queueLength = state.queueItemIds.length
  const currentIndex = Math.min(state.currentIndex, queueLength)
  const endedAt = row.ended_at == null ? null : Number(row.ended_at)
  const status = endedAt == null
    ? 'active'
    : currentIndex >= queueLength && state.isValid
      ? 'completed'
      : 'ended'
  return {
    id: Number(row.id),
    planId: Number(row.plan_id),
    startedAt: Number(row.started_at),
    endedAt,
    status,
    stateValid: state.isValid,
    queueLength,
    completedCount: currentIndex,
    reviewedCount: Number(row.reviewed_count || 0),
    skipCount: Number(row.skip_count || 0),
    specialOnCount: Number(row.special_on_count || 0),
    specialOffCount: Number(row.special_off_count || 0),
    eventCount: Number(row.event_count || 0),
  }
}

export function listStudyReviewHistory(planId, options = {}) {
  const numericPlanId = toOptionalPositiveInteger(planId)
  if (!numericPlanId) return { ok: false, reason: 'invalid-study-plan-id', sessions: [] }
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 50))

  return useWordLibraryDatabase((database) => {
    const plan = normalizeStudyPlanRow(getStudyPlanRow(database, numericPlanId))
    if (!plan) return { ok: false, reason: 'study-plan-not-found', sessions: [] }

    const summaryRow = database.prepare(`
      SELECT
        COUNT(DISTINCT ss.id) AS session_count,
        MAX(ss.started_at) AS last_reviewed_at,
        SUM(CASE WHEN re.event_type = 'reviewed' THEN 1 ELSE 0 END) AS reviewed_count,
        SUM(CASE WHEN re.event_type = 'skip' THEN 1 ELSE 0 END) AS skip_count
      FROM study_sessions ss
      LEFT JOIN review_events re ON re.session_id = ss.id
      WHERE ss.plan_id = ?
    `).get(numericPlanId)

    const rows = database.prepare(`
      SELECT
        ss.*,
        COUNT(re.id) AS event_count,
        SUM(CASE WHEN re.event_type = 'reviewed' THEN 1 ELSE 0 END) AS reviewed_count,
        SUM(CASE WHEN re.event_type = 'skip' THEN 1 ELSE 0 END) AS skip_count,
        SUM(CASE WHEN re.event_type = 'special-on' THEN 1 ELSE 0 END) AS special_on_count,
        SUM(CASE WHEN re.event_type = 'special-off' THEN 1 ELSE 0 END) AS special_off_count
      FROM study_sessions ss
      LEFT JOIN review_events re ON re.session_id = ss.id
      WHERE ss.plan_id = ?
      GROUP BY ss.id
      ORDER BY ss.started_at DESC, ss.id DESC
      LIMIT ?
    `).all(numericPlanId, limit)

    return {
      ok: true,
      plan,
      summary: {
        sessionCount: Number(summaryRow?.session_count || 0),
        lastReviewedAt: summaryRow?.last_reviewed_at == null
          ? null
          : Number(summaryRow.last_reviewed_at),
        reviewedCount: Number(summaryRow?.reviewed_count || 0),
        skipCount: Number(summaryRow?.skip_count || 0),
      },
      sessions: rows.map(normalizeReviewHistorySession),
    }
  })
}

export function listStudyReviewEvents(sessionId) {
  const numericSessionId = toOptionalPositiveInteger(sessionId)
  if (!numericSessionId) return { ok: false, reason: 'invalid-study-session-id', events: [] }

  return useWordLibraryDatabase((database) => {
    const session = getStudySessionRow(database, numericSessionId)
    if (!session) return { ok: false, reason: 'study-session-not-found', events: [] }
    const rows = database.prepare(`
      SELECT * FROM review_events
      WHERE session_id = ?
      ORDER BY created_at, id
    `).all(numericSessionId)
    return {
      ok: true,
      events: rows.map((row) => ({
        id: Number(row.id),
        sessionId: Number(row.session_id),
        planId: row.plan_id == null ? null : Number(row.plan_id),
        wordId: row.word_id == null ? null : Number(row.word_id),
        language: row.language,
        normalizationVersion: Number(row.normalization_version),
        normalizedWord: row.normalized_word,
        eventType: row.event_type,
        previousStatus: row.previous_status || '',
        nextStatus: row.next_status || '',
        wasSpecial: Boolean(row.was_special),
        createdAt: Number(row.created_at),
      })),
    }
  })
}

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { readWordFile } from './wordFileService'
import { useWordLibraryDatabase } from './wordLibraryDatabase'

export const MIXED_NOTE_NORMALIZATION_VERSION = 1

const FILTER_TYPE = 'better-notes.mixed-note-filter'
const activeScans = new Map()

const toId = (value) => {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

const normalizeFolder = (value) => {
  const text = typeof value === 'string' ? value.trim().replace(/^["']|["']$/g, '') : ''
  return text ? path.resolve(text) : ''
}

const pathKey = (value) => {
  const resolved = normalizeFolder(value).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved
}

const relativePathKey = (value) => {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '')
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

async function canonicalFolderPath(folderPath) {
  const resolved = normalizeFolder(folderPath)
  if (!resolved) return ''
  const realPath = await fs.realpath(resolved).catch(() => resolved)
  return path.resolve(realPath)
}

function folderContains(parentFolder, childFolder) {
  const parentKey = pathKey(parentFolder)
  const childKey = pathKey(childFolder)
  if (!parentKey || !childKey || parentKey === childKey) return false
  const relative = path.relative(parentKey, childKey)
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

async function listTxtFilesRecursively(folderPath) {
  const files = []
  const visit = async (currentFolder) => {
    const entries = await fs.readdir(currentFolder, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(currentFolder, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await visit(entryPath)
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.txt') {
        files.push({ fileName: entry.name, filePath: entryPath })
      }
    }
  }
  await visit(folderPath)
  return files.sort((a, b) => a.filePath.localeCompare(b.filePath, 'en', { sensitivity: 'base' }))
}

const escapeLike = (value) => String(value ?? '').replace(/[\\%_]/g, '\\$&')

export function normalizeMixedWps(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim()
}

function parseMixedLine(rawLine) {
  const raw = String(rawLine ?? '')
  const trimmed = raw.trim()
  if (!trimmed) return null
  const match = trimmed.match(/^\[([^\]]+)\]\s*([\s\S]*)$/)
  const sourceWps = match ? match[1].trim() : trimmed
  const normalizedWps = normalizeMixedWps(sourceWps)
  if (!normalizedWps) return null
  return {
    sourceWps,
    normalizedWps,
    displayWps: sourceWps,
    comment: match ? match[2] : '',
    rawLine: raw,
    isPlainLine: !match,
    itemUid: crypto.createHash('sha256')
      .update(`mixed-note-wps:v${MIXED_NOTE_NORMALIZATION_VERSION}\n${normalizedWps}`)
      .digest('hex'),
  }
}

function parseFileMetadata(fileName) {
  const match = String(fileName || '').match(/^(.*?)\s+(\d{4})-(\d{1,2})\s+(.+)\.txt$/i)
  if (!match) return { noteType: '', year: null, month: null, computerName: '', matched: false }
  const month = Number(match[3])
  if (month < 1 || month > 12) {
    return { noteType: '', year: null, month: null, computerName: '', matched: false }
  }
  return {
    noteType: match[1].trim(),
    year: Number(match[2]),
    month,
    computerName: match[4].trim(),
    matched: true,
  }
}

export function initializeMixedNoteSchema() {
  return useWordLibraryDatabase((database) => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS mixed_note_sources (
        id INTEGER PRIMARY KEY, folder_path TEXT NOT NULL, folder_path_key TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL, is_enabled INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_scanned_at INTEGER,
        last_scan_status TEXT, last_scan_error TEXT
      );
      CREATE TABLE IF NOT EXISTS mixed_note_files (
        id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES mixed_note_sources(id) ON DELETE CASCADE,
        relative_path TEXT NOT NULL, file_path TEXT NOT NULL, file_size INTEGER, modified_at_ms INTEGER,
        encoding TEXT, note_type TEXT NOT NULL DEFAULT '', note_year INTEGER, note_month INTEGER,
        computer_name TEXT NOT NULL DEFAULT '', indexed_at INTEGER,
        UNIQUE(source_id, relative_path)
      );
      CREATE TABLE IF NOT EXISTS mixed_note_items (
        id INTEGER PRIMARY KEY, item_uid TEXT NOT NULL UNIQUE, normalization_version INTEGER NOT NULL,
        normalized_wps TEXT NOT NULL UNIQUE, display_wps TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mixed_note_occurrences (
        id INTEGER PRIMARY KEY, source_file_id INTEGER NOT NULL REFERENCES mixed_note_files(id) ON DELETE CASCADE,
        item_id INTEGER NOT NULL REFERENCES mixed_note_items(id) ON DELETE RESTRICT,
        line_number INTEGER NOT NULL, source_wps TEXT NOT NULL, comment TEXT NOT NULL DEFAULT '',
        raw_line TEXT NOT NULL, is_plain_line INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(source_file_id, line_number)
      );
      CREATE INDEX IF NOT EXISTS idx_mixed_occurrence_item ON mixed_note_occurrences(item_id);
      CREATE TABLE IF NOT EXISTS mixed_note_study_plans (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, source_filter_json TEXT NOT NULL,
        normalization_version INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mixed_note_plan_items (
        id INTEGER PRIMARY KEY, plan_id INTEGER NOT NULL REFERENCES mixed_note_study_plans(id) ON DELETE CASCADE,
        item_id INTEGER NOT NULL REFERENCES mixed_note_items(id) ON DELETE RESTRICT, item_order INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'unseen', is_special INTEGER NOT NULL DEFAULT 0,
        added_at INTEGER NOT NULL, status_at INTEGER NOT NULL, last_reviewed_at INTEGER,
        UNIQUE(plan_id, item_id)
      );
      CREATE TABLE IF NOT EXISTS mixed_note_plan_occurrences (
        id INTEGER PRIMARY KEY, plan_item_id INTEGER NOT NULL REFERENCES mixed_note_plan_items(id) ON DELETE CASCADE,
        source_name TEXT NOT NULL, source_folder_path TEXT NOT NULL, relative_path TEXT NOT NULL,
        file_path TEXT NOT NULL, line_number INTEGER NOT NULL, source_wps TEXT NOT NULL,
        comment TEXT NOT NULL DEFAULT '', raw_line TEXT NOT NULL DEFAULT '', note_type TEXT NOT NULL DEFAULT '',
        note_year INTEGER, note_month INTEGER, computer_name TEXT NOT NULL DEFAULT '', captured_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mixed_note_study_sessions (
        id INTEGER PRIMARY KEY, plan_id INTEGER NOT NULL REFERENCES mixed_note_study_plans(id) ON DELETE RESTRICT,
        started_at INTEGER NOT NULL, ended_at INTEGER, session_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS mixed_note_review_events (
        id INTEGER PRIMARY KEY, session_id INTEGER REFERENCES mixed_note_study_sessions(id) ON DELETE SET NULL,
        plan_id INTEGER REFERENCES mixed_note_study_plans(id) ON DELETE SET NULL,
        item_id INTEGER REFERENCES mixed_note_items(id) ON DELETE SET NULL,
        normalized_wps TEXT NOT NULL, event_type TEXT NOT NULL, previous_status TEXT,
        next_status TEXT, was_special INTEGER NOT NULL DEFAULT 0, details_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );
    `)
    return { ok: true }
  })
}

const SOURCE_SQL = `
  SELECT s.*, COUNT(DISTINCT f.id) AS file_count, COUNT(o.id) AS occurrence_count,
         COUNT(DISTINCT o.item_id) AS word_count
  FROM mixed_note_sources s
  LEFT JOIN mixed_note_files f ON f.source_id = s.id
  LEFT JOIN mixed_note_occurrences o ON o.source_file_id = f.id
`

const mapSource = (row) => row ? ({
  id: Number(row.id), folderPath: row.folder_path, displayName: row.display_name,
  isEnabled: Boolean(row.is_enabled), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  lastScannedAt: row.last_scanned_at == null ? null : Number(row.last_scanned_at),
  lastScanStatus: row.last_scan_status || '', lastScanError: row.last_scan_error || '',
  fileCount: Number(row.file_count || 0), occurrenceCount: Number(row.occurrence_count || 0),
  wordCount: Number(row.word_count || 0),
}) : null

const getSourceRow = (db, id) => db.prepare(`${SOURCE_SQL} WHERE s.id = ? GROUP BY s.id`).get(id)

export function listMixedNoteSources() {
  return useWordLibraryDatabase((db) => db.prepare(
    `${SOURCE_SQL} GROUP BY s.id ORDER BY s.is_enabled DESC, s.updated_at DESC, s.id DESC`
  ).all().map(mapSource))
}

export function getMixedNoteSource(id) {
  const sourceId = toId(id)
  return sourceId ? useWordLibraryDatabase((db) => mapSource(getSourceRow(db, sourceId))) : null
}

export async function addMixedNoteSource(folderPath) {
  const resolved = normalizeFolder(folderPath)
  if (!resolved) return { ok: false, reason: 'source-folder-not-set' }
  const stat = await fs.stat(resolved).catch(() => null)
  if (!stat?.isDirectory()) return { ok: false, reason: 'source-folder-not-found', folderPath: resolved }
  return useWordLibraryDatabase((db) => {
    const key = pathKey(resolved)
    const existing = db.prepare('SELECT id FROM mixed_note_sources WHERE folder_path_key = ?').get(key)
    if (existing) return { ok: true, alreadyExists: true, source: mapSource(getSourceRow(db, existing.id)) }
    const now = Date.now()
    const result = db.prepare(`INSERT INTO mixed_note_sources
      (folder_path, folder_path_key, display_name, is_enabled, created_at, updated_at, last_scan_status, last_scan_error)
      VALUES (?, ?, ?, 0, ?, ?, 'not-scanned', '')`
    ).run(resolved, key, path.basename(resolved), now, now)
    return { ok: true, alreadyExists: false, source: mapSource(getSourceRow(db, result.lastInsertRowid)) }
  })
}

export async function validateMixedNoteSourceSelection(ids) {
  const requestedIds = [...new Set((Array.isArray(ids) ? ids : []).map(toId).filter(Boolean))]
  const sourceMap = new Map(listMixedNoteSources().map((source) => [source.id, source]))
  const sources = requestedIds.map((id) => sourceMap.get(id)).filter(Boolean)
  const canonicalSources = []

  try {
    for (const source of sources) {
      canonicalSources.push({ source, canonicalPath: await canonicalFolderPath(source.folderPath) })
    }
  } catch (error) {
    return { ok: false, reason: 'mixed-source-path-check-failed', error: error?.message || String(error) }
  }

  for (let firstIndex = 0; firstIndex < canonicalSources.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < canonicalSources.length; secondIndex += 1) {
      const first = canonicalSources[firstIndex]
      const second = canonicalSources[secondIndex]
      if (pathKey(first.canonicalPath) === pathKey(second.canonicalPath)
        || folderContains(first.canonicalPath, second.canonicalPath)
        || folderContains(second.canonicalPath, first.canonicalPath)) {
        const firstContainsSecond = folderContains(first.canonicalPath, second.canonicalPath)
        return {
          ok: false,
          reason: 'mixed-source-folder-overlap',
          parentFolder: firstContainsSecond ? first.source.folderPath : second.source.folderPath,
          childFolder: firstContainsSecond ? second.source.folderPath : first.source.folderPath,
        }
      }
    }
  }

  const manifests = []
  const filesByName = new Map()
  try {
    for (const source of sources) {
      const files = await listTxtFilesRecursively(source.folderPath)
      manifests.push({ sourceId: source.id, files })
      for (const file of files) {
        const key = process.platform === 'win32' ? file.fileName.toLocaleLowerCase('en-US') : file.fileName
        const matches = filesByName.get(key) || []
        matches.push({ sourceId: source.id, sourceName: source.displayName, ...file })
        filesByName.set(key, matches)
      }
    }
  } catch (error) {
    return { ok: false, reason: 'mixed-source-recursive-scan-failed', error: error?.message || String(error) }
  }

  const duplicateFileNames = [...filesByName.values()].filter((matches) => matches.length > 1)
  if (duplicateFileNames.length > 0) {
    return { ok: false, reason: 'mixed-note-duplicate-file-names', duplicateFileNames }
  }
  return { ok: true, sources, manifests, fileCount: manifests.reduce((sum, item) => sum + item.files.length, 0) }
}

export function applyMixedNoteSourceSelection(ids) {
  const requested = new Set((Array.isArray(ids) ? ids : []).map(toId).filter(Boolean))
  return useWordLibraryDatabase((db) => {
    const rows = db.prepare('SELECT id FROM mixed_note_sources').all()
    const existing = new Set(rows.map((row) => Number(row.id)))
    const enabled = [...requested].filter((id) => existing.has(id))
    const enabledSet = new Set(enabled)
    const update = db.prepare('UPDATE mixed_note_sources SET is_enabled = ?, updated_at = ? WHERE id = ?')
    const now = Date.now()
    db.exec('BEGIN IMMEDIATE')
    try {
      rows.forEach((row) => update.run(enabledSet.has(Number(row.id)) ? 1 : 0, now, row.id))
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return { ok: true, enabledSourceIds: enabled, sources: listMixedNoteSources() }
  })
}

export function deleteMixedNoteSource(id) {
  const sourceId = toId(id)
  if (!sourceId) return { ok: false, reason: 'invalid-source-id' }
  return useWordLibraryDatabase((db) => {
    const source = mapSource(getSourceRow(db, sourceId))
    if (!source) return { ok: false, reason: 'source-not-found' }
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare('DELETE FROM mixed_note_sources WHERE id = ?').run(sourceId)
      db.prepare(`DELETE FROM mixed_note_items WHERE NOT EXISTS
        (SELECT 1 FROM mixed_note_occurrences o WHERE o.item_id = mixed_note_items.id)
        AND NOT EXISTS (SELECT 1 FROM mixed_note_plan_items p WHERE p.item_id = mixed_note_items.id)`).run()
      db.exec('COMMIT')
      return { ok: true, source }
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  })
}

async function readMixedSource(source, manifestFiles = null) {
  const files = Array.isArray(manifestFiles) ? manifestFiles : await listTxtFilesRecursively(source.folderPath)
  const indexedFiles = []
  const failures = []
  for (const file of files) {
    try {
      const [read, stat] = await Promise.all([
        readWordFile(file.filePath, { includeTxtFiles: false }), fs.stat(file.filePath),
      ])
      if (!read?.ok) throw new Error(read?.reason || 'read-failed')
      const records = read.records.map((record, index) => {
        const parsed = parseMixedLine(record.raw)
        return parsed ? { ...parsed, lineNumber: index + 1 } : null
      }).filter(Boolean)
      indexedFiles.push({
        ...file, fileSize: stat.size, modifiedAtMs: stat.mtimeMs, encoding: read.encoding || '',
        metadata: parseFileMetadata(file.fileName), records,
      })
    } catch (error) {
      failures.push({ filePath: file.filePath, reason: error?.message || String(error) })
    }
  }
  return { indexedFiles, failures }
}

function replaceMixedSourceIndex(source, scan) {
  return useWordLibraryDatabase((db) => {
    const now = Date.now()
    const insertFile = db.prepare(`INSERT INTO mixed_note_files
      (source_id, relative_path, file_path, file_size, modified_at_ms, encoding,
       note_type, note_year, note_month, computer_name, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const upsertItem = db.prepare(`INSERT INTO mixed_note_items
      (item_uid, normalization_version, normalized_wps, display_wps, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(normalized_wps) DO UPDATE SET updated_at = excluded.updated_at`)
    const findItem = db.prepare('SELECT id FROM mixed_note_items WHERE normalized_wps = ?')
    const insertOccurrence = db.prepare(`INSERT INTO mixed_note_occurrences
      (source_file_id, item_id, line_number, source_wps, comment, raw_line, is_plain_line, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare('DELETE FROM mixed_note_files WHERE source_id = ?').run(source.id)
      let occurrenceCount = 0
      let plainLineCount = 0
      for (const file of scan.indexedFiles) {
        const m = file.metadata
        const result = insertFile.run(
          source.id, path.relative(source.folderPath, file.filePath) || file.fileName, file.filePath,
          file.fileSize, file.modifiedAtMs, file.encoding, m.noteType, m.year, m.month, m.computerName, now
        )
        const fileId = Number(result.lastInsertRowid)
        for (const record of file.records) {
          upsertItem.run(record.itemUid, MIXED_NOTE_NORMALIZATION_VERSION, record.normalizedWps, record.displayWps, now, now)
          const itemId = Number(findItem.get(record.normalizedWps).id)
          insertOccurrence.run(fileId, itemId, record.lineNumber, record.sourceWps, record.comment,
            record.rawLine, record.isPlainLine ? 1 : 0, now, now)
          occurrenceCount += 1
          if (record.isPlainLine) plainLineCount += 1
        }
      }
      db.prepare(`DELETE FROM mixed_note_items WHERE NOT EXISTS
        (SELECT 1 FROM mixed_note_occurrences o WHERE o.item_id = mixed_note_items.id)
        AND NOT EXISTS (SELECT 1 FROM mixed_note_plan_items p WHERE p.item_id = mixed_note_items.id)`).run()
      const status = scan.failures.length ? 'partial' : 'ready'
      db.prepare(`UPDATE mixed_note_sources SET updated_at=?, last_scanned_at=?, last_scan_status=?, last_scan_error=?
        WHERE id=?`).run(now, now, status, scan.failures.map((x) => `${x.filePath}: ${x.reason}`).join('\n'), source.id)
      db.exec('COMMIT')
      return { ok: true, status, fileCount: scan.indexedFiles.length, occurrenceCount,
        plainLineCount, failureCount: scan.failures.length, failures: scan.failures,
        source: mapSource(getSourceRow(db, source.id)) }
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  })
}

export function scanMixedNoteSource(id, manifestFiles = null) {
  const sourceId = toId(id)
  if (!sourceId) return Promise.resolve({ ok: false, reason: 'invalid-source-id' })
  if (activeScans.has(sourceId)) return activeScans.get(sourceId)
  const promise = (async () => {
    const source = getMixedNoteSource(sourceId)
    if (!source) return { ok: false, reason: 'source-not-found' }
    return replaceMixedSourceIndex(source, await readMixedSource(source, manifestFiles))
  })().finally(() => activeScans.delete(sourceId))
  activeScans.set(sourceId, promise)
  return promise
}

const normalizeFilters = (filters = {}) => ({
  sourceId: toId(filters.sourceId) || '', fileId: toId(filters.fileId) || '',
  noteType: String(filters.noteType || ''), year: Number(filters.year) || '',
  month: Number(filters.month) || '', computerName: String(filters.computerName || ''),
  wps: String(filters.wps || ''), comment: String(filters.comment || ''),
})

function buildWhere(filters = {}, itemIds = []) {
  const f = normalizeFilters(filters)
  const clauses = ['s.is_enabled = 1']
  const parameters = []
  if (f.sourceId) { clauses.push('s.id = ?'); parameters.push(f.sourceId) }
  if (f.fileId) { clauses.push('mf.id = ?'); parameters.push(f.fileId) }
  if (f.noteType) { clauses.push('mf.note_type = ? COLLATE NOCASE'); parameters.push(f.noteType) }
  if (f.year) { clauses.push('mf.note_year = ?'); parameters.push(f.year) }
  if (f.month) { clauses.push('mf.note_month = ?'); parameters.push(f.month) }
  if (f.computerName) {
    clauses.push("mf.computer_name LIKE ? ESCAPE '\\' COLLATE NOCASE")
    parameters.push(`%${escapeLike(f.computerName)}%`)
  }
  if (f.wps) {
    clauses.push("mi.normalized_wps LIKE ? ESCAPE '\\' COLLATE NOCASE")
    parameters.push(`%${escapeLike(normalizeMixedWps(f.wps))}%`)
  }
  if (f.comment) {
    clauses.push("mo.comment LIKE ? ESCAPE '\\' COLLATE NOCASE")
    parameters.push(`%${escapeLike(f.comment)}%`)
  }
  if (itemIds.length) {
    clauses.push(`mi.id IN (${itemIds.map(() => '?').join(',')})`)
    parameters.push(...itemIds)
  }
  return { sql: clauses.join(' AND '), parameters }
}

export function listMixedNoteFilterOptions() {
  return useWordLibraryDatabase((db) => ({
    sources: db.prepare(`SELECT id, display_name, folder_path FROM mixed_note_sources
      WHERE is_enabled=1 ORDER BY display_name COLLATE NOCASE`).all().map((row) => ({
        id: Number(row.id), displayName: row.display_name, folderPath: row.folder_path,
      })),
    files: db.prepare(`SELECT mf.id, mf.source_id, mf.relative_path, mf.file_path, s.display_name source_name
      FROM mixed_note_files mf JOIN mixed_note_sources s ON s.id=mf.source_id WHERE s.is_enabled=1
      ORDER BY s.display_name COLLATE NOCASE, mf.relative_path COLLATE NOCASE`).all().map((row) => ({
        id: Number(row.id), sourceId: Number(row.source_id), relativePath: row.relative_path,
        filePath: row.file_path, sourceName: row.source_name,
      })),
    noteTypes: db.prepare(`SELECT DISTINCT mf.note_type value FROM mixed_note_files mf
      JOIN mixed_note_sources s ON s.id=mf.source_id WHERE s.is_enabled=1 AND mf.note_type<>''
      ORDER BY value COLLATE NOCASE`).all().map((row) => row.value),
    years: db.prepare(`SELECT DISTINCT mf.note_year value FROM mixed_note_files mf
      JOIN mixed_note_sources s ON s.id=mf.source_id WHERE s.is_enabled=1 AND mf.note_year IS NOT NULL
      ORDER BY value DESC`).all().map((row) => Number(row.value)),
    computers: db.prepare(`SELECT DISTINCT mf.computer_name value FROM mixed_note_files mf
      JOIN mixed_note_sources s ON s.id=mf.source_id WHERE s.is_enabled=1 AND mf.computer_name<>''
      ORDER BY value COLLATE NOCASE`).all().map((row) => row.value),
  }))
}

export function queryMixedNotes(filters = {}, options = {}) {
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 250))
  const offset = Math.max(0, Number(options.offset) || 0)
  const sortType = ['source', 'occurrences'].includes(options.sortType) ? options.sortType : 'text'
  const sortDirection = options.sortDirection === 'desc' ? 'desc' : 'asc'
  const directionSql = sortDirection === 'desc' ? 'DESC' : 'ASC'
  const formatDisplay = ['formatted', 'unformatted'].includes(options.formatDisplay)
    ? options.formatDisplay
    : 'all'
  const formatHaving = formatDisplay === 'formatted'
    ? 'HAVING MAX(mo.is_plain_line) = 0'
    : formatDisplay === 'unformatted'
      ? 'HAVING MAX(mo.is_plain_line) = 1'
      : ''
  const sourceSortAggregate = sortDirection === 'desc' ? 'MAX' : 'MIN'
  const sourceSortSql = `${sourceSortAggregate}((s.display_name || char(31) || mf.relative_path
    || char(31) || printf('%012d', mo.line_number)) COLLATE NOCASE)`
  const orderSql = sortType === 'source'
    ? `${sourceSortSql} ${directionSql}, mi.normalized_wps COLLATE NOCASE, mi.normalized_wps, mi.id`
    : sortType === 'occurrences'
      ? `COUNT(DISTINCT mo.id) ${directionSql}, mi.normalized_wps COLLATE NOCASE, mi.normalized_wps, mi.id`
      : `mi.normalized_wps COLLATE NOCASE ${directionSql}, mi.normalized_wps ${directionSql}, mi.id ${directionSql}`
  return useWordLibraryDatabase((db) => {
    const where = buildWhere(filters)
    const join = `FROM mixed_note_items mi JOIN mixed_note_occurrences mo ON mo.item_id=mi.id
      JOIN mixed_note_files mf ON mf.id=mo.source_file_id JOIN mixed_note_sources s ON s.id=mf.source_id`
    const formatCountsRow = db.prepare(`SELECT COUNT(*) all_count,
      COALESCE(SUM(CASE WHEN grouped.has_unformatted=0 THEN 1 ELSE 0 END),0) formatted_count,
      COALESCE(SUM(CASE WHEN grouped.has_unformatted=1 THEN 1 ELSE 0 END),0) unformatted_count
      FROM (SELECT mi.id, MAX(mo.is_plain_line) has_unformatted ${join}
        WHERE ${where.sql} GROUP BY mi.id) grouped`).get(...where.parameters)
    const total = Number(db.prepare(`SELECT COUNT(*) total FROM (
      SELECT mi.id ${join} WHERE ${where.sql} GROUP BY mi.id ${formatHaving}
    ) displayed`).get(...where.parameters)?.total || 0)
    const rows = db.prepare(`SELECT mi.*, COUNT(DISTINCT mo.id) occurrence_count ${join}
      WHERE ${where.sql} GROUP BY mi.id ${formatHaving}
      ORDER BY ${orderSql}
      LIMIT ? OFFSET ?`).all(...where.parameters, limit, offset)
    const ids = rows.map((row) => Number(row.id))
    const byItem = new Map()
    if (ids.length) {
      const occurrenceWhere = buildWhere(filters, ids)
      const occurrences = db.prepare(`SELECT mo.*, mf.id file_id, mf.file_path, mf.relative_path,
        mf.note_type, mf.note_year, mf.note_month, mf.computer_name,
        s.id source_id, s.display_name source_name, s.folder_path, mi.normalized_wps
        ${join} WHERE ${occurrenceWhere.sql}
        ORDER BY mi.normalized_wps COLLATE NOCASE, s.display_name COLLATE NOCASE,
                 mf.relative_path COLLATE NOCASE, mo.line_number`).all(...occurrenceWhere.parameters)
      occurrences.forEach((row) => {
        const itemId = Number(row.item_id)
        const list = byItem.get(itemId) || []
        list.push({
          id: Number(row.id), wordId: itemId, sourceId: Number(row.source_id), sourceName: row.source_name,
          folderPath: row.folder_path, fileId: Number(row.file_id), filePath: row.file_path,
          relativePath: row.relative_path, lineNumber: Number(row.line_number), sourceWord: row.source_wps,
          annotation: row.comment, rawLine: row.raw_line, isPlainLine: Boolean(row.is_plain_line),
          noteType: row.note_type, year: row.note_year == null ? null : Number(row.note_year),
          month: row.note_month == null ? null : Number(row.note_month), computerName: row.computer_name,
          markers: [row.note_type, row.note_year && row.note_month ? `${row.note_year}-${row.note_month}` : '', row.computer_name].filter(Boolean),
        })
        byItem.set(itemId, list)
      })
    }
    return { words: rows.map((row) => ({
      id: Number(row.id), normalizedWord: row.normalized_wps, displayWord: row.display_wps,
      occurrenceCount: Number(row.occurrence_count), occurrences: byItem.get(Number(row.id)) || [],
    })), total, limit, offset, formatCounts: {
      formatted: Number(formatCountsRow?.formatted_count || 0),
      unformatted: Number(formatCountsRow?.unformatted_count || 0),
      all: Number(formatCountsRow?.all_count || 0),
    } }
  })
}

function stableConditionsInDb(db, filters = {}) {
  const f = normalizeFilters(filters)
  let source = null
  let file = null
  if (f.sourceId) {
    source = db.prepare('SELECT folder_path FROM mixed_note_sources WHERE id=? AND is_enabled=1').get(f.sourceId)
    if (!source) return { ok: false, reason: 'mixed-filter-source-unresolved' }
  }
  if (f.fileId) {
    file = db.prepare(`SELECT mf.relative_path, s.folder_path, s.id source_id FROM mixed_note_files mf
      JOIN mixed_note_sources s ON s.id=mf.source_id WHERE mf.id=? AND s.is_enabled=1`).get(f.fileId)
    if (!file || (f.sourceId && Number(file.source_id) !== f.sourceId)) {
      return { ok: false, reason: 'mixed-filter-file-unresolved' }
    }
  }
  return { ok: true, conditions: {
    source: source ? { folderPath: source.folder_path } : null,
    file: file ? { sourceFolderPath: file.folder_path, relativePath: file.relative_path } : null,
    noteType: f.noteType, year: f.year || null, month: f.month || null,
    computerName: f.computerName, wps: f.wps, comment: f.comment,
  } }
}

export function createStableMixedNoteFilter(filters = {}) {
  return useWordLibraryDatabase((db) => stableConditionsInDb(db, filters))
}

function resolveConditionsInDb(db, definition) {
  const c = definition?.conditions || {}
  const resolved = normalizeFilters({
    noteType: c.noteType, year: c.year, month: c.month,
    computerName: c.computerName, wps: c.wps, comment: c.comment,
  })
  if (c.source?.folderPath) {
    const row = db.prepare('SELECT id FROM mixed_note_sources WHERE folder_path_key=? AND is_enabled=1')
      .get(pathKey(c.source.folderPath))
    if (!row) return { ok: false, reason: 'mixed-filter-source-unresolved' }
    resolved.sourceId = Number(row.id)
  }
  if (c.file?.sourceFolderPath) {
    const source = db.prepare('SELECT id FROM mixed_note_sources WHERE folder_path_key=? AND is_enabled=1')
      .get(pathKey(c.file.sourceFolderPath))
    if (!source) return { ok: false, reason: 'mixed-filter-file-source-unresolved' }
    const candidates = db.prepare('SELECT id, relative_path FROM mixed_note_files WHERE source_id=?').all(source.id)
    const file = candidates.find((row) => relativePathKey(row.relative_path) === relativePathKey(c.file.relativePath))
    if (!file) return { ok: false, reason: 'mixed-filter-file-unresolved' }
    if (resolved.sourceId && resolved.sourceId !== Number(source.id)) {
      return { ok: false, reason: 'mixed-filter-source-file-mismatch' }
    }
    resolved.fileId = Number(file.id)
  }
  return { ok: true, filters: resolved }
}

export function previewStableMixedNoteFilter(definition) {
  return useWordLibraryDatabase((db) => {
    const result = resolveConditionsInDb(db, definition)
    if (!result.ok) return result
    const where = buildWhere(result.filters)
    const count = db.prepare(`SELECT COUNT(DISTINCT mi.id) total FROM mixed_note_items mi
      JOIN mixed_note_occurrences mo ON mo.item_id=mi.id JOIN mixed_note_files mf ON mf.id=mo.source_file_id
      JOIN mixed_note_sources s ON s.id=mf.source_id WHERE ${where.sql}`).get(...where.parameters)
    return { ok: true, filters: result.filters, matchedCount: Number(count?.total || 0) }
  })
}

export function createMixedFilterDefinition(conditions, existing = null, name = 'Mixed Note Filter') {
  const now = new Date().toISOString()
  return {
    type: FILTER_TYPE, version: 1, filterId: existing?.filterId || crypto.randomUUID(),
    name: existing?.name || name, createdAt: existing?.createdAt || now, updatedAt: now,
    normalizationVersion: MIXED_NOTE_NORMALIZATION_VERSION, conditions,
  }
}

export function validateMixedFilterDefinition(value) {
  if (value?.type !== FILTER_TYPE || Number(value?.version) !== 1
    || Number(value?.normalizationVersion) !== MIXED_NOTE_NORMALIZATION_VERSION || !value?.conditions) {
    return { ok: false, reason: 'mixed-filter-invalid' }
  }
  return { ok: true, definition: createMixedFilterDefinition(value.conditions, value, value.name) }
}

const PLAN_SQL = `SELECT p.*, COUNT(pi.id) total_count,
  SUM(CASE WHEN pi.status='unseen' THEN 1 ELSE 0 END) unseen_count,
  SUM(CASE WHEN pi.status='reviewed' THEN 1 ELSE 0 END) reviewed_count,
  SUM(CASE WHEN pi.status='mastered' THEN 1 ELSE 0 END) mastered_count,
  SUM(CASE WHEN pi.status='suspended' THEN 1 ELSE 0 END) suspended_count,
  SUM(CASE WHEN pi.is_special=1 THEN 1 ELSE 0 END) special_count
  FROM mixed_note_study_plans p LEFT JOIN mixed_note_plan_items pi ON pi.plan_id=p.id`

function mapPlan(row) {
  if (!row) return null
  let filterSnapshot = {}
  try { filterSnapshot = JSON.parse(row.source_filter_json || '{}') } catch { /* empty */ }
  return {
    id: Number(row.id), name: row.name, filterSnapshot,
    normalizationVersion: Number(row.normalization_version), createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at), totalCount: Number(row.total_count || 0),
    unseenCount: Number(row.unseen_count || 0), reviewedCount: Number(row.reviewed_count || 0),
    masteredCount: Number(row.mastered_count || 0), suspendedCount: Number(row.suspended_count || 0),
    specialCount: Number(row.special_count || 0),
  }
}

const getPlanRow = (db, id) => db.prepare(`${PLAN_SQL} WHERE p.id=? GROUP BY p.id`).get(id)

export function listMixedStudyPlans() {
  return useWordLibraryDatabase((db) => db.prepare(`${PLAN_SQL} GROUP BY p.id ORDER BY p.updated_at DESC, p.id DESC`)
    .all().map(mapPlan))
}

function matchingItemIds(db, filters) {
  const where = buildWhere(filters)
  return db.prepare(`SELECT DISTINCT mi.id FROM mixed_note_items mi
    JOIN mixed_note_occurrences mo ON mo.item_id=mi.id JOIN mixed_note_files mf ON mf.id=mo.source_file_id
    JOIN mixed_note_sources s ON s.id=mf.source_id WHERE ${where.sql}
    ORDER BY mi.normalized_wps COLLATE NOCASE, mi.normalized_wps`).all(...where.parameters)
    .map((row) => Number(row.id))
}

function replacePlanOccurrences(db, planId, filters, now) {
  db.prepare(`DELETE FROM mixed_note_plan_occurrences WHERE plan_item_id IN
    (SELECT id FROM mixed_note_plan_items WHERE plan_id=?)`).run(planId)
  const where = buildWhere(filters)
  const rows = db.prepare(`SELECT pi.id plan_item_id, s.display_name source_name, s.folder_path,
    mf.relative_path, mf.file_path, mf.note_type, mf.note_year, mf.note_month, mf.computer_name,
    mo.line_number, mo.source_wps, mo.comment, mo.raw_line
    FROM mixed_note_plan_items pi JOIN mixed_note_items mi ON mi.id=pi.item_id
    JOIN mixed_note_occurrences mo ON mo.item_id=mi.id JOIN mixed_note_files mf ON mf.id=mo.source_file_id
    JOIN mixed_note_sources s ON s.id=mf.source_id WHERE pi.plan_id=? AND ${where.sql}
    ORDER BY pi.item_order, s.display_name COLLATE NOCASE, mf.relative_path COLLATE NOCASE, mo.line_number`)
    .all(planId, ...where.parameters)
  const insert = db.prepare(`INSERT INTO mixed_note_plan_occurrences
    (plan_item_id, source_name, source_folder_path, relative_path, file_path, line_number,
     source_wps, comment, raw_line, note_type, note_year, note_month, computer_name, captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  rows.forEach((row) => insert.run(row.plan_item_id, row.source_name, row.folder_path, row.relative_path,
    row.file_path, row.line_number, row.source_wps, row.comment, row.raw_line, row.note_type,
    row.note_year, row.note_month, row.computer_name, now))
  return rows.length
}

export function createMixedStudyPlan(name, definition, filterFilePath = '') {
  const planName = String(name || '').trim()
  if (!planName) return { ok: false, reason: 'study-plan-name-required' }
  return useWordLibraryDatabase((db) => {
    const resolution = resolveConditionsInDb(db, definition)
    if (!resolution.ok) return resolution
    const itemIds = matchingItemIds(db, resolution.filters)
    const now = Date.now()
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = db.prepare(`INSERT INTO mixed_note_study_plans
        (name, source_filter_json, normalization_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
        .run(planName, JSON.stringify({ version: 1, filterFilePath, filterSnapshot: definition,
          occurrenceSnapshotVersion: 1 }), MIXED_NOTE_NORMALIZATION_VERSION, now, now)
      const planId = Number(result.lastInsertRowid)
      const insert = db.prepare(`INSERT INTO mixed_note_plan_items
        (plan_id,item_id,item_order,status,is_special,added_at,status_at) VALUES (?, ?, ?, 'unseen', 0, ?, ?)`)
      itemIds.forEach((itemId, index) => insert.run(planId, itemId, index + 1, now, now))
      const occurrenceSnapshotCount = replacePlanOccurrences(db, planId, resolution.filters, now)
      db.exec('COMMIT')
      return { ok: true, plan: mapPlan(getPlanRow(db, planId)), addedCount: itemIds.length, occurrenceSnapshotCount }
    } catch (error) { db.exec('ROLLBACK'); throw error }
  })
}

export function deleteMixedStudyPlan(id) {
  const planId = toId(id)
  if (!planId) return { ok: false, reason: 'invalid-study-plan-id' }
  return useWordLibraryDatabase((db) => {
    const plan = mapPlan(getPlanRow(db, planId))
    if (!plan) return { ok: false, reason: 'study-plan-not-found' }
    const active = db.prepare('SELECT id FROM mixed_note_study_sessions WHERE plan_id=? AND ended_at IS NULL').get(planId)
    db.prepare('DELETE FROM mixed_note_review_events WHERE plan_id=?').run(planId)
    db.prepare('DELETE FROM mixed_note_study_sessions WHERE plan_id=?').run(planId)
    db.prepare('DELETE FROM mixed_note_study_plans WHERE id=?').run(planId)
    return { ok: true, plan, hadActiveSession: Boolean(active) }
  })
}

export function refreshMixedStudyPlanScope(id) {
  const planId = toId(id)
  if (!planId) return { ok: false, reason: 'invalid-study-plan-id' }
  return useWordLibraryDatabase((db) => {
    const row = db.prepare('SELECT * FROM mixed_note_study_plans WHERE id=?').get(planId)
    if (!row) return { ok: false, reason: 'study-plan-not-found' }
    let snapshot
    try { snapshot = JSON.parse(row.source_filter_json) } catch { return { ok: false, reason: 'invalid-study-plan-filter-snapshot' } }
    const resolution = resolveConditionsInDb(db, snapshot.filterSnapshot)
    if (!resolution.ok) return resolution
    const ids = matchingItemIds(db, resolution.filters)
    const now = Date.now()
    const maxOrder = Number(db.prepare('SELECT COALESCE(MAX(item_order),0) value FROM mixed_note_plan_items WHERE plan_id=?')
      .get(planId)?.value || 0)
    const insert = db.prepare(`INSERT OR IGNORE INTO mixed_note_plan_items
      (plan_id,item_id,item_order,status,is_special,added_at,status_at) VALUES (?, ?, ?, 'unseen', 0, ?, ?)`)
    let addedCount = 0
    ids.forEach((itemId) => {
      const result = insert.run(planId, itemId, maxOrder + addedCount + 1, now, now)
      if (result.changes) addedCount += 1
    })
    const occurrenceSnapshotCount = replacePlanOccurrences(db, planId, resolution.filters, now)
    db.prepare('UPDATE mixed_note_study_plans SET updated_at=? WHERE id=?').run(now, planId)
    return { ok: true, plan: mapPlan(getPlanRow(db, planId)), matchedCount: ids.length, addedCount, occurrenceSnapshotCount }
  })
}

export function listMixedStudyPlanItems(id, options = {}) {
  const planId = toId(id)
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 250))
  const offset = Math.max(0, Number(options.offset) || 0)
  if (!planId) return { ok: false, reason: 'invalid-study-plan-id', items: [], total: 0 }
  return useWordLibraryDatabase((db) => {
    const plan = mapPlan(getPlanRow(db, planId))
    if (!plan) return { ok: false, reason: 'study-plan-not-found', items: [], total: 0 }
    const rows = db.prepare(`SELECT pi.*, mi.normalized_wps, mi.display_wps, COUNT(po.id) occurrence_count
      FROM mixed_note_plan_items pi JOIN mixed_note_items mi ON mi.id=pi.item_id
      LEFT JOIN mixed_note_plan_occurrences po ON po.plan_item_id=pi.id WHERE pi.plan_id=?
      GROUP BY pi.id ORDER BY pi.item_order, pi.id LIMIT ? OFFSET ?`).all(planId, limit, offset)
    return { ok: true, plan, items: rows.map((row) => ({
      id: Number(row.id), wordId: Number(row.item_id), itemOrder: Number(row.item_order), status: row.status,
      isSpecial: Boolean(row.is_special), addedAt: Number(row.added_at), statusAt: Number(row.status_at),
      lastReviewedAt: row.last_reviewed_at == null ? null : Number(row.last_reviewed_at), language: 'mixed',
      normalizationVersion: MIXED_NOTE_NORMALIZATION_VERSION, normalizedWord: row.normalized_wps,
      displayWord: row.display_wps, occurrenceCount: Number(row.occurrence_count || 0),
    })), total: plan.totalCount, limit, offset }
  })
}

export function getMixedPlanItemOccurrences(planIdValue, itemIdValue) {
  const planId = toId(planIdValue); const planItemId = toId(itemIdValue)
  if (!planId || !planItemId) return { ok: false, reason: 'invalid-study-plan-item', occurrences: [] }
  return useWordLibraryDatabase((db) => {
    const item = db.prepare('SELECT id FROM mixed_note_plan_items WHERE id=? AND plan_id=?').get(planItemId, planId)
    if (!item) return { ok: false, reason: 'study-plan-item-not-found', occurrences: [] }
    const rows = db.prepare(`SELECT * FROM mixed_note_plan_occurrences WHERE plan_item_id=?
      ORDER BY source_name COLLATE NOCASE, relative_path COLLATE NOCASE, line_number, id`).all(planItemId)
    return { ok: true, occurrences: rows.map((row) => ({
      id: Number(row.id), planItemId: Number(row.plan_item_id), sourceName: row.source_name,
      folderPath: row.source_folder_path, relativePath: row.relative_path, filePath: row.file_path,
      lineNumber: Number(row.line_number), sourceWord: row.source_wps,
      markers: [row.note_type, row.note_year && row.note_month ? `${row.note_year}-${row.note_month}` : '', row.computer_name].filter(Boolean),
      annotation: row.comment, rawLine: row.raw_line, capturedAt: Number(row.captured_at),
    })) }
  })
}

function parseSession(value) {
  try {
    const parsed = JSON.parse(value || '{}')
    if (Number(parsed.version) !== 1 || !Array.isArray(parsed.queueItemIds)) throw new Error('invalid')
    return { version: 1, queueItemIds: parsed.queueItemIds.map(toId).filter(Boolean),
      currentIndex: Math.max(0, Number(parsed.currentIndex) || 0), isValid: true }
  } catch { return { version: 1, queueItemIds: [], currentIndex: 0, isValid: false } }
}

const sessionRow = (db, id) => db.prepare(`SELECT ss.*, p.name plan_name FROM mixed_note_study_sessions ss
  JOIN mixed_note_study_plans p ON p.id=ss.plan_id WHERE ss.id=?`).get(id)
const activeSessionRow = (db) => db.prepare(`SELECT ss.*, p.name plan_name FROM mixed_note_study_sessions ss
  JOIN mixed_note_study_plans p ON p.id=ss.plan_id WHERE ss.ended_at IS NULL ORDER BY ss.started_at DESC LIMIT 1`).get()

function reviewItemRow(db, row, id) {
  return db.prepare(`SELECT pi.*, mi.normalized_wps, mi.display_wps, COUNT(po.id) occurrence_count
    FROM mixed_note_plan_items pi JOIN mixed_note_items mi ON mi.id=pi.item_id
    LEFT JOIN mixed_note_plan_occurrences po ON po.plan_item_id=pi.id
    WHERE pi.id=? AND pi.plan_id=? GROUP BY pi.id`).get(id, row.plan_id)
}

const mapReviewItem = (row) => row ? ({
  id: Number(row.id), planId: Number(row.plan_id), wordId: Number(row.item_id), itemOrder: Number(row.item_order),
  status: row.status, isSpecial: Boolean(row.is_special), language: 'mixed',
  normalizationVersion: MIXED_NOTE_NORMALIZATION_VERSION, normalizedWord: row.normalized_wps,
  displayWord: row.display_wps, occurrenceCount: Number(row.occurrence_count || 0),
  lastReviewedAt: row.last_reviewed_at == null ? null : Number(row.last_reviewed_at),
}) : null

function mapSession(db, row) {
  if (!row) return null
  const state = parseSession(row.session_json)
  const index = Math.min(state.currentIndex, state.queueItemIds.length)
  const currentId = state.queueItemIds[index]
  return { id: Number(row.id), planId: Number(row.plan_id), planName: row.plan_name || '',
    startedAt: Number(row.started_at), endedAt: row.ended_at == null ? null : Number(row.ended_at),
    isActive: row.ended_at == null, queueLength: state.queueItemIds.length, currentIndex: index,
    completedCount: index, remainingCount: Math.max(0, state.queueItemIds.length - index),
    currentItem: currentId ? mapReviewItem(reviewItemRow(db, row, currentId)) : null }
}

export function getActiveMixedStudySession() {
  return useWordLibraryDatabase((db) => ({ ok: true, session: mapSession(db, activeSessionRow(db)) }))
}

export function startMixedStudySession(id) {
  const planId = toId(id)
  if (!planId) return { ok: false, reason: 'invalid-study-plan-id' }
  return useWordLibraryDatabase((db) => {
    if (!getPlanRow(db, planId)) return { ok: false, reason: 'study-plan-not-found' }
    const active = activeSessionRow(db)
    if (active) return Number(active.plan_id) === planId
      ? { ok: true, resumed: true, session: mapSession(db, active) }
      : { ok: false, reason: 'another-study-session-active', session: mapSession(db, active) }
    const ids = db.prepare(`SELECT id FROM mixed_note_plan_items WHERE plan_id=? AND status<>'suspended'
      AND (status='unseen' OR is_special=1) ORDER BY item_order,id`).all(planId).map((row) => Number(row.id))
    if (!ids.length) return { ok: false, reason: 'no-review-items' }
    const result = db.prepare(`INSERT INTO mixed_note_study_sessions (plan_id,started_at,ended_at,session_json)
      VALUES (?, ?, NULL, ?)`).run(planId, Date.now(), JSON.stringify({ version: 1, queueItemIds: ids, currentIndex: 0 }))
    return { ok: true, resumed: false, session: mapSession(db, sessionRow(db, result.lastInsertRowid)) }
  })
}

export function applyMixedReviewAction(id, action) {
  const sessionId = toId(id); const normalizedAction = String(action || '')
  if (!sessionId || !['reviewed', 'skip', 'toggle-special'].includes(normalizedAction)) {
    return { ok: false, reason: 'invalid-study-review-action' }
  }
  return useWordLibraryDatabase((db) => {
    const row = sessionRow(db, sessionId)
    if (!row || row.ended_at != null) return { ok: false, reason: 'study-session-not-found' }
    const state = parseSession(row.session_json)
    const current = reviewItemRow(db, row, state.queueItemIds[state.currentIndex])
    if (!current) return { ok: false, reason: 'study-session-current-item-missing' }
    const now = Date.now(); const previous = current.status; const wasSpecial = Boolean(current.is_special)
    let eventType = normalizedAction; let next = previous; let advance = false
    if (normalizedAction === 'reviewed') {
      next = 'reviewed'; advance = true
      db.prepare(`UPDATE mixed_note_plan_items SET status='reviewed',status_at=?,last_reviewed_at=? WHERE id=?`)
        .run(now, now, current.id)
    } else if (normalizedAction === 'skip') advance = true
    else {
      eventType = wasSpecial ? 'special-off' : 'special-on'
      db.prepare('UPDATE mixed_note_plan_items SET is_special=?,status_at=? WHERE id=?')
        .run(wasSpecial ? 0 : 1, now, current.id)
    }
    db.prepare(`INSERT INTO mixed_note_review_events
      (session_id,plan_id,item_id,normalized_wps,event_type,previous_status,next_status,was_special,details_json,created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(sessionId, row.plan_id, current.item_id, current.normalized_wps, eventType, previous, next,
        wasSpecial ? 1 : 0, JSON.stringify({ queueIndex: state.currentIndex }), now)
    if (advance) state.currentIndex += 1
    const completed = state.currentIndex >= state.queueItemIds.length
    db.prepare('UPDATE mixed_note_study_sessions SET session_json=?,ended_at=? WHERE id=?')
      .run(JSON.stringify(state), completed ? now : null, sessionId)
    db.prepare('UPDATE mixed_note_study_plans SET updated_at=? WHERE id=?').run(now, row.plan_id)
    return { ok: true, action: eventType, completed, session: mapSession(db, sessionRow(db, sessionId)) }
  })
}

export function reviewMixedStudyPlanTo(planIdValue, planItemIdValue) {
  const planId = toId(planIdValue); const planItemId = toId(planItemIdValue)
  if (!planId || !planItemId) return { ok: false, reason: 'invalid-study-plan-item' }
  return useWordLibraryDatabase((db) => {
    const target = db.prepare('SELECT * FROM mixed_note_plan_items WHERE id=? AND plan_id=?').get(planItemId, planId)
    if (!target) return { ok: false, reason: 'study-plan-item-not-found' }
    if (target.status === 'suspended') return { ok: false, reason: 'suspended-study-plan-item' }
    const active = activeSessionRow(db)
    if (active && Number(active.plan_id) !== planId) {
      return { ok: false, reason: 'another-study-session-active', session: mapSession(db, active) }
    }
    const queue = db.prepare(`SELECT id FROM mixed_note_plan_items WHERE plan_id=? AND status<>'suspended'
      AND (id=? OR ((item_order>? OR (item_order=? AND id>?)) AND (status='unseen' OR is_special=1)))
      ORDER BY item_order,id`).all(planId, planItemId, target.item_order, target.item_order, planItemId)
      .map((row) => Number(row.id))
    const now = Date.now(); let sessionId
    if (active) {
      sessionId = Number(active.id)
      db.prepare('UPDATE mixed_note_study_sessions SET session_json=? WHERE id=?')
        .run(JSON.stringify({ version: 1, queueItemIds: queue, currentIndex: 0 }), sessionId)
    } else {
      const result = db.prepare(`INSERT INTO mixed_note_study_sessions (plan_id,started_at,ended_at,session_json)
        VALUES (?, ?, NULL, ?)`).run(planId, now, JSON.stringify({ version: 1, queueItemIds: queue, currentIndex: 0 }))
      sessionId = Number(result.lastInsertRowid)
    }
    db.prepare(`INSERT INTO mixed_note_review_events
      (session_id,plan_id,item_id,normalized_wps,event_type,previous_status,next_status,was_special,details_json,created_at)
      SELECT ?, ?, mi.id, mi.normalized_wps, 'review-to', pi.status, pi.status, pi.is_special, ?, ?
      FROM mixed_note_plan_items pi JOIN mixed_note_items mi ON mi.id=pi.item_id WHERE pi.id=?`)
      .run(sessionId, planId, JSON.stringify({ targetPlanItemId: planItemId }), now, planItemId)
    return { ok: true, session: mapSession(db, sessionRow(db, sessionId)) }
  })
}

export function endMixedStudySession(id) {
  const sessionId = toId(id)
  if (!sessionId) return { ok: false, reason: 'invalid-study-session-id' }
  return useWordLibraryDatabase((db) => {
    const row = sessionRow(db, sessionId)
    if (!row) return { ok: false, reason: 'study-session-not-found' }
    if (row.ended_at == null) db.prepare('UPDATE mixed_note_study_sessions SET ended_at=? WHERE id=?').run(Date.now(), sessionId)
    return { ok: true, session: mapSession(db, sessionRow(db, sessionId)) }
  })
}

export function listMixedStudyReviewHistory(planIdValue, options = {}) {
  const planId = toId(planIdValue)
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 50))
  if (!planId) return { ok: false, reason: 'invalid-study-plan-id', sessions: [] }
  return useWordLibraryDatabase((db) => {
    const sessions = db.prepare(`SELECT ss.*, COUNT(re.id) event_count,
      SUM(CASE WHEN re.event_type='reviewed' THEN 1 ELSE 0 END) reviewed_count,
      SUM(CASE WHEN re.event_type='skip' THEN 1 ELSE 0 END) skip_count,
      SUM(CASE WHEN re.event_type='special-on' THEN 1 ELSE 0 END) special_on_count,
      SUM(CASE WHEN re.event_type='special-off' THEN 1 ELSE 0 END) special_off_count
      FROM mixed_note_study_sessions ss LEFT JOIN mixed_note_review_events re ON re.session_id=ss.id
      WHERE ss.plan_id=? GROUP BY ss.id ORDER BY ss.started_at DESC LIMIT ?`).all(planId, limit).map((row) => {
        const state = parseSession(row.session_json)
        const queueLength = state.queueItemIds.length
        const completedCount = Math.min(state.currentIndex, queueLength)
        const endedAt = row.ended_at == null ? null : Number(row.ended_at)
        return { id: Number(row.id), planId: Number(row.plan_id), startedAt: Number(row.started_at), endedAt,
          status: endedAt == null ? 'active' : completedCount >= queueLength && state.isValid ? 'completed' : 'ended',
          stateValid: state.isValid, queueLength, completedCount, eventCount: Number(row.event_count || 0),
          reviewedCount: Number(row.reviewed_count || 0), skipCount: Number(row.skip_count || 0),
          specialOnCount: Number(row.special_on_count || 0), specialOffCount: Number(row.special_off_count || 0) }
      })
    const summary = db.prepare(`SELECT COUNT(DISTINCT ss.id) session_count, MAX(ss.started_at) last_reviewed_at,
      SUM(CASE WHEN event_type='reviewed' THEN 1 ELSE 0 END) reviewed_count,
      SUM(CASE WHEN event_type='skip' THEN 1 ELSE 0 END) skip_count
      FROM mixed_note_study_sessions ss LEFT JOIN mixed_note_review_events re ON re.session_id=ss.id
      WHERE ss.plan_id=?`).get(planId)
    return { ok: true, sessions, summary: {
      sessionCount: Number(summary?.session_count || 0),
      lastReviewedAt: summary?.last_reviewed_at == null ? null : Number(summary.last_reviewed_at),
      reviewedCount: Number(summary?.reviewed_count || 0), skipCount: Number(summary?.skip_count || 0),
    } }
  })
}

export function listMixedStudyReviewEvents(sessionIdValue) {
  const sessionId = toId(sessionIdValue)
  if (!sessionId) return { ok: false, reason: 'invalid-study-session-id', events: [] }
  return useWordLibraryDatabase((db) => ({ ok: true, events: db.prepare(`SELECT re.*, mi.display_wps
    FROM mixed_note_review_events re LEFT JOIN mixed_note_items mi ON mi.id=re.item_id
    WHERE re.session_id=? ORDER BY re.created_at,re.id`).all(sessionId).map((row) => ({
      id: Number(row.id), sessionId: Number(row.session_id), planId: Number(row.plan_id),
      displayWord: row.display_wps || row.normalized_wps, normalizedWord: row.normalized_wps,
      eventType: row.event_type, previousStatus: row.previous_status, nextStatus: row.next_status,
      wasSpecial: Boolean(row.was_special), createdAt: Number(row.created_at),
    })) }))
}




import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const WORD_LIBRARY_SCHEMA_VERSION = 3

let database = null
let currentDatabasePath = ''

const LATIN_LETTER_PATTERN = /\p{Script=Latin}/u
const HAN_LETTER_PATTERN = /\p{Script=Han}/u
const ANY_LETTER_PATTERN = /\p{Letter}/u

function textMatchesCharacterType(value, characterType) {
  const text = String(value ?? '')
  const type = String(characterType || '')
  if (!type) return 1

  let hasLatin = false
  let hasHan = false
  let hasOtherLetter = false
  for (const character of text) {
    if (LATIN_LETTER_PATTERN.test(character)) hasLatin = true
    else if (HAN_LETTER_PATTERN.test(character)) hasHan = true
    else if (ANY_LETTER_PATTERN.test(character)) hasOtherLetter = true
  }

  if (type === 'english') return hasLatin && !hasHan && !hasOtherLetter ? 1 : 0
  if (type === 'chinese') return hasHan ? 1 : 0
  if (type === 'mixed') return hasLatin && hasHan ? 1 : 0
  return 1
}

const INITIAL_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS app_meta (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sources (
    id               INTEGER PRIMARY KEY,
    folder_path      TEXT NOT NULL,
    folder_path_key  TEXT NOT NULL UNIQUE,
    display_name     TEXT NOT NULL,
    is_enabled       INTEGER NOT NULL DEFAULT 0 CHECK (is_enabled IN (0, 1)),
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL,
    last_scanned_at  INTEGER,
    last_scan_status TEXT,
    last_scan_error  TEXT
  );

  CREATE TABLE IF NOT EXISTS source_files (
    id             INTEGER PRIMARY KEY,
    source_id      INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    relative_path  TEXT NOT NULL,
    file_path      TEXT NOT NULL,
    file_size      INTEGER,
    modified_at_ms INTEGER,
    encoding       TEXT,
    content_hash   TEXT,
    indexed_at     INTEGER,
    UNIQUE (source_id, relative_path)
  );

  CREATE INDEX IF NOT EXISTS idx_source_files_source
    ON source_files(source_id);

  CREATE TABLE IF NOT EXISTS words (
    id                    INTEGER PRIMARY KEY,
    language              TEXT NOT NULL DEFAULT 'en',
    normalization_version INTEGER NOT NULL,
    normalized_word       TEXT NOT NULL,
    display_word          TEXT NOT NULL,
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL,
    UNIQUE (language, normalization_version, normalized_word)
  );

  CREATE INDEX IF NOT EXISTS idx_words_display_word
    ON words(display_word);

  CREATE TABLE IF NOT EXISTS word_occurrences (
    id             INTEGER PRIMARY KEY,
    source_file_id INTEGER NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
    word_id        INTEGER NOT NULL REFERENCES words(id) ON DELETE RESTRICT,
    line_number    INTEGER NOT NULL CHECK (line_number > 0),
    source_word    TEXT NOT NULL,
    marker_1       TEXT NOT NULL DEFAULT '',
    marker_2       TEXT NOT NULL DEFAULT '',
    marker_3       TEXT NOT NULL DEFAULT '',
    marker_4       TEXT NOT NULL DEFAULT '',
    marker_5       TEXT NOT NULL DEFAULT '',
    marker_6       TEXT NOT NULL DEFAULT '',
    annotation     TEXT NOT NULL DEFAULT '',
    raw_line       TEXT NOT NULL,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    UNIQUE (source_file_id, line_number)
  );

  CREATE INDEX IF NOT EXISTS idx_word_occurrences_word
    ON word_occurrences(word_id);

  CREATE INDEX IF NOT EXISTS idx_word_occurrences_source_file
    ON word_occurrences(source_file_id);

  CREATE TABLE IF NOT EXISTS tags (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    name_key   TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS word_occurrence_tags (
    occurrence_id INTEGER NOT NULL REFERENCES word_occurrences(id) ON DELETE CASCADE,
    tag_id        INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (occurrence_id, tag_id)
  );

  CREATE INDEX IF NOT EXISTS idx_word_occurrence_tags_tag
    ON word_occurrence_tags(tag_id);

  CREATE TABLE IF NOT EXISTS saved_filters (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    filter_json TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS study_plans (
    id                   INTEGER PRIMARY KEY,
    name                 TEXT NOT NULL,
    source_filter_json   TEXT NOT NULL,
    normalization_version INTEGER NOT NULL,
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS study_plan_items (
    id             INTEGER PRIMARY KEY,
    plan_id        INTEGER NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
    word_id        INTEGER NOT NULL REFERENCES words(id) ON DELETE RESTRICT,
    item_order     INTEGER NOT NULL,
    status         TEXT NOT NULL DEFAULT 'unseen'
                   CHECK (status IN ('unseen', 'reviewed', 'mastered', 'suspended')),
    is_special     INTEGER NOT NULL DEFAULT 0 CHECK (is_special IN (0, 1)),
    added_at       INTEGER NOT NULL,
    status_at      INTEGER NOT NULL,
    last_reviewed_at INTEGER,
    UNIQUE (plan_id, word_id)
  );

  CREATE INDEX IF NOT EXISTS idx_study_plan_items_queue
    ON study_plan_items(plan_id, status, is_special, item_order);

  CREATE TABLE IF NOT EXISTS study_sessions (
    id          INTEGER PRIMARY KEY,
    plan_id     INTEGER NOT NULL REFERENCES study_plans(id) ON DELETE RESTRICT,
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER,
    session_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS review_events (
    id                    INTEGER PRIMARY KEY,
    session_id            INTEGER REFERENCES study_sessions(id) ON DELETE SET NULL,
    plan_id               INTEGER REFERENCES study_plans(id) ON DELETE SET NULL,
    word_id               INTEGER REFERENCES words(id) ON DELETE SET NULL,
    language              TEXT NOT NULL,
    normalization_version INTEGER NOT NULL,
    normalized_word       TEXT NOT NULL,
    event_type            TEXT NOT NULL,
    previous_status       TEXT,
    next_status           TEXT,
    was_special           INTEGER NOT NULL DEFAULT 0 CHECK (was_special IN (0, 1)),
    details_json          TEXT NOT NULL DEFAULT '{}',
    created_at            INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_review_events_plan_time
    ON review_events(plan_id, created_at);

  CREATE INDEX IF NOT EXISTS idx_review_events_word_time
    ON review_events(language, normalization_version, normalized_word, created_at);
`

function migrateDatabase(targetDatabase) {
  const currentVersion = Number(targetDatabase.prepare('PRAGMA user_version').get()?.user_version || 0)

  if (currentVersion > WORD_LIBRARY_SCHEMA_VERSION) {
    throw new Error(
      `Word Library database schema ${currentVersion} is newer than supported schema ${WORD_LIBRARY_SCHEMA_VERSION}.`
    )
  }

  if (currentVersion === 0) {
    targetDatabase.exec('BEGIN IMMEDIATE')
    try {
      targetDatabase.exec(INITIAL_SCHEMA_SQL)
      targetDatabase.exec(`PRAGMA user_version = ${WORD_LIBRARY_SCHEMA_VERSION}`)
      targetDatabase.exec('COMMIT')
    } catch (error) {
      targetDatabase.exec('ROLLBACK')
      throw error
    }
  }

  if (currentVersion === 1 || currentVersion === 2) {
    targetDatabase.exec('BEGIN IMMEDIATE')
    try {
      targetDatabase.exec(`
        DROP TABLE IF EXISTS study_plan_item_occurrences;
        PRAGMA user_version = 3;
      `)
      targetDatabase.exec('COMMIT')
    } catch (error) {
      targetDatabase.exec('ROLLBACK')
      throw error
    }
  }

  return {
    previousVersion: currentVersion,
    schemaVersion: WORD_LIBRARY_SCHEMA_VERSION,
    migrated: currentVersion !== WORD_LIBRARY_SCHEMA_VERSION,
  }
}

export function getWordLibraryDatabasePath(appInstance) {
  const baseFolder = appInstance.isPackaged
    ? path.dirname(appInstance.getPath('exe'))
    : appInstance.getAppPath()
  return path.join(baseFolder, 'data', 'word-library.sqlite3')
}

export function initializeWordLibraryDatabase(databasePath) {
  if (database) {
    return {
      ok: true,
      databasePath: currentDatabasePath,
      schemaVersion: WORD_LIBRARY_SCHEMA_VERSION,
      alreadyOpen: true,
    }
  }

  const resolvedPath = path.resolve(databasePath)
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true })

  const nextDatabase = new DatabaseSync(resolvedPath, { timeout: 5000 })
  try {
    nextDatabase.exec('PRAGMA foreign_keys = ON')
    nextDatabase.exec('PRAGMA journal_mode = WAL')
    nextDatabase.exec('PRAGMA synchronous = NORMAL')
    nextDatabase.exec('PRAGMA busy_timeout = 5000')
    nextDatabase.function('bn_text_matches_character_type', { deterministic: true }, textMatchesCharacterType)
    const migration = migrateDatabase(nextDatabase)

    database = nextDatabase
    currentDatabasePath = resolvedPath

    return {
      ok: true,
      databasePath: resolvedPath,
      ...migration,
    }
  } catch (error) {
    nextDatabase.close()
    throw error
  }
}

export function getWordLibraryDatabaseStatus() {
  if (!database) {
    return {
      ok: false,
      ready: false,
      reason: 'word-library-database-not-open',
      databasePath: currentDatabasePath,
      schemaVersion: WORD_LIBRARY_SCHEMA_VERSION,
    }
  }

  const integrityRow = database.prepare('PRAGMA quick_check').get()
  return {
    ok: integrityRow?.quick_check === 'ok',
    ready: true,
    databasePath: currentDatabasePath,
    schemaVersion: Number(database.prepare('PRAGMA user_version').get()?.user_version || 0),
    integrity: integrityRow?.quick_check || 'unknown',
  }
}

export function useWordLibraryDatabase(operation) {
  if (!database) {
    throw new Error('Word Library database is not open.')
  }
  if (typeof operation !== 'function') {
    throw new TypeError('Word Library database operation must be a function.')
  }
  return operation(database)
}

export function closeWordLibraryDatabase() {
  if (!database) return
  database.close()
  database = null
  currentDatabasePath = ''
}

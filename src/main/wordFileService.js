import fs from 'node:fs/promises'
import path from 'node:path'
import iconv from 'iconv-lite'

const TEXT_ENCODING = 'gb18030'

function normalizeFilePath(filePath) {
  return typeof filePath === 'string'
    ? filePath.trim().replace(/^["']|["']$/g, '')
    : ''
}

function isTxtFile(filePath) {
  return typeof filePath === 'string' && path.extname(filePath).toLowerCase() === '.txt'
}

function splitWordLine(line, index) {
  const parts = String(line ?? '').split('|')
  const markers = parts.slice(1, 7)
  while (markers.length < 6) markers.push('')

  return {
    id: `line-${index}`,
    word: parts[0] || '',
    markers,
    annotation: parts.length > 7 ? parts.slice(7).join('|') : '',
    raw: line,
  }
}

function joinWordRecord(record) {
  const markers = Array.isArray(record?.markers) ? record.markers.slice(0, 6) : []
  while (markers.length < 6) markers.push('')

  return [
    record?.word || '',
    ...markers.map((item) => item || ''),
    record?.annotation || '',
  ].join('|')
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function listTxtFilesInFolder(folderPath) {
  const normalizedFolder = normalizeFilePath(folderPath)
  if (!normalizedFolder) return []

  const entries = await fs.readdir(normalizedFolder, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && isTxtFile(entry.name))
    .map((entry) => ({
      fileName: entry.name,
      filePath: path.join(normalizedFolder, entry.name),
    }))
    .sort((a, b) => a.fileName.localeCompare(b.fileName, 'en', { sensitivity: 'base' }))
}

export async function readWordFile(filePath) {
  const normalizedPath = normalizeFilePath(filePath)
  if (!isTxtFile(normalizedPath) || !(await fileExists(normalizedPath))) {
    return { ok: false, reason: 'invalid-text-file' }
  }

  const parsedPath = path.parse(normalizedPath)
  const buffer = await fs.readFile(normalizedPath)
  const text = iconv.decode(buffer, TEXT_ENCODING)
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  return {
    ok: true,
    filePath: normalizedPath,
    fileName: parsedPath.base,
    folderPath: parsedPath.dir,
    encoding: TEXT_ENCODING,
    records: lines.map(splitWordLine),
    txtFiles: await listTxtFilesInFolder(parsedPath.dir),
  }
}

export async function saveWordFile(filePath, records) {
  const normalizedPath = normalizeFilePath(filePath)
  if (!isTxtFile(normalizedPath)) {
    return { ok: false, reason: 'invalid-text-file' }
  }

  const text = (Array.isArray(records) ? records : []).map(joinWordRecord).join('\r\n')
  await fs.writeFile(normalizedPath, iconv.encode(text, TEXT_ENCODING))

  return {
    ok: true,
    filePath: normalizedPath,
    fileName: path.basename(normalizedPath),
    folderPath: path.dirname(normalizedPath),
    encoding: TEXT_ENCODING,
  }
}

export async function appendTextLine(filePath, line) {
  const normalizedPath = normalizeFilePath(filePath)
  if (!isTxtFile(normalizedPath)) {
    return { ok: false, reason: 'invalid-text-file' }
  }

  const text = String(line ?? '')
  const folderPath = path.dirname(normalizedPath)
  let folderStat
  try {
    folderStat = await fs.stat(folderPath)
  } catch {
    return { ok: false, reason: 'target-folder-not-found' }
  }
  if (!folderStat.isDirectory()) {
    return { ok: false, reason: 'target-folder-not-directory' }
  }

  const exists = await fileExists(normalizedPath)
  const stat = exists ? await fs.stat(normalizedPath) : null
  const prefix = stat?.size > 0 ? '\r\n' : ''
  await fs.appendFile(normalizedPath, iconv.encode(`${prefix}${text}`, TEXT_ENCODING))

  return {
    ok: true,
    filePath: normalizedPath,
    fileName: path.basename(normalizedPath),
    folderPath,
    encoding: TEXT_ENCODING,
  }
}

export function getTextEncoding() {
  return TEXT_ENCODING
}

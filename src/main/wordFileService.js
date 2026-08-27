import fs from 'node:fs/promises'
import path from 'node:path'
import iconv from 'iconv-lite'
import jschardet from 'jschardet'

const TEXT_ENCODING = 'gb18030'
const UTF8_TEXT_ENCODING = 'utf8'
const UTF8_FILE_SUFFIX = '.utf8.txt'

function normalizeFilePath(filePath) {
  return typeof filePath === 'string'
    ? filePath.trim().replace(/^["']|["']$/g, '')
    : ''
}

function isTxtFile(filePath) {
  return typeof filePath === 'string' && path.extname(filePath).toLowerCase() === '.txt'
}

function isUtf8TextFile(filePath) {
  return typeof filePath === 'string' && filePath.toLowerCase().endsWith(UTF8_FILE_SUFFIX)
}

function getUtf8TextFilePath(filePath) {
  const parsedPath = path.parse(filePath)
  const baseName = parsedPath.name.replace(/\.utf8$/i, '')
  return path.join(parsedPath.dir, `${baseName}.utf8.txt`)
}

function normalizeDetectedEncoding(encoding) {
  const value = String(encoding || '').toLowerCase().replace(/[_\s-]/g, '')
  if (!value) return ''
  if (value.includes('utf8') || value.includes('unicode')) return UTF8_TEXT_ENCODING
  if (value.includes('gb18030') || value.includes('gb2312') || value.includes('gbk')) return TEXT_ENCODING
  if (value.includes('big5')) return 'big5'
  return ''
}

function detectTextEncoding(buffer, filePath = '') {
  if (isUtf8TextFile(filePath)) {
    return {
      encoding: UTF8_TEXT_ENCODING,
      detectedEncoding: UTF8_TEXT_ENCODING,
      confidence: 1,
      source: 'file-name',
    }
  }

  if (buffer?.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return {
      encoding: UTF8_TEXT_ENCODING,
      detectedEncoding: 'UTF-8-BOM',
      confidence: 1,
      source: 'bom',
    }
  }

  const detection = jschardet.detect(buffer)
  const normalizedEncoding = normalizeDetectedEncoding(detection?.encoding)
  return {
    encoding: normalizedEncoding || TEXT_ENCODING,
    detectedEncoding: detection?.encoding || '',
    confidence: Number.isFinite(detection?.confidence) ? detection.confidence : 0,
    source: normalizedEncoding ? 'jschardet' : 'fallback',
  }
}

function decodeTextBuffer(buffer, filePath = '') {
  const encodingInfo = detectTextEncoding(buffer, filePath)
  return {
    ...encodingInfo,
    text: iconv.decode(buffer, encodingInfo.encoding),
  }
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

export async function listTxtFilesInFolder(folderPath, options = {}) {
  const normalizedFolder = normalizeFilePath(folderPath)
  if (!normalizedFolder) return []
  const filterMode = options.filterMode || 'all'

  const entries = await fs.readdir(normalizedFolder, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && isTxtFile(entry.name))
    .filter((entry) => {
      if (filterMode === 'utf8') return isUtf8TextFile(entry.name)
      if (filterMode === 'legacy') return !isUtf8TextFile(entry.name)
      return true
    })
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
  const decoded = decodeTextBuffer(buffer, normalizedPath)
  const text = decoded.text
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  const filterMode = isUtf8TextFile(normalizedPath) ? 'utf8' : 'legacy'

  return {
    ok: true,
    filePath: normalizedPath,
    fileName: parsedPath.base,
    folderPath: parsedPath.dir,
    encoding: decoded.encoding,
    detectedEncoding: decoded.detectedEncoding,
    encodingConfidence: decoded.confidence,
    encodingSource: decoded.source,
    records: lines.map(splitWordLine),
    txtFiles: await listTxtFilesInFolder(parsedPath.dir, { filterMode }),
  }
}

export async function saveWordFile(filePath, records) {
  const normalizedPath = normalizeFilePath(filePath)
  if (!isTxtFile(normalizedPath)) {
    return { ok: false, reason: 'invalid-text-file' }
  }

  const text = (Array.isArray(records) ? records : []).map(joinWordRecord).join('\r\n')
  const encoding = isUtf8TextFile(normalizedPath) ? UTF8_TEXT_ENCODING : TEXT_ENCODING
  const content = encoding === UTF8_TEXT_ENCODING ? text : iconv.encode(text, encoding)
  await fs.writeFile(normalizedPath, content, encoding === UTF8_TEXT_ENCODING ? UTF8_TEXT_ENCODING : undefined)

  return {
    ok: true,
    filePath: normalizedPath,
    fileName: path.basename(normalizedPath),
    folderPath: path.dirname(normalizedPath),
    encoding,
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

export async function appendUtf8TextLine(filePath, line) {
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
  await fs.appendFile(normalizedPath, `${prefix}${text}`, UTF8_TEXT_ENCODING)

  return {
    ok: true,
    filePath: normalizedPath,
    fileName: path.basename(normalizedPath),
    folderPath,
    encoding: UTF8_TEXT_ENCODING,
  }
}

export async function convertFolderTxtToUtf8(folderPath) {
  const normalizedFolder = normalizeFilePath(folderPath)
  if (!normalizedFolder) return { ok: false, reason: 'folder-not-set' }

  let folderStat
  try {
    folderStat = await fs.stat(normalizedFolder)
  } catch {
    return { ok: false, reason: 'folder-not-found' }
  }
  if (!folderStat.isDirectory()) {
    return { ok: false, reason: 'folder-not-directory' }
  }

  const entries = await fs.readdir(normalizedFolder, { withFileTypes: true })
  const details = []
  const summary = {
    converted: 0,
    skippedUtf8: 0,
    skippedExisting: 0,
    failed: 0,
  }

  for (const entry of entries) {
    if (!entry.isFile() || !isTxtFile(entry.name)) continue

    const sourcePath = path.join(normalizedFolder, entry.name)
    if (isUtf8TextFile(entry.name)) {
      summary.skippedUtf8 += 1
      details.push({ fileName: entry.name, status: 'skipped-utf8' })
      continue
    }

    const targetPath = getUtf8TextFilePath(sourcePath)
    if (await fileExists(targetPath)) {
      summary.skippedExisting += 1
      details.push({
        fileName: entry.name,
        status: 'skipped-existing',
        targetFileName: path.basename(targetPath),
      })
      continue
    }

    try {
      const buffer = await fs.readFile(sourcePath)
      const decoded = decodeTextBuffer(buffer, sourcePath)
      await fs.writeFile(targetPath, decoded.text, UTF8_TEXT_ENCODING)
      summary.converted += 1
      details.push({
        fileName: entry.name,
        status: 'converted',
        targetFileName: path.basename(targetPath),
        sourceEncoding: decoded.encoding,
        detectedEncoding: decoded.detectedEncoding,
        confidence: decoded.confidence,
        encodingSource: decoded.source,
      })
    } catch (error) {
      summary.failed += 1
      details.push({
        fileName: entry.name,
        status: 'failed',
        reason: error?.message || String(error),
      })
    }
  }

  return {
    ok: true,
    folderPath: normalizedFolder,
    ...summary,
    details,
    txtFiles: await listTxtFilesInFolder(normalizedFolder, { filterMode: 'utf8' }),
  }
}

export function getTextEncoding() {
  return TEXT_ENCODING
}

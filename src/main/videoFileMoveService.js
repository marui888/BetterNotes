import fs from 'node:fs/promises'
import { constants, createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

const pathKey = (value) => path.resolve(value).toLowerCase()

export async function listVideoFileFamily(filePath) {
  const folder = path.dirname(filePath)
  const name = path.basename(filePath).toLowerCase()
  const base = path.parse(filePath).name.toLowerCase()
  const entries = await fs.readdir(folder, { withFileTypes: true })
  return entries.filter((entry) => {
    if (!entry.isFile()) return false
    const entryName = entry.name.toLowerCase()
    if (entryName === name || entryName === `${base}.json`) return true
    const extension = path.extname(entryName)
    if (!['.srt', '.vtt'].includes(extension)) return false
    const subtitleBase = entryName.slice(0, -extension.length)
    return subtitleBase === base || subtitleBase.startsWith(`${base}.`)
  }).map((entry) => path.join(folder, entry.name))
}

export async function readVideoMovePaths(listPath) {
  if (!listPath || !path.isAbsolute(listPath)) {
    return { ok: false, reason: 'Set MoveToPathList to an absolute TXT file path in Settings.' }
  }
  try {
    const text = await fs.readFile(listPath, 'utf8')
    const seen = new Set()
    const paths = []
    for (const line of text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)) {
      const folderPath = line.trim()
      if (!folderPath) continue
      const key = path.isAbsolute(folderPath) ? pathKey(folderPath) : folderPath.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      let error = ''
      try {
        if (!path.isAbsolute(folderPath)) throw new Error('Absolute path required')
        if (!(await fs.stat(folderPath)).isDirectory()) throw new Error('Not a directory')
        await fs.access(folderPath, constants.R_OK | constants.W_OK)
      } catch (cause) {
        error = cause.message || String(cause)
      }
      paths.push({ folderPath, error })
    }
    return { ok: true, paths }
  } catch (error) {
    return { ok: false, reason: `Cannot read MoveToPathList: ${error.message}` }
  }
}

export async function previewVideoFileMove(filePath, targetFolder) {
  try {
    if (!path.isAbsolute(filePath || '') || path.extname(filePath).toLowerCase() !== '.mp4') {
      throw new Error('Invalid MP4 path')
    }
    if (!(await fs.stat(filePath)).isFile()) throw new Error('MP4 file not found')
    if (!path.isAbsolute(targetFolder || '') || !(await fs.stat(targetFolder)).isDirectory()) {
      throw new Error('Target directory not found')
    }
    const sourceFolder = await fs.realpath(path.dirname(filePath))
    const targetRealFolder = await fs.realpath(targetFolder)
    if (pathKey(sourceFolder) === pathKey(targetRealFolder)) {
      return { ok: false, reason: 'The file is already in this directory.' }
    }
    await fs.access(targetRealFolder, constants.W_OK)
    const family = await listVideoFileFamily(filePath)
    if (!family.some((entry) => pathKey(entry) === pathKey(filePath))) throw new Error('MP4 file not found')
    const operations = []
    for (const sourcePath of family) {
      const targetPath = path.join(targetRealFolder, path.basename(sourcePath))
      try {
        await fs.lstat(targetPath)
        throw new Error(`Target file already exists: ${targetPath}`)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      const stat = await fs.stat(sourcePath)
      operations.push({ from: sourcePath, to: targetPath, size: stat.size, mtimeMs: stat.mtimeMs })
    }
    return { ok: true, operations, filePath: path.join(targetRealFolder, path.basename(filePath)) }
  } catch (error) {
    return { ok: false, reason: error.message || String(error) }
  }
}

async function fileHash(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

// Never overwrite a target. Keep all source files until every copy is verified.
// This also works across drives and allows rollback if deleting a source fails.
export async function moveVideoFileFamily(filePath, targetFolder) {
  const preview = await previewVideoFileMove(filePath, targetFolder)
  if (!preview.ok) return preview
  const copied = []
  const removed = []
  try {
    for (const operation of preview.operations) {
      // Own the destination before copying so cleanup never removes another file.
      const handle = await fs.open(operation.to, 'wx')
      await handle.close()
      copied.push(operation)
      await fs.copyFile(operation.from, operation.to)
      const [sourceHash, targetHash, stat] = await Promise.all([
        fileHash(operation.from), fileHash(operation.to), fs.stat(operation.from),
      ])
      if (sourceHash !== targetHash || stat.size !== operation.size || stat.mtimeMs !== operation.mtimeMs) {
        throw new Error(`File changed or verification failed: ${operation.from}`)
      }
      await fs.utimes(operation.to, stat.atime, stat.mtime)
    }
    // Check the whole group again before removing anything.
    for (const operation of preview.operations) {
      const stat = await fs.stat(operation.from)
      if (stat.size !== operation.size || stat.mtimeMs !== operation.mtimeMs) {
        throw new Error(`Source changed while moving: ${operation.from}`)
      }
    }
    for (const operation of preview.operations) {
      await fs.unlink(operation.from)
      removed.push(operation)
    }
    return { ok: true, filePath: preview.filePath, movedFiles: preview.operations }
  } catch (error) {
    const rollbackErrors = []
    for (const operation of [...removed].reverse()) {
      try {
        await fs.copyFile(operation.to, operation.from, constants.COPYFILE_EXCL)
        await fs.utimes(operation.from, new Date(operation.mtimeMs), new Date(operation.mtimeMs))
      } catch (cause) {
        rollbackErrors.push(`Restore ${operation.from}: ${cause.message}`)
      }
    }
    // If recovery was incomplete, retain all verified destination copies.
    if (rollbackErrors.length === 0) {
      for (const operation of copied) {
        await fs.unlink(operation.to).catch((cause) => {
          rollbackErrors.push(`Cleanup ${operation.to}: ${cause.message}`)
        })
      }
    }
    return {
      ok: false,
      reason: error.message || String(error),
      recoveryRequired: rollbackErrors.length > 0,
      details: rollbackErrors,
      files: preview.operations,
    }
  }
}

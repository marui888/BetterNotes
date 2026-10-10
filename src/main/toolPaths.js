import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

let dictionaryAhkQueue = Promise.resolve()

export function getToolsRoot() {
  return app.isPackaged
    ? path.join(path.dirname(process.execPath), 'tools')
    : path.join(process.cwd(), 'tools')
}

export function getDictionaryToolsRoot() {
  return path.join(getToolsRoot(), 'dictionary-ahk')
}

export async function resolveConfiguredAutoHotkeyPath(configuredPath) {
  const value = typeof configuredPath === 'string'
    ? configuredPath.trim().replace(/^"|"$/g, '')
    : ''
  if (!value) {
    return { ok: false, reason: 'autohotkey-path-not-configured' }
  }

  const executablePath = path.extname(value).toLowerCase() === '.exe'
    ? path.normalize(value)
    : path.join(path.normalize(value), 'AutoHotkey.exe')

  try {
    const stat = await fs.stat(executablePath)
    if (!stat.isFile()) {
      return { ok: false, reason: 'autohotkey-path-invalid' }
    }
    return { ok: true, executablePath }
  } catch {
    return { ok: false, reason: 'autohotkey-path-invalid' }
  }
}

export function enqueueDictionaryAhkOperation(operation) {
  const next = dictionaryAhkQueue.then(operation, operation)
  dictionaryAhkQueue = next.catch(() => {})
  return next
}

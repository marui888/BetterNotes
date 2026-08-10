import { app } from 'electron'
import path from 'node:path'

export function getToolsRoot() {
  return app.isPackaged
    ? path.join(path.dirname(process.execPath), 'tools')
    : path.join(process.cwd(), 'tools')
}

export function getDictionaryToolsRoot() {
  return path.join(getToolsRoot(), 'dictionary-ahk')
}

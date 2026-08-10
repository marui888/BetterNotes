import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { getDictionaryToolsRoot } from './toolPaths'

const execFileAsync = promisify(execFile)
const DICTIONARY_TOOLS_ROOT = getDictionaryToolsRoot()

const AHK_EXE_PATH = 'D:\\AutoHotKey\\AutoHotkey.exe'
const DICTIONARY_AHK_PATH = path.join(DICTIONARY_TOOLS_ROOT, 'dictionary-bridge.ahk')
const DICTIONARY_RESULT_PATH = path.join(DICTIONARY_TOOLS_ROOT, 'dictionary-bridge-result.json')
const AHK_TIMEOUT_MS = 8000

function normalizeWord(word) {
  return typeof word === 'string' ? word.trim() : ''
}

async function readAhkResultJson() {
  try {
    const text = await fs.readFile(DICTIONARY_RESULT_PATH, 'utf8')
    return JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch (error) {
    return { ok: false, reason: 'parse-ahk-result-json-failed', detail: error.message }
  }
}

async function runAhkDictionaryCommand(args) {
  if (process.platform !== 'win32') {
    return { ok: false, reason: 'windows-only' }
  }

  try {
    await execFileAsync(AHK_EXE_PATH, [DICTIONARY_AHK_PATH, ...args, 'silent'], {
      cwd: process.cwd(),
      timeout: AHK_TIMEOUT_MS,
      windowsHide: true,
    })
  } catch (error) {
    const ahkResult = await readAhkResultJson()
    return {
      ok: false,
      reason: ahkResult?.reason || (error.killed ? 'dictionary-ahk-timeout' : 'dictionary-ahk-failed'),
      detail: error.message,
      exitCode: error.code,
      signal: error.signal,
      ahkResult,
    }
  }

  return readAhkResultJson()
}

export async function lookupMDict(word) {
  const searchWord = normalizeWord(word)
  if (!searchWord) {
    return { ok: false, reason: 'empty-word' }
  }

  return runAhkDictionaryCommand(['mdict', searchWord])
}

export async function lookupMDictRestore(word) {
  const searchWord = normalizeWord(word)
  if (!searchWord) {
    return { ok: false, reason: 'empty-word' }
  }

  return runAhkDictionaryCommand(['mdict-sendmsg-restore', searchWord])
}

export async function cycleMDictDictionary() {
  return runAhkDictionaryCommand(['mdict-cycle-post'])
}

export async function getMDictInputText() {
  return runAhkDictionaryCommand(['mdict-gettext'])
}

export async function lookupWebsterAndRead(word) {
  const searchWord = normalizeWord(word)
  if (!searchWord) {
    return { ok: false, reason: 'empty-word' }
  }

  return runAhkDictionaryCommand(['webster-both', searchWord])
}

export async function lookupWebster(word) {
  const searchWord = normalizeWord(word)
  if (!searchWord) {
    return { ok: false, reason: 'empty-word' }
  }

  return runAhkDictionaryCommand(['webster', searchWord])
}

export async function findDictionaryWindows() {
  const result = await runAhkDictionaryCommand(['list'])
  return {
    ...result,
    windows: Array.isArray(result?.windows) ? result.windows : [],
  }
}

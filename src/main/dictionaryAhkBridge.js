import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  enqueueDictionaryAhkOperation,
  getDictionaryToolsRoot,
  resolveConfiguredAutoHotkeyPath,
} from './toolPaths'

const execFileAsync = promisify(execFile)
const DICTIONARY_TOOLS_ROOT = getDictionaryToolsRoot()

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

async function clearAhkResultJson() {
  await fs.rm(DICTIONARY_RESULT_PATH, { force: true })
}

async function readCurrentAhkResult(command) {
  const result = await readAhkResultJson()
  return result?.command === command
    ? result
    : { ok: false, reason: 'stale-ahk-result', ahkResult: result }
}

async function runAhkDictionaryCommand(args, configuredAutoHotkeyPath) {
  return enqueueDictionaryAhkOperation(async () => {
    if (process.platform !== 'win32') {
      return { ok: false, reason: 'windows-only' }
    }

    const resolvedPath = await resolveConfiguredAutoHotkeyPath(configuredAutoHotkeyPath)
    if (!resolvedPath.ok) return resolvedPath

    await clearAhkResultJson()

    try {
      await execFileAsync(resolvedPath.executablePath, [DICTIONARY_AHK_PATH, ...args, 'silent'], {
        cwd: process.cwd(),
        timeout: AHK_TIMEOUT_MS,
        windowsHide: true,
      })
    } catch (error) {
      const ahkResult = await readCurrentAhkResult(args[0])
      return {
        ok: false,
        reason: ahkResult?.reason === 'stale-ahk-result'
          ? error.killed ? 'dictionary-ahk-timeout' : 'dictionary-ahk-failed'
          : ahkResult?.reason || (error.killed ? 'dictionary-ahk-timeout' : 'dictionary-ahk-failed'),
        detail: error.message,
        exitCode: error.code,
        signal: error.signal,
        ahkResult,
      }
    }

    return readCurrentAhkResult(args[0])
  })
}

export async function lookupMDict(word, configuredAutoHotkeyPath) {
  const searchWord = normalizeWord(word)
  if (!searchWord) {
    return { ok: false, reason: 'empty-word' }
  }

  return runAhkDictionaryCommand(['mdict', searchWord], configuredAutoHotkeyPath)
}

export async function lookupMDictRestore(word, configuredAutoHotkeyPath) {
  const searchWord = normalizeWord(word)
  if (!searchWord) {
    return { ok: false, reason: 'empty-word' }
  }

  return runAhkDictionaryCommand(['mdict-sendmsg-restore', searchWord], configuredAutoHotkeyPath)
}

export async function cycleMDictDictionary(configuredAutoHotkeyPath) {
  return runAhkDictionaryCommand(['mdict-cycle-post'], configuredAutoHotkeyPath)
}

export async function getMDictInputText(configuredAutoHotkeyPath) {
  return runAhkDictionaryCommand(['mdict-gettext'], configuredAutoHotkeyPath)
}

export async function lookupWebsterAndRead(word, configuredAutoHotkeyPath) {
  const searchWord = normalizeWord(word)
  if (!searchWord) {
    return { ok: false, reason: 'empty-word' }
  }

  return runAhkDictionaryCommand(['webster-both', searchWord], configuredAutoHotkeyPath)
}

export async function lookupWebster(word, configuredAutoHotkeyPath) {
  const searchWord = normalizeWord(word)
  if (!searchWord) {
    return { ok: false, reason: 'empty-word' }
  }

  return runAhkDictionaryCommand(['webster', searchWord], configuredAutoHotkeyPath)
}

export async function findDictionaryWindows(configuredAutoHotkeyPath) {
  const result = await runAhkDictionaryCommand(['list'], configuredAutoHotkeyPath)
  return {
    ...result,
    windows: Array.isArray(result?.windows) ? result.windows : [],
  }
}

import { desktopCapturer, screen } from 'electron'
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
const WEBSTER_OUTPUT_IMAGE_PATH = path.join(DICTIONARY_TOOLS_ROOT, 'webster-output.png')
const WEBSTER_OUTPUT_SCROLLBAR_WIDTH = 24

async function readAhkResultJson() {
  try {
    const text = await fs.readFile(DICTIONARY_RESULT_PATH, 'utf8')
    return JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch (error) {
    return { ok: false, reason: 'parse-ahk-result-json-failed', detail: error.message }
  }
}

function isRectResult(result) {
  return result?.ok
    && result.command === 'webster-output-rect'
    && Number.isFinite(result.screenX)
    && Number.isFinite(result.screenY)
    && Number.isFinite(result.width)
    && Number.isFinite(result.height)
}

async function runAhkOutputRect() {
  try {
    await execFileAsync(AHK_EXE_PATH, [DICTIONARY_AHK_PATH, 'webster-output-rect', 'silent'], {
      cwd: process.cwd(),
      timeout: 5000,
      windowsHide: true,
    })
  } catch (error) {
    const ahkResult = await readAhkResultJson()
    return {
      ok: false,
      reason: ahkResult?.reason || (error.killed ? 'webster-output-rect-timeout' : 'webster-output-rect-failed'),
      detail: error.message,
      exitCode: error.code,
      signal: error.signal,
      ahkResult,
      paths: {
        cwd: process.cwd(),
        ahkExePath: AHK_EXE_PATH,
        ahkScriptPath: DICTIONARY_AHK_PATH,
        resultPath: DICTIONARY_RESULT_PATH,
      },
    }
  }

  try {
    const result = await readAhkResultJson()
    if (!isRectResult(result)) {
      return { ok: false, reason: result?.reason || 'invalid-webster-output-rect', rectResult: result }
    }
    return { ok: true, rect: result }
  } catch (error) {
    return { ok: false, reason: 'read-webster-output-rect-failed', detail: error.message }
  }
}

function findDisplayForRect(rect) {
  const centerX = rect.screenX + Math.floor(rect.width / 2)
  const centerY = rect.screenY + Math.floor(rect.height / 2)
  return screen.getAllDisplays().find((display) => (
    centerX >= display.bounds.x
    && centerX < display.bounds.x + display.bounds.width
    && centerY >= display.bounds.y
    && centerY < display.bounds.y + display.bounds.height
  )) || screen.getDisplayNearestPoint({ x: centerX, y: centerY })
}

export async function captureWebsterOutput() {
  const rectResult = await runAhkOutputRect()
  if (!rectResult.ok) return rectResult

  const rect = rectResult.rect
  const display = findDisplayForRect(rect)
  if (!display) {
    return { ok: false, reason: 'webster-output-display-not-found', rect }
  }

  const scaleFactor = display.scaleFactor || 1
  const thumbnailSize = {
    width: Math.ceil(display.bounds.width * scaleFactor),
    height: Math.ceil(display.bounds.height * scaleFactor),
  }
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize,
  })
  const source = sources.find((item) => item.display_id === String(display.id))
    || (sources.length === 1 ? sources[0] : null)

  if (!source || source.thumbnail.isEmpty()) {
    return {
      ok: false,
      reason: 'desktop-capture-source-not-found',
      rect,
      displayId: display.id,
      sources: sources.map((item) => ({ id: item.id, name: item.name, displayId: item.display_id })),
    }
  }

  const crop = {
    x: Math.max(0, Math.round((rect.screenX - display.bounds.x) * scaleFactor)),
    y: Math.max(0, Math.round((rect.screenY - display.bounds.y) * scaleFactor)),
    width: Math.max(1, Math.round((rect.width - WEBSTER_OUTPUT_SCROLLBAR_WIDTH) * scaleFactor)),
    height: Math.max(1, Math.round(rect.height * scaleFactor)),
  }
  const imageSize = source.thumbnail.getSize()
  crop.width = Math.min(crop.width, imageSize.width - crop.x)
  crop.height = Math.min(crop.height, imageSize.height - crop.y)

  if (crop.width <= 0 || crop.height <= 0) {
    return { ok: false, reason: 'desktop-capture-crop-out-of-range', rect, displayBounds: display.bounds, crop, imageSize }
  }

  const image = source.thumbnail.crop(crop)
  await fs.mkdir(path.dirname(WEBSTER_OUTPUT_IMAGE_PATH), { recursive: true })
  await fs.writeFile(WEBSTER_OUTPUT_IMAGE_PATH, image.toPNG())

  return {
    ok: true,
    imagePath: WEBSTER_OUTPUT_IMAGE_PATH,
    rect,
    display: {
      id: display.id,
      bounds: display.bounds,
      scaleFactor,
    },
    crop,
    trimRight: WEBSTER_OUTPUT_SCROLLBAR_WIDTH,
    imageSize,
  }
}

export async function captureWebsterOutputForDetection() {
  return captureWebsterOutput()
}

export async function clickWebsterScreenPoint(screenX, screenY) {
  const x = Math.round(Number(screenX))
  const y = Math.round(Number(screenY))
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, reason: 'invalid-webster-click-position', screenX, screenY }
  }

  try {
    await execFileAsync(AHK_EXE_PATH, [DICTIONARY_AHK_PATH, 'webster-click', String(x), String(y)], {
      cwd: process.cwd(),
      timeout: 5000,
      windowsHide: true,
    })
  } catch (error) {
    const ahkResult = await readAhkResultJson()
    return {
      ok: false,
      reason: ahkResult?.reason || (error.killed ? 'webster-click-timeout' : 'webster-click-failed'),
      detail: error.message,
      exitCode: error.code,
      signal: error.signal,
      ahkResult,
    }
  }

  const ahkResult = await readAhkResultJson()
  return ahkResult?.ok
    ? { ok: true, screenX: x, screenY: y, ahkResult }
    : { ok: false, reason: ahkResult?.reason || 'invalid-webster-click-result', screenX: x, screenY: y, ahkResult }
}

export async function doubleClickWebsterClientPoint(clientX, clientY) {
  const x = Math.round(Number(clientX))
  const y = Math.round(Number(clientY))
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
    return { ok: false, reason: 'invalid-webster-client-double-click-position', clientX, clientY }
  }

  try {
    await execFileAsync(AHK_EXE_PATH, [DICTIONARY_AHK_PATH, 'webster-client-dblclick', String(x), String(y)], {
      cwd: process.cwd(),
      timeout: 5000,
      windowsHide: true,
    })
  } catch (error) {
    const ahkResult = await readAhkResultJson()
    return {
      ok: false,
      reason: ahkResult?.reason || (error.killed ? 'webster-client-double-click-timeout' : 'webster-client-double-click-failed'),
      detail: error.message,
      exitCode: error.code,
      signal: error.signal,
      ahkResult,
    }
  }

  const ahkResult = await readAhkResultJson()
  return ahkResult?.ok
    ? { ok: true, clientX: x, clientY: y, ahkResult }
    : { ok: false, reason: ahkResult?.reason || 'invalid-webster-client-double-click-result', clientX: x, clientY: y, ahkResult }
}

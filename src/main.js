import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, session, shell } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import { convertSrtToVtt } from './main/srtToVtt';
import { captureWebsterOutput, doubleClickWebsterClientPoint } from './main/websterCapture';
import { appendTextLine, appendUtf8TextLine, convertFolderTxtToUtf8, listTxtFilesInFolder, readWordFile, saveWordFile } from './main/wordFileService';
import { cycleMDictDictionary, findDictionaryWindows, getMDictInputText, lookupMDict, lookupMDictRestore, lookupWebster, lookupWebsterAndRead } from './main/dictionaryAhkBridge';

const startupStartMs = Date.now()

function logStartup(label) {
  console.log(`[startup:main] ${label} +${Date.now() - startupStartMs}ms`)
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let mainWindow
let debugWindow
let keywordWindow
let keywordCache = null
const pendingDebugMessages = []
let allowClose = false
let closeRequestPending = false
let appQuitting = false
let windowLayoutBeforeTextMode = null
let websterBlueDetectorPromise = null
let registeredGlobalActivationShortcut = ''

function notifyKeywordWindowOpened() {
  if (keywordWindow && !keywordWindow.isDestroyed()) {
    keywordWindow.webContents.send('keyword:opened')
  }
}

const DEFAULT_RECENT_STATE = {
  recentFiles: {
    video: [],
    image: [],
    text: [],
    search: [],
  },
  recentFolders: {
    video: [],
    image: [],
    text: [],
    search: [],
  },
}
const DEFAULT_APP_SETTINGS = {
  general: {
    defaultMode: 'video',
    globalActivationShortcut: 'Ctrl+Alt+F',
    monthlyNotesFolder: '',
    specialTextFolder: '',
    keywordFolder: '',
    defaultKeywordFile: '',
    extraSubtitleFolder: '',
    subtitleDisplayMode: 'native',
    rollingSubtitleFontSize: 25,
    playAllSubtitleSuffix: '.en.vtt',
    subtitleConvertPromptTimeoutSec: 5,
    imageAutoLoadDelayMs: 500,
    locallyMoveFolder: 'tempPictures',
    picModeWideMoveFolder: '',
    textAutoPlayAll: false,
    textAutoLookupDelayMs: 1500,
    wordsReviewFontSize: 13,
    websterSpellOut: true,
    textAutoPlayDicts: {
      mdict: true,
      webster: true,
    },
  },
  shortcuts: {
    video: {
      'video.seekStart': 'Escape',
      'video.jumpBack': 'F1',
      'video.setStart': 'F2',
      'video.setEnd': 'F3',
      'video.jumpForward': 'F4',
      'video.intoEditingFocus': 'Alt+E',
      'video.appendMark': '',
      'video.appendQuickMark': 'Ctrl+S',
      'video.toggleControlMode': 'Alt+V',
      'video.togglePlay': 'F6',
      'video.togglePlayAlt': 'Alt+P',
      'video.saveNotes': 'F9',
      'video.saveNotesAlt': 'Shift+Alt+S',
      'video.jumpBackShort': 'ArrowLeft',
      'video.jumpForwardShort': 'ArrowRight',
      'video.jumpBackLong': 'Ctrl+ArrowLeft',
      'video.jumpForwardLong': 'Ctrl+ArrowRight',
      'video.speedUp': 'Ctrl+ArrowUp',
      'video.speedDown': 'Ctrl+ArrowDown',
      'video.volumeUp': 'ArrowUp',
      'video.volumeDown': 'ArrowDown',
      'video.toggleView': 'Ctrl+F',
      'video.toggleLeftTab': 'Alt+F',
      'video.updateContent': 'Ctrl+Q',
      'video.quickUpdateRange': 'Ctrl+G',
      'video.writeCurrentRange': 'Ctrl+W',
    },
    image: {
      'image.intoEditingFocus': 'Alt+E',
      'image.previousImage': '',
      'image.nextImage': '',
      'image.saveNote': '',
      'image.renameFile': '',
      'image.moveFile': '',
      'image.moveRenameFile': '',
    },
    text: {
      'text.intoEditingFocus': 'Alt+E',
      'text.lookup': 'Ctrl+Enter',
      'text.pasteAndLookup': 'Ctrl+G',
      'text.toggleView': '',
      'text.replace': '',
      'text.replaceLine': '',
      'text.saveToSpecificFile': '',
      'text.saveToEn': '',
      'text.saveToZh': '',
    },
    search: {},
    global: {
      'global.switchToVideo': 'Ctrl+K V',
      'global.switchToPicture': 'Ctrl+K P',
      'global.switchToText': 'Ctrl+K T',
      'global.switchToManagement': 'Ctrl+K M',
    },
  },
}

function cloneDefaultRecentState() {
  return {
    recentFiles: { ...DEFAULT_RECENT_STATE.recentFiles },
    recentFolders: { ...DEFAULT_RECENT_STATE.recentFolders },
  }
}

function normalizeRecentBuckets(value) {
  return {
    video: Array.isArray(value?.video) ? value.video : [],
    image: Array.isArray(value?.image) ? value.image : [],
    text: Array.isArray(value?.text) ? value.text : [],
    search: Array.isArray(value?.search) ? value.search : [],
  }
}

function normalizeRecentState(value) {
  return {
    recentFiles: normalizeRecentBuckets(value?.recentFiles),
    recentFolders: normalizeRecentBuckets(value?.recentFolders),
  }
}

function mergeShortcutBucket(scope, value) {
  const defaults = DEFAULT_APP_SETTINGS.shortcuts[scope] || {}
  const merged = value && typeof value === 'object'
    ? { ...defaults, ...value }
    : { ...defaults }
  if (scope === 'video' && !merged['video.intoEditingFocus'] && value?.['video.toggleFocus']) {
    merged['video.intoEditingFocus'] = value['video.toggleFocus']
  }
  if (scope === 'video' && !merged['video.quickUpdateRange'] && value?.['video.updateRange']) {
    merged['video.quickUpdateRange'] = value['video.updateRange']
  }
  if (scope === 'text' && !merged['text.saveToSpecificFile'] && value?.['text.saveTo']) {
    merged['text.saveToSpecificFile'] = value['text.saveTo']
  }
  delete merged['video.toggleFocus']
  delete merged['video.updateRange']
  delete merged['text.saveTo']
  delete merged['global.cycleMode']
  return merged
}

function normalizeShortcutBuckets(value) {
  return {
    video: mergeShortcutBucket('video', value?.video),
    image: mergeShortcutBucket('image', value?.image),
    text: mergeShortcutBucket('text', value?.text),
    search: mergeShortcutBucket('search', value?.search),
    global: mergeShortcutBucket('global', value?.global),
  }
}

function normalizeAppSettings(value) {
  const defaultMode = ['video', 'image', 'text', 'search'].includes(value?.general?.defaultMode)
    ? value.general.defaultMode
    : DEFAULT_APP_SETTINGS.general.defaultMode
  const globalActivationShortcut = typeof value?.general?.globalActivationShortcut === 'string'
    ? value.general.globalActivationShortcut
    : DEFAULT_APP_SETTINGS.general.globalActivationShortcut
  const monthlyNotesFolder = typeof value?.general?.monthlyNotesFolder === 'string'
    ? normalizeFilePath(value.general.monthlyNotesFolder)
    : DEFAULT_APP_SETTINGS.general.monthlyNotesFolder
  const specialTextFolder = typeof value?.general?.specialTextFolder === 'string'
    ? normalizeFilePath(value.general.specialTextFolder)
    : DEFAULT_APP_SETTINGS.general.specialTextFolder
  const keywordFolder = typeof value?.general?.keywordFolder === 'string'
    ? normalizeFilePath(value.general.keywordFolder)
    : DEFAULT_APP_SETTINGS.general.keywordFolder
  const defaultKeywordFile = typeof value?.general?.defaultKeywordFile === 'string'
    ? path.basename(value.general.defaultKeywordFile)
    : DEFAULT_APP_SETTINGS.general.defaultKeywordFile
  const extraSubtitleFolder = typeof value?.general?.extraSubtitleFolder === 'string'
    ? normalizeFilePath(value.general.extraSubtitleFolder)
    : DEFAULT_APP_SETTINGS.general.extraSubtitleFolder
  const playAllSubtitleSuffix = typeof value?.general?.playAllSubtitleSuffix === 'string'
    ? value.general.playAllSubtitleSuffix
    : DEFAULT_APP_SETTINGS.general.playAllSubtitleSuffix
  const subtitleDisplayMode = value?.general?.subtitleDisplayMode === 'rolling'
    ? 'rolling'
    : DEFAULT_APP_SETTINGS.general.subtitleDisplayMode
  const rawRollingSubtitleFontSize = Number(value?.general?.rollingSubtitleFontSize)
  const rollingSubtitleFontSize = Number.isFinite(rawRollingSubtitleFontSize)
    ? Math.max(10, Math.min(48, Math.round(rawRollingSubtitleFontSize)))
    : DEFAULT_APP_SETTINGS.general.rollingSubtitleFontSize
  const rawSubtitleConvertPromptTimeoutSec = Number(value?.general?.subtitleConvertPromptTimeoutSec)
  const subtitleConvertPromptTimeoutSec = Number.isFinite(rawSubtitleConvertPromptTimeoutSec)
    ? Math.max(1, Math.min(60, Math.round(rawSubtitleConvertPromptTimeoutSec)))
    : DEFAULT_APP_SETTINGS.general.subtitleConvertPromptTimeoutSec
  const rawTextAutoLookupDelayMs = Number(value?.general?.textAutoLookupDelayMs)
  const textAutoLookupDelayMs = Number.isFinite(rawTextAutoLookupDelayMs)
    ? Math.max(200, Math.min(60000, Math.round(rawTextAutoLookupDelayMs)))
    : DEFAULT_APP_SETTINGS.general.textAutoLookupDelayMs
  const rawImageAutoLoadDelayMs = Number(value?.general?.imageAutoLoadDelayMs)
  const imageAutoLoadDelayMs = Number.isFinite(rawImageAutoLoadDelayMs)
    ? Math.max(100, Math.min(10000, Math.round(rawImageAutoLoadDelayMs)))
    : DEFAULT_APP_SETTINGS.general.imageAutoLoadDelayMs
  const rawLocallyMoveFolder = typeof value?.general?.locallyMoveFolder === 'string'
    ? value.general.locallyMoveFolder.trim()
    : typeof value?.general?.pictureMoveFolderName === 'string'
      ? value.general.pictureMoveFolderName.trim()
      : ''
  const locallyMoveFolder = rawLocallyMoveFolder && !/[\\/]/.test(rawLocallyMoveFolder)
    ? rawLocallyMoveFolder
    : DEFAULT_APP_SETTINGS.general.locallyMoveFolder
  const picModeWideMoveFolder = typeof value?.general?.picModeWideMoveFolder === 'string'
    ? normalizeFilePath(value.general.picModeWideMoveFolder)
    : ''
  const rawWordsReviewFontSize = Number(value?.general?.wordsReviewFontSize)
  const wordsReviewFontSize = Number.isFinite(rawWordsReviewFontSize)
    ? Math.max(10, Math.min(32, Math.round(rawWordsReviewFontSize)))
    : DEFAULT_APP_SETTINGS.general.wordsReviewFontSize
  const textAutoPlayDicts = value?.general?.textAutoPlayDicts

  return {
    general: {
      defaultMode,
      globalActivationShortcut,
      monthlyNotesFolder,
      specialTextFolder,
      keywordFolder,
      defaultKeywordFile,
      extraSubtitleFolder,
      subtitleDisplayMode,
      rollingSubtitleFontSize,
      playAllSubtitleSuffix,
      subtitleConvertPromptTimeoutSec,
      imageAutoLoadDelayMs,
      locallyMoveFolder,
      picModeWideMoveFolder,
      textAutoPlayAll: value?.general?.textAutoPlayAll === true,
      textAutoLookupDelayMs,
      wordsReviewFontSize,
      websterSpellOut: value?.general?.websterSpellOut !== false,
      textAutoPlayDicts: {
        mdict: textAutoPlayDicts?.mdict !== false,
        webster: textAutoPlayDicts?.webster !== false,
      },
    },
    shortcuts: normalizeShortcutBuckets(value?.shortcuts),
  }
}

function validateGlobalActivationShortcut(shortcut) {
  const value = typeof shortcut === 'string' ? shortcut.trim() : ''
  if (!value) return { ok: false, reason: 'empty-global-shortcut' }

  const parts = value.split('+').map((part) => part.trim()).filter(Boolean)
  const modifiers = new Set(['Ctrl', 'Control', 'Alt', 'Shift', 'Meta', 'Command', 'Cmd', 'Super'])
  const modifierCount = parts.filter((part) => modifiers.has(part)).length
  const normalKeyCount = parts.length - modifierCount

  if (parts.length !== 3 || modifierCount !== 2 || normalKeyCount !== 1) {
    return { ok: false, reason: 'global-shortcut-must-be-three-keys' }
  }

  return { ok: true, shortcut: value }
}

function toggleMainWindowActivation() {
  if (!mainWindow || mainWindow.isDestroyed()) return

  if (mainWindow.isFocused() && !mainWindow.isMinimized()) {
    mainWindow.minimize()
    return
  }

  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  mainWindow.webContents.focus()
}

function registerGlobalActivationShortcut(shortcut) {
  if (registeredGlobalActivationShortcut) {
    globalShortcut.unregister(registeredGlobalActivationShortcut)
    registeredGlobalActivationShortcut = ''
  }

  const validation = validateGlobalActivationShortcut(shortcut)
  if (!validation.ok) {
    return validation
  }

  const registered = globalShortcut.register(validation.shortcut, toggleMainWindowActivation)
  if (!registered) {
    return { ok: false, reason: 'register-global-shortcut-failed', shortcut: validation.shortcut }
  }

  registeredGlobalActivationShortcut = validation.shortcut
  return { ok: true, shortcut: validation.shortcut }
}

function getRecentStatePath() {
  return path.join(app.getPath('userData'), 'recent-state.json')
}

function getAppSettingsPath() {
  return path.join(process.cwd(), 'app-settings.json')
}

function getLastSessionStatePath() {
  return path.join(process.cwd(), 'last-session-state.json')
}

function getLegacyAppSettingsPath() {
  return path.join(app.getPath('userData'), 'app-settings.json')
}

async function readRecentState() {
  try {
    const text = await fs.readFile(getRecentStatePath(), 'utf8')
    return normalizeRecentState(JSON.parse(text))
  } catch {
    return cloneDefaultRecentState()
  }
}

async function writeRecentState(value) {
  const recentState = normalizeRecentState(value)
  await fs.mkdir(path.dirname(getRecentStatePath()), { recursive: true })
  await fs.writeFile(getRecentStatePath(), JSON.stringify(recentState, null, 2), 'utf8')
  return { ok: true, recentState }
}

async function readAppSettings() {
  try {
    const text = await fs.readFile(getAppSettingsPath(), 'utf8')
    return normalizeAppSettings(JSON.parse(text))
  } catch {
    try {
      const text = await fs.readFile(getLegacyAppSettingsPath(), 'utf8')
      return normalizeAppSettings(JSON.parse(text))
    } catch {
      return normalizeAppSettings(DEFAULT_APP_SETTINGS)
    }
  }
}

async function writeAppSettings(value) {
  const settings = normalizeAppSettings(value)
  await fs.mkdir(path.dirname(getAppSettingsPath()), { recursive: true })
  await fs.writeFile(getAppSettingsPath(), JSON.stringify(settings, null, 2), 'utf8')
  return { ok: true, settings }
}

async function readLastSessionState() {
  try {
    const text = await fs.readFile(getLastSessionStatePath(), 'utf8')
    const sessionState = JSON.parse(text)
    return { ok: true, sessionState }
  } catch {
    return { ok: false, reason: 'last-session-not-found' }
  }
}

async function writeLastSessionState(sessionState) {
  await fs.writeFile(getLastSessionStatePath(), JSON.stringify({
    version: 1,
    savedAt: new Date().toISOString(),
    window: getMainWindowSessionState(),
    ...(sessionState || {}),
  }, null, 2), 'utf8')
  return { ok: true }
}

async function selectFolderDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, canceled: true }
  }

  return { ok: true, folderPath: result.filePaths[0] }
}

function getMainWindowSessionState() {
  if (!mainWindow || mainWindow.isDestroyed()) return null

  const bounds = mainWindow.isMaximized()
    ? mainWindow.getNormalBounds()
    : mainWindow.getBounds()
  const display = screen.getDisplayMatching(bounds)

  return {
    displayId: display.id,
    displayBounds: display.bounds,
    bounds,
    isMaximized: mainWindow.isMaximized(),
  }
}

function getFallbackDisplay() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    || screen.getPrimaryDisplay()
}

function getRestoredWindowOptions(windowState) {
  const displays = screen.getAllDisplays()
  const savedDisplay = displays.find((display) => display.id === windowState?.displayId)
  const targetDisplay = savedDisplay || getFallbackDisplay()
  const workArea = targetDisplay.workArea
  const savedBounds = windowState?.bounds
  const savedDisplayBounds = windowState?.displayBounds
  const sameResolution = savedDisplayBounds
    && savedDisplayBounds?.width === targetDisplay.bounds.width
    && savedDisplayBounds?.height === targetDisplay.bounds.height

  if (
    sameResolution
    && Number.isFinite(savedBounds?.x)
    && Number.isFinite(savedBounds?.y)
    && Number.isFinite(savedBounds?.width)
    && Number.isFinite(savedBounds?.height)
  ) {
    const relativeX = savedBounds.x - (savedDisplayBounds?.x || 0)
    const relativeY = savedBounds.y - (savedDisplayBounds?.y || 0)
    return {
      bounds: {
        x: Math.round(savedDisplay ? savedBounds.x : targetDisplay.bounds.x + relativeX),
        y: Math.round(savedDisplay ? savedBounds.y : targetDisplay.bounds.y + relativeY),
        width: Math.max(360, Math.round(savedBounds.width)),
        height: Math.max(280, Math.round(savedBounds.height)),
      },
      isMaximized: windowState?.isMaximized === true,
      restored: true,
    }
  }

  const width = Math.min(1200, Math.max(800, Math.round(workArea.width * 0.72)))
  const height = Math.min(820, Math.max(600, Math.round(workArea.height * 0.78)))
  return {
    bounds: {
      x: workArea.x + Math.round((workArea.width - width) / 2),
      y: workArea.y + Math.round((workArea.height - height) / 2),
      width,
      height,
    },
    isMaximized: false,
    restored: Boolean(windowState),
  }
}

function preloadWebsterBlueDetector() {
  if (!websterBlueDetectorPromise) {
    logStartup('OpenCV async preload start')
    websterBlueDetectorPromise = import('./main/websterBlueDetector')
      .then((module) => {
        logStartup('OpenCV async preload ready')
        return module
      })
      .catch((error) => {
        websterBlueDetectorPromise = null
        console.error('OpenCV async preload failed:', error)
        throw error
      })
  }

  return websterBlueDetectorPromise
}

async function detectWebsterBlueTextAsync(captureInfo) {
  const { detectWebsterBlueText } = await preloadWebsterBlueDetector()
  return detectWebsterBlueText(captureInfo)
}

function areBoundsClose(a, b, tolerance = 12) {
  if (!a || !b) return false
  return Math.abs(a.x - b.x) <= tolerance
    && Math.abs(a.y - b.y) <= tolerance
    && Math.abs(a.width - b.width) <= tolerance
    && Math.abs(a.height - b.height) <= tolerance
}

function appendDebugInfo(message) {
  const item = {
    createdAt: new Date().toLocaleTimeString(),
    message: typeof message === 'string' ? message : JSON.stringify(message, null, 2),
  }

  pendingDebugMessages.push(item)
  if (pendingDebugMessages.length > 300) {
    pendingDebugMessages.splice(0, pendingDebugMessages.length - 300)
  }

  if (debugWindow && !debugWindow.isDestroyed()) {
    debugWindow.webContents.send('debug:append', item)
  }
}

function createDebugWindow() {
  if (debugWindow && !debugWindow.isDestroyed()) {
    debugWindow.show()
    debugWindow.focus()
    return debugWindow
  }

  const parentBounds = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow.getBounds()
    : { x: 80, y: 80, width: 800, height: 600 }
  const workArea = screen.getDisplayMatching(parentBounds).workArea
  const debugWidth = 520
  const debugHeight = 460
  const preferredRightX = parentBounds.x + parentBounds.width + 12
  const preferredLeftX = parentBounds.x - debugWidth - 12
  const debugX = preferredRightX + debugWidth <= workArea.x + workArea.width
    ? preferredRightX
    : Math.max(workArea.x, Math.min(preferredLeftX, workArea.x + workArea.width - debugWidth))
  const debugY = Math.max(
    workArea.y,
    Math.min(parentBounds.y + 60, workArea.y + workArea.height - debugHeight)
  )

  debugWindow = new BrowserWindow({
    width: debugWidth,
    height: debugHeight,
    x: debugX,
    y: debugY,
    minWidth: 320,
    minHeight: 220,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    skipTaskbar: true,
    movable: true,
    closable: true,
    resizable: true,
    title: 'Debug Info',
    icon: path.join(process.cwd(), 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,
    },
  })

  debugWindow.setOpacity(0.92)

  debugWindow.on('closed', () => {
    debugWindow = null
  })

  const debugUrl = `${MAIN_WINDOW_VITE_DEV_SERVER_URL}#debug`
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    debugWindow.loadURL(debugUrl)
  } else {
    debugWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), {
      hash: 'debug',
    })
  }

  debugWindow.webContents.once('did-finish-load', () => {
    pendingDebugMessages.forEach((item) => {
      debugWindow?.webContents.send('debug:append', item)
    })
  })

  return debugWindow
}

function createKeywordWindow(options = {}) {
  const shouldShow = options.show !== false
  if (keywordWindow && !keywordWindow.isDestroyed()) {
    if (shouldShow) {
      keywordWindow.show()
      keywordWindow.focus()
      notifyKeywordWindowOpened()
    }
    return keywordWindow
  }

  const parentBounds = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow.getBounds()
    : { x: 80, y: 80, width: 900, height: 700 }
  const workArea = screen.getDisplayMatching(parentBounds).workArea
  const keywordWidth = 760
  const keywordHeight = 520
  const keywordX = Math.max(
    workArea.x,
    Math.min(parentBounds.x + 48, workArea.x + workArea.width - keywordWidth)
  )
  const keywordY = Math.max(
    workArea.y,
    Math.min(parentBounds.y + 48, workArea.y + workArea.height - keywordHeight)
  )

  keywordWindow = new BrowserWindow({
    width: keywordWidth,
    height: keywordHeight,
    x: keywordX,
    y: keywordY,
    minWidth: 520,
    minHeight: 360,
    parent: mainWindow || undefined,
    modal: false,
    alwaysOnTop: true,
    resizable: true,
    show: shouldShow,
    title: 'Keyword Input',
    icon: path.join(process.cwd(), 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,
    },
  })

  keywordWindow.on('close', (event) => {
    if (appQuitting) return
    event.preventDefault()
    keywordWindow?.hide()
  })

  keywordWindow.on('closed', () => {
    keywordWindow = null
  })

  const keywordUrl = `${MAIN_WINDOW_VITE_DEV_SERVER_URL}#keyword`
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    keywordWindow.loadURL(keywordUrl)
  } else {
    keywordWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), {
      hash: 'keyword',
    })
  }

  if (shouldShow) {
    keywordWindow.once('ready-to-show', () => {
      if (!keywordWindow?.isDestroyed()) {
        keywordWindow.show()
        keywordWindow.focus()
        notifyKeywordWindowOpened()
      }
    })
  }

  return keywordWindow
}

function buildAppMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          role: 'quit',
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          role: 'reload',
        },
        {
          role: 'forceReload',
        },
        {
          role: 'toggleDevTools',
        },
      ],
    },
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Settings',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('app:showSettings')
            }
          },
        },
        {
          type: 'separator',
        },
        {
          label: 'Debug Info',
          click: () => createDebugWindow(),
        },
        {
          type: 'separator',
        },
        {
          label: 'Convert TXT to UTF-8...',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('app:convertTxtToUtf8')
            }
          },
        },
      ],
    },
    {
      label: 'Window',
      submenu: [
        {
          role: 'minimize',
        },
        {
          label: 'Close Window',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.close()
            }
          },
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function isMp4File(filePath) {
  return typeof filePath === 'string' && filePath.toLowerCase().endsWith('.mp4')
}

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'])

function isImageFile(filePath) {
  return typeof filePath === 'string' && IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function normalizeFilePath(filePath) {
  return typeof filePath === 'string'
    ? filePath.trim().replace(/^["']|["']$/g, '')
    : ''
}

function getMonthlyNoteFilePath(folderPath, kind) {
  const normalizedFolder = normalizeFilePath(folderPath)
  if (!normalizedFolder) return ''

  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const baseName = kind === 'zh' ? 'NewWordsLog_Zh' : 'NewWordsLog_EN'
  return path.join(normalizedFolder, `${baseName} ${year}-${month} ${os.hostname()}.utf8.txt`)
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getSpecialUtf8TextFilePath(filePath) {
  const normalizedPath = normalizeFilePath(filePath)
  if (!isTxtFile(normalizedPath)) return ''

  const folderPath = path.dirname(normalizedPath)
  const fileName = path.basename(normalizedPath)
  const hostName = os.hostname()
  const specialPattern = new RegExp(`^.+_SP START_\\d{4}-\\d{2} ${escapeRegExp(hostName)}\\.utf8\\.txt$`, 'i')
  if (specialPattern.test(fileName)) return normalizedPath

  const parsedPath = path.parse(normalizedPath)
  const baseName = parsedPath.name.replace(/\.utf8$/i, '')
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return path.join(folderPath, `${baseName}_SP START_${year}-${month} ${hostName}.utf8.txt`)
}

function getVideoNotePath(filePath) {
  const parsedPath = path.parse(filePath)
  return path.join(parsedPath.dir, `${parsedPath.name}.json`)
}

function getPictureNotePath(filePath) {
  const parsedPath = path.parse(filePath)
  return path.join(parsedPath.dir, `${parsedPath.name}.json`)
}

function getPictureTxtNotePath(filePath) {
  const parsedPath = path.parse(filePath)
  return path.join(parsedPath.dir, `${parsedPath.name}.txt`)
}

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath)
    return stat.isFile()
  } catch {
    return false
  }
}

async function listMp4FilesInFolder(folderPath) {
  try {
    const entries = await fs.readdir(folderPath, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.mp4'))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
  } catch (error) {
    console.error('list mp4 files failed:', error)
    return []
  }
}

function buildSubtitleInfo(folderPath, videoBaseName, subtitleFileName) {
  const subtitlePath = path.join(folderPath, subtitleFileName)
  const subtitleExt = path.extname(subtitleFileName)
  const subtitleBase = subtitleFileName.slice(0, -subtitleExt.length)
  const language = subtitleBase === videoBaseName
    ? ''
    : subtitleBase.slice(videoBaseName.length + 1)

  return {
    fileName: subtitleFileName,
    filePath: subtitlePath,
    fileUrl: pathToFileURL(subtitlePath).toString(),
    language,
    label: language || 'Default',
  }
}

function resolveSubtitleSearchFolders(videoFolderPath, extraSubtitleFolder) {
  const folders = []
  const addFolder = (folderPath) => {
    const normalized = normalizeFilePath(folderPath)
    if (!normalized) return
    const resolved = path.resolve(normalized)
    if (!folders.some((folder) => folder.toLowerCase() === resolved.toLowerCase())) {
      folders.push(resolved)
    }
  }

  addFolder(videoFolderPath)

  const extraFolder = normalizeFilePath(extraSubtitleFolder)
  if (extraFolder) {
    addFolder(path.isAbsolute(extraFolder) ? extraFolder : path.resolve(process.cwd(), extraFolder))
  }

  return folders
}

async function listSubtitleCandidatesInFolder(folderPath, videoBaseName, subtitleExtension) {
  const wantedExt = subtitleExtension.toLowerCase()

  try {
    const entries = await fs.readdir(folderPath, { withFileTypes: true })
    return entries
      .filter((entry) => {
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== wantedExt) {
          return false
        }

        const lowerName = entry.name.toLowerCase()
        const lowerBase = videoBaseName.toLowerCase()
        return lowerName === `${lowerBase}${wantedExt}` || lowerName.startsWith(`${lowerBase}.`)
      })
      .map((entry) => buildSubtitleInfo(folderPath, videoBaseName, entry.name))
      .sort((a, b) => {
        if (!a.language && b.language) return -1
        if (a.language && !b.language) return 1
        return a.fileName.localeCompare(b.fileName)
      })
  } catch (error) {
    console.error(`list ${wantedExt} subtitles failed:`, error)
    return []
  }
}

async function listVideoSubtitleLanguages(filePath, extraSubtitleFolder = '') {
  const parsedPath = path.parse(filePath)
  const folders = resolveSubtitleSearchFolders(parsedPath.dir, extraSubtitleFolder)
  const languageMap = new Map()

  for (const folderPath of folders) {
    const vttCandidates = await listSubtitleCandidatesInFolder(folderPath, parsedPath.name, '.vtt')
    const srtCandidates = await listSubtitleCandidatesInFolder(folderPath, parsedPath.name, '.srt')

    for (const subtitle of vttCandidates) {
      const key = subtitle.language || ''
      const existing = languageMap.get(key) || { language: key, label: subtitle.label }
      if (!existing.subtitle) existing.subtitle = subtitle
      languageMap.set(key, existing)
    }

    for (const subtitle of srtCandidates) {
      const key = subtitle.language || ''
      const existing = languageMap.get(key) || { language: key, label: subtitle.label }
      if (!existing.srtSubtitle) existing.srtSubtitle = subtitle
      languageMap.set(key, existing)
    }
  }

  const subtitleLanguages = [...languageMap.values()]
    .map((entry) => ({
      language: entry.language,
      label: entry.label || entry.language || 'Default',
      subtitle: entry.subtitle || null,
      srtSubtitle: entry.srtSubtitle || null,
    }))
    .sort((a, b) => {
      if (!a.language && b.language) return -1
      if (a.language && !b.language) return 1
      return a.label.localeCompare(b.label)
    })

  return {
    subtitleLanguages,
    subtitleCandidates: subtitleLanguages.map((entry) => entry.subtitle).filter(Boolean),
    srtSubtitleCandidates: subtitleLanguages
      .filter((entry) => !entry.subtitle && entry.srtSubtitle)
      .map((entry) => entry.srtSubtitle),
  }
}

async function listImageFilesInFolder(folderPath) {
  try {
    const entries = await fs.readdir(folderPath, { withFileTypes: true })
    const files = entries
      .filter((entry) => entry.isFile() && isImageFile(entry.name))
    const imageFiles = await Promise.all(files.map(async (entry) => {
      const filePath = path.join(folderPath, entry.name)
      const stat = await fs.stat(filePath)
      return {
        fileName: entry.name,
        filePath,
        type: path.extname(entry.name).slice(1).toUpperCase(),
        modifiedTime: stat.mtimeMs,
        createdTime: stat.birthtimeMs,
      }
    }))

    return imageFiles
      .sort((a, b) => a.fileName.localeCompare(b.fileName))
  } catch (error) {
    console.error('list image files failed:', error)
    return []
  }
}

function parseKeywordFileContent(text) {
  const normalizedText = String(text || '').replace(/^\uFEFF/, '')
  const startToken = '```KEYWORD-START'
  const endToken = '```KEYWORD-END'
  const startIndex = normalizedText.indexOf(startToken)
  if (startIndex < 0) return []

  const contentStart = normalizedText.indexOf('\n', startIndex)
  if (contentStart < 0) return []

  const endIndex = normalizedText.indexOf(endToken, contentStart)
  const body = normalizedText.slice(contentStart + 1, endIndex >= 0 ? endIndex : normalizedText.length)
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[A-Za-z\u3400-\u9fff]/.test(line))
}

async function listKeywordFiles(options = {}) {
  const settings = await readAppSettings()
  const keywordFolder = typeof options.keywordFolder === 'string' && options.keywordFolder.trim()
    ? normalizeFilePath(options.keywordFolder)
    : settings.general.keywordFolder
  const defaultKeywordFile = settings.general.defaultKeywordFile || ''
  if (!keywordFolder) {
    keywordCache = null
    return { ok: false, reason: 'keyword-folder-empty', groups: [] }
  }

  if (!options.force && keywordCache?.keywordFolder === keywordFolder) {
    return {
      ...keywordCache.result,
      defaultKeywordFile,
      cached: true,
    }
  }

  try {
    const entries = await fs.readdir(keywordFolder, { withFileTypes: true })
    const txtEntries = entries
      .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.txt')
      .sort((a, b) => a.name.localeCompare(b.name))

    const groups = await Promise.all(txtEntries.map(async (entry) => {
      const filePath = path.join(keywordFolder, entry.name)
      const text = await fs.readFile(filePath, 'utf8')
      return {
        type: path.basename(entry.name, path.extname(entry.name)),
        fileName: entry.name,
        filePath,
        keywords: parseKeywordFileContent(text),
      }
    }))

    const result = { ok: true, keywordFolder, defaultKeywordFile, groups, cached: false, loadedAt: new Date().toISOString() }
    keywordCache = { keywordFolder, result }
    return result
  } catch (error) {
    console.error('list keyword files failed:', error)
    keywordCache = null
    return { ok: false, reason: error.code || 'list-keyword-files-failed', groups: [] }
  }
}

async function readJsonFile(filePath, fallbackValue) {
  try {
    const text = await fs.readFile(filePath, 'utf8')
    return JSON.parse(text)
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('read json failed:', error)
    }
    return fallbackValue
  }
}

async function buildVideoFileInfo(filePath, options = {}) {
  filePath = normalizeFilePath(filePath)

  if (!isMp4File(filePath) || !(await fileExists(filePath))) {
    return { ok: false, reason: 'invalid-mp4-file' }
  }

  const folderPath = path.dirname(filePath)
  const fileName = path.basename(filePath)
  const notePath = getVideoNotePath(filePath)
  const notes = await readJsonFile(notePath, [])
  const mp4Files = await listMp4FilesInFolder(folderPath)
  const subtitleInfo = await listVideoSubtitleLanguages(filePath, options.extraSubtitleFolder)

  return {
    ok: true,
    filePath,
    fileName,
    folderPath,
    fileUrl: pathToFileURL(filePath).toString(),
    notePath,
    notes: Array.isArray(notes) ? notes : [],
    mp4Files,
    subtitleLanguages: subtitleInfo.subtitleLanguages,
    subtitleCandidates: subtitleInfo.subtitleCandidates,
    srtSubtitleCandidates: subtitleInfo.srtSubtitleCandidates,
  }
}

async function buildImageFileInfo(filePath) {
  filePath = normalizeFilePath(filePath)

  if (!isImageFile(filePath) || !(await fileExists(filePath))) {
    return { ok: false, reason: 'invalid-image-file' }
  }

  const folderPath = path.dirname(filePath)
  const fileName = path.basename(filePath)
  const notePath = getPictureNotePath(filePath)
  const note = await readJsonFile(notePath, { content: '' })
  const imageFiles = await listImageFilesInFolder(folderPath)
  const stat = await fs.stat(filePath)
  const image = nativeImage.createFromPath(filePath)
  const size = image.getSize()
  const bitDepth = await readImageBitDepth(filePath)

  return {
    ok: true,
    filePath,
    fileName,
    folderPath,
    fileUrl: pathToFileURL(filePath).toString(),
    notePath,
    note: note && typeof note === 'object' ? note : { content: '' },
    imageFiles,
    info: {
      format: path.extname(fileName).slice(1).toUpperCase(),
      fileSize: stat.size,
      width: size.width,
      height: size.height,
      bitDepth,
      fileName,
      folderPath,
    },
  }
}

async function readImageBitDepth(filePath) {
  try {
    const buffer = await fs.readFile(filePath)
    const ext = path.extname(filePath).toLowerCase()

    if (ext === '.png' && buffer.length > 25 && buffer.toString('ascii', 1, 4) === 'PNG') {
      const bitDepth = buffer.readUInt8(24)
      const colorType = buffer.readUInt8(25)
      const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType] || 1
      return `${bitDepth * channels} bit`
    }

    if ((ext === '.jpg' || ext === '.jpeg') && buffer.length > 4) {
      let offset = 2
      while (offset < buffer.length - 9) {
        if (buffer[offset] !== 0xff) {
          offset += 1
          continue
        }

        const marker = buffer[offset + 1]
        const length = buffer.readUInt16BE(offset + 2)
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
          const precision = buffer[offset + 4]
          const components = buffer[offset + 9]
          return `${precision * components} bit`
        }
        offset += 2 + length
      }
    }

    if (ext === '.bmp' && buffer.length > 30) {
      return `${buffer.readUInt16LE(28)} bit`
    }
  } catch (error) {
    console.error('read image bit depth failed:', error)
  }

  return '--'
}

async function buildImageFolderInfo(folderPath) {
  folderPath = normalizeFilePath(folderPath)
  const imageFiles = await listImageFilesInFolder(folderPath)
  const firstFile = imageFiles[0]?.filePath

  if (!firstFile) {
    return {
      ok: true,
      folderPath,
      imageFiles,
      imageFile: null,
    }
  }

  const imageFile = await buildImageFileInfo(firstFile)
  return {
    ...imageFile,
    imageFiles,
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function makeUniquePath(targetPath) {
  if (!(await pathExists(targetPath))) {
    return targetPath
  }

  const parsedPath = path.parse(targetPath)
  for (let index = 1; index < 10000; index += 1) {
    const candidate = path.join(parsedPath.dir, `${parsedPath.name}_${index}${parsedPath.ext}`)
    if (!(await pathExists(candidate))) {
      return candidate
    }
  }

  throw new Error('Cannot create unique file name')
}

async function makeUniqueImageTargetPath(targetPath) {
  if (!(await pathExists(targetPath)) && !(await pathExists(getPictureNotePath(targetPath)))) {
    return targetPath
  }

  const parsedPath = path.parse(targetPath)
  for (let index = 1; index < 10000; index += 1) {
    const candidate = path.join(parsedPath.dir, `${parsedPath.name}_${index}${parsedPath.ext}`)
    if (!(await pathExists(candidate)) && !(await pathExists(getPictureNotePath(candidate)))) {
      return candidate
    }
  }

  throw new Error('Cannot create unique image file name')
}

async function renameImageFile({ filePath, suffix, moveToTemp }) {
  const sourcePath = normalizeFilePath(filePath)
  if (!isImageFile(sourcePath) || !(await fileExists(sourcePath))) {
    return { ok: false, reason: 'invalid-image-file' }
  }

  const parsedPath = path.parse(sourcePath)
  const safeSuffix = typeof suffix === 'string' && suffix.trim()
    ? `_${suffix.trim()}`
    : ''
  const targetFolder = moveToTemp
    ? path.join(parsedPath.dir, 'tempPictures')
    : parsedPath.dir

  if (moveToTemp) {
    await fs.mkdir(targetFolder, { recursive: true })
  }

  const targetPath = await makeUniqueImageTargetPath(path.join(targetFolder, `${parsedPath.name}${safeSuffix}${parsedPath.ext}`))
  const sourceNotePath = getPictureNotePath(sourcePath)
  const targetNotePath = getPictureNotePath(targetPath)

  await fs.rename(sourcePath, targetPath)
  if (await fileExists(sourceNotePath)) {
    await fs.rename(sourceNotePath, targetNotePath)
  }

  return {
    ok: true,
    filePath: targetPath,
    folderPath: parsedPath.dir,
    imageFiles: await listImageFilesInFolder(parsedPath.dir),
  }
}

async function operateImageFile({ filePath, operation, targetFolderPath, targetFileName }) {
  const sourcePath = normalizeFilePath(filePath)
  if (!isImageFile(sourcePath) || !(await fileExists(sourcePath))) {
    return { ok: false, reason: 'invalid-image-file' }
  }

  const parsedPath = path.parse(sourcePath)
  const safeTargetFileName = path.basename(targetFileName || parsedPath.base)
  if (!isImageFile(safeTargetFileName)) {
    return { ok: false, reason: 'invalid-target-file-name' }
  }

  const normalizedTargetFolder = normalizeFilePath(targetFolderPath)
  const targetFolder = normalizedTargetFolder || (
    operation === 'move' || operation === 'moveRename'
      ? path.join(parsedPath.dir, 'tempPictures')
      : parsedPath.dir
  )

  await fs.mkdir(targetFolder, { recursive: true })

  const targetPath = await makeUniqueImageTargetPath(path.join(targetFolder, safeTargetFileName))
  const sourceNotePath = getPictureNotePath(sourcePath)
  const targetNotePath = getPictureNotePath(targetPath)

  await fs.rename(sourcePath, targetPath)
  if (await fileExists(sourceNotePath)) {
    await fs.rename(sourceNotePath, targetNotePath)
  }

  return {
    ok: true,
    filePath: targetPath,
    fileName: path.basename(targetPath),
    folderPath: parsedPath.dir,
    targetFolder,
    imageFiles: await listImageFilesInFolder(parsedPath.dir),
  }
}

function dockWindowForTextMode(options = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, reason: 'window-not-ready' }
  }

  if (!windowLayoutBeforeTextMode) {
    const bounds = mainWindow.getBounds()
    const display = screen.getDisplayMatching(bounds)

    windowLayoutBeforeTextMode = {
      bounds,
      displayId: display.id,
      wasMaximized: mainWindow.isMaximized(),
    }
  }

  const dockDisplay = screen.getAllDisplays().find(
    (display) => display.id === windowLayoutBeforeTextMode.displayId
  ) || screen.getDisplayMatching(windowLayoutBeforeTextMode.bounds)
  const workArea = dockDisplay.workArea
  const scale = Number.isFinite(Number(options?.scale)) ? Number(options.scale) : 1
  const width = Math.max(320, Math.min(workArea.width, Math.round((workArea.width / 4) * scale)))

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
  }

  const dockedBounds = {
    x: workArea.x + workArea.width - width,
    y: workArea.y,
    width,
    height: workArea.height,
  }

  mainWindow.setBounds(dockedBounds)
  windowLayoutBeforeTextMode.dockedBounds = dockedBounds

  return { ok: true }
}

function restoreWindowAfterTextMode() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, reason: 'window-not-ready' }
  }

  const previousLayout = windowLayoutBeforeTextMode
  windowLayoutBeforeTextMode = null

  if (!previousLayout) {
    mainWindow.maximize()
    return { ok: true }
  }

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
  }

  const currentBounds = mainWindow.getBounds()
  const stillAtDockedBounds = areBoundsClose(currentBounds, previousLayout.dockedBounds)

  if (!stillAtDockedBounds) {
    const currentDisplay = screen.getDisplayMatching(currentBounds)
    const workArea = currentDisplay.workArea
    const width = Math.max(800, Math.round(workArea.width * 0.8))
    const height = Math.max(600, Math.round(workArea.height * 0.8))

    mainWindow.setBounds({
      x: workArea.x + Math.round((workArea.width - width) / 2),
      y: workArea.y + Math.round((workArea.height - height) / 2),
      width,
      height,
    })
    mainWindow.maximize()
    return { ok: true }
  }

  mainWindow.setBounds(previousLayout.bounds)

  if (previousLayout.wasMaximized) {
    mainWindow.maximize()
  }

  return { ok: true }
}

function registerIpcHandlers() {
  ipcMain.handle('video:openFile', async (_event, options = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Video Files', extensions: ['mp4'] }],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true }
    }

    return buildVideoFileInfo(result.filePaths[0], options)
  })

  ipcMain.handle('video:getFileInfo', async (_event, filePath, options = {}) => buildVideoFileInfo(filePath, options))

  ipcMain.handle('video:validateMp4Path', async (_event, filePath) => ({
    ok: isMp4File(normalizeFilePath(filePath)) && (await fileExists(normalizeFilePath(filePath))),
    filePath: normalizeFilePath(filePath),
  }))

  ipcMain.handle('video:readClipboardText', async () => clipboard.readText() || '')

  ipcMain.handle('video:readNotes', async (_event, filePath) => {
    const notePath = getVideoNotePath(filePath)
    return {
      ok: true,
      notePath,
      notes: await readJsonFile(notePath, []),
    }
  })

  ipcMain.handle('video:readSubtitleText', async (_event, filePath) => {
    const subtitlePath = normalizeFilePath(filePath)
    const extension = path.extname(subtitlePath).toLowerCase()
    if (!['.vtt', '.srt'].includes(extension) || !(await fileExists(subtitlePath))) {
      return { ok: false, reason: 'invalid-subtitle-file', filePath: subtitlePath }
    }

    try {
      return {
        ok: true,
        filePath: subtitlePath,
        content: await fs.readFile(subtitlePath, 'utf8'),
      }
    } catch (error) {
      return {
        ok: false,
        filePath: subtitlePath,
        reason: error.message || String(error),
      }
    }
  })

  ipcMain.handle('video:saveNotes', async (_event, filePath, notes) => {
    const notePath = getVideoNotePath(filePath)
    await fs.writeFile(notePath, JSON.stringify(notes || [], null, 2), 'utf8')
    return { ok: true, notePath }
  })

  ipcMain.handle('video:convertSrtSubtitle', async (_event, payload) => {
    const srtPath = normalizeFilePath(payload?.filePath)
    if (path.extname(srtPath).toLowerCase() !== '.srt' || !(await fileExists(srtPath))) {
      return { ok: false, reason: 'invalid-srt-file' }
    }

    const parsedPath = path.parse(srtPath)
    const vttPath = path.join(parsedPath.dir, `${parsedPath.name}.vtt`)
    const srtText = await fs.readFile(srtPath, 'utf8')
    await fs.writeFile(vttPath, convertSrtToVtt(srtText), 'utf8')

    return {
      ok: true,
      subtitle: buildSubtitleInfo(parsedPath.dir, payload?.videoBaseName || parsedPath.name, path.basename(vttPath)),
    }
  })

  ipcMain.handle('video:listMp4Files', async (_event, folderPath) => ({
    ok: true,
    mp4Files: await listMp4FilesInFolder(folderPath),
  }))

  ipcMain.handle('image:openFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Image Files', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true }
    }

    return buildImageFileInfo(result.filePaths[0])
  })

  ipcMain.handle('image:openFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true }
    }

    return buildImageFolderInfo(result.filePaths[0])
  })

  ipcMain.handle('image:getFileInfo', async (_event, filePath) => buildImageFileInfo(filePath))

  ipcMain.handle('image:listFiles', async (_event, folderPath) => ({
    ok: true,
    imageFiles: await listImageFilesInFolder(normalizeFilePath(folderPath)),
  }))

  ipcMain.handle('image:readNote', async (_event, filePath) => {
    const notePath = getPictureNotePath(normalizeFilePath(filePath))
    return {
      ok: true,
      notePath,
      note: await readJsonFile(notePath, { content: '' }),
    }
  })

  ipcMain.handle('image:readTxtFallbackNote', async (_event, filePath) => {
    const normalizedPath = normalizeFilePath(filePath)
    if (!isImageFile(normalizedPath) || !(await fileExists(normalizedPath))) {
      return { ok: false, reason: 'invalid-image-file' }
    }

    const notePath = getPictureNotePath(normalizedPath)
    if (await fileExists(notePath)) {
      return { ok: false, reason: 'picture-note-exists', notePath }
    }

    const txtPath = getPictureTxtNotePath(normalizedPath)
    if (!(await fileExists(txtPath))) {
      return { ok: false, reason: 'txt-note-not-found', txtPath }
    }

    return {
      ok: true,
      txtPath,
      content: await fs.readFile(txtPath, 'utf8'),
    }
  })

  ipcMain.handle('image:saveNote', async (_event, filePath, note) => {
    const notePath = getPictureNotePath(normalizeFilePath(filePath))
    await fs.writeFile(notePath, JSON.stringify(note || { content: '' }, null, 2), 'utf8')
    return { ok: true, notePath }
  })

  ipcMain.handle('image:rename', async (_event, payload) => renameImageFile({ ...payload, moveToTemp: false }))
  ipcMain.handle('image:renameAndMove', async (_event, payload) => renameImageFile({ ...payload, moveToTemp: true }))
  ipcMain.handle('image:operateFile', async (_event, payload) => operateImageFile(payload))

  ipcMain.handle('text:openFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Text Files', extensions: ['txt'] }],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true }
    }

    return readWordFile(result.filePaths[0])
  })

  ipcMain.handle('text:readFile', async (_event, filePath) => readWordFile(filePath))

  ipcMain.handle('text:listTxtFiles', async (_event, folderPath) => ({
    ok: true,
    folderPath: normalizeFilePath(folderPath),
    txtFiles: await listTxtFilesInFolder(folderPath),
  }))

  ipcMain.handle('text:saveFile', async (_event, filePath, records) => saveWordFile(filePath, records))

  ipcMain.handle('text:convertFolderTxtToUtf8', async (_event, folderPath) => convertFolderTxtToUtf8(folderPath))

  ipcMain.handle('text:appendLine', async (_event, filePath, line) => appendTextLine(filePath, line))

  ipcMain.handle('text:appendSpecialTextLine', async (_event, filePath, line) => {
    const normalizedPath = normalizeFilePath(filePath)
    const targetPath = getSpecialUtf8TextFilePath(normalizedPath)
    if (!targetPath) return { ok: false, reason: 'invalid-special-text-file' }

    const result = await appendUtf8TextLine(targetPath, line)
    if (!result?.ok) return result

    return {
      ...result,
      originalPath: normalizedPath,
      renamed: targetPath !== normalizedPath,
      txtFiles: await listTxtFilesInFolder(path.dirname(targetPath)),
    }
  })

  ipcMain.handle('text:appendMonthlyNoteLine', async (_event, payload) => {
    const kind = payload?.kind === 'zh' ? 'zh' : 'en'
    const targetPath = getMonthlyNoteFilePath(payload?.folderPath, kind)
    if (!targetPath) return { ok: false, reason: 'monthly-notes-folder-not-set' }

    const result = await appendUtf8TextLine(targetPath, payload?.line || '')
    return { ...result, targetPath, kind }
  })

  ipcMain.handle('text:selectFolder', async () => selectFolderDialog())

  ipcMain.handle('text:openExternal', async (_event, filePath) => {
    const normalizedPath = normalizeFilePath(filePath)
    if (path.extname(normalizedPath).toLowerCase() !== '.txt' || !(await fileExists(normalizedPath))) {
      return { ok: false, reason: 'invalid-text-file' }
    }

    const errorMessage = await shell.openPath(normalizedPath)
    return errorMessage ? { ok: false, reason: errorMessage } : { ok: true }
  })

  ipcMain.handle('text:readClipboardText', async () => clipboard.readText() || '')
  ipcMain.handle('text:getMDictInputText', async () => getMDictInputText())
  ipcMain.handle('text:lookupMDict', async (_event, word) => lookupMDict(word))
  ipcMain.handle('text:lookupMDictRestore', async (_event, word) => lookupMDictRestore(word))
  ipcMain.handle('text:cycleMDictDictionary', async () => cycleMDictDictionary())
  ipcMain.handle('text:lookupWebster', async (_event, word) => lookupWebster(word))
  ipcMain.handle('text:lookupWebsterAndRead', async (_event, word) => lookupWebsterAndRead(word))
  ipcMain.handle('text:findDictionaryWindows', async () => findDictionaryWindows())
  ipcMain.handle('text:captureWebsterOutput', async () => captureWebsterOutput())
  ipcMain.handle('text:detectWebsterBlueText', async () => {
    const captureInfo = await captureWebsterOutput()
    if (!captureInfo?.ok) return captureInfo
    return detectWebsterBlueTextAsync(captureInfo)
  })
  ipcMain.handle('text:clickWebsterBlueText', async (_event, areaIndex = 1) => {
    const captureInfo = await captureWebsterOutput()
    if (!captureInfo?.ok) return captureInfo

    const detection = await detectWebsterBlueTextAsync(captureInfo)
    if (!detection?.ok) return detection

    const areaCount = Array.isArray(detection.areas) ? detection.areas.length : 0
    const index = areaIndex === 'last'
      ? areaCount
      : Math.max(1, Math.round(Number(areaIndex) || 1))
    const area = detection.areas?.[index - 1]
    if (!area) {
      return { ok: false, reason: 'webster-blue-area-not-found', areaIndex: index, detection }
    }

    const clickResult = await doubleClickWebsterClientPoint(area.clientX, area.clientY)
    return {
      ...clickResult,
      areaIndex: index,
      area,
      detection,
    }
  })

  ipcMain.handle('debug:show', async () => {
    createDebugWindow()
    return { ok: true }
  })

  ipcMain.handle('debug:close', async () => {
    if (debugWindow && !debugWindow.isDestroyed()) {
      debugWindow.close()
    }
    return { ok: true }
  })

  ipcMain.on('debug:log', (_event, message) => {
    appendDebugInfo(message)
  })

  ipcMain.handle('app:loadRecentState', async () => ({
    ok: true,
    recentState: await readRecentState(),
  }))

  ipcMain.handle('app:saveRecentState', async (_event, recentState) => writeRecentState(recentState))

  ipcMain.handle('app:loadSettings', async () => ({
    ok: true,
    settings: await readAppSettings(),
  }))

  ipcMain.handle('app:saveSettings', async (_event, settings) => writeAppSettings(settings))
  ipcMain.handle('app:selectFolder', async () => selectFolderDialog())
  ipcMain.handle('app:loadLastSessionState', async () => readLastSessionState())
  ipcMain.handle('app:saveLastSessionState', async (_event, sessionState) => writeLastSessionState(sessionState))

  ipcMain.handle('app:registerGlobalActivationShortcut', async (_event, shortcut) => {
    const result = registerGlobalActivationShortcut(shortcut)
    if (!result.ok) {
      appendDebugInfo(`Global activation shortcut register failed: ${shortcut || '(empty)'} (${result.reason})`)
    }
    return result
  })

  ipcMain.handle('app:focusMainWindow', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      mainWindow.webContents.focus()
    }
    return { ok: true }
  })

  ipcMain.handle('app:dockTextModeWindow', async (_event, options) => dockWindowForTextMode(options))
  ipcMain.handle('app:restoreWindowAfterTextMode', async () => restoreWindowAfterTextMode())

  ipcMain.handle('keyword:openPicker', async () => {
    createKeywordWindow()
    return { ok: true }
  })

  ipcMain.handle('keyword:list', async (_event, options) => listKeywordFiles(options))

  ipcMain.handle('keyword:insert', async (_event, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('keyword:insert', payload)
      mainWindow.show()
      mainWindow.focus()
      mainWindow.webContents.focus()
    }
    if (payload?.hideAfter && keywordWindow && !keywordWindow.isDestroyed()) {
      keywordWindow.hide()
    }
    return { ok: true }
  })

  ipcMain.handle('keyword:hidePicker', async () => {
    if (keywordWindow && !keywordWindow.isDestroyed()) {
      keywordWindow.hide()
    }
    return { ok: true }
  })

  ipcMain.handle('app:closeResponse', async (_event, canClose) => {
    closeRequestPending = false
    if (canClose && mainWindow && !mainWindow.isDestroyed()) {
      allowClose = true
      mainWindow.close()
    }
    return { ok: true }
  })
}

const createWindow = (lastSessionState = null) => {
  logStartup('createWindow start')
  const windowOptions = getRestoredWindowOptions(lastSessionState?.window)
  // Create the browser window.
  // const mainWindow = new BrowserWindow({
  mainWindow = new BrowserWindow({

    ...windowOptions.bounds,
    icon: path.join(process.cwd(), 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,
    },
  });

  if (windowOptions.isMaximized || !windowOptions.restored) {
    mainWindow.maximize()
  }

  mainWindow.webContents.once('did-finish-load', () => {
    logStartup('mainWindow did-finish-load')
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        createKeywordWindow({ show: false })
      }
    }, 600)
  })

  mainWindow.once('ready-to-show', () => {
    logStartup('mainWindow ready-to-show')
  })

  mainWindow.on('close', (event) => {
    if (allowClose) {
      return
    }

    event.preventDefault()
    if (closeRequestPending) {
      return
    }

    closeRequestPending = true
    mainWindow.webContents.send('app:requestClose')
  })

  mainWindow.on('closed', () => {
    if (debugWindow && !debugWindow.isDestroyed()) {
      debugWindow.destroy()
    }
    if (keywordWindow && !keywordWindow.isDestroyed()) {
      appQuitting = true
      keywordWindow.destroy()
    }
    debugWindow = null
    keywordWindow = null
    mainWindow = null
  })

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {

    logStartup('mainWindow loadURL start')
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    // mainWindow.loadURL('https://www.meituan.com/')

  } else {
    logStartup('mainWindow loadFile start')
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  //mr:: 必须先打开。
  //mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  logStartup('app.whenReady')

  registerIpcHandlers();
  logStartup('ipc registered')
  const startupLastSession = await readLastSessionState()
  createWindow(startupLastSession?.ok ? startupLastSession.sessionState : null);
  buildAppMenu();
  logStartup('menu built')
  const startupSettings = await readAppSettings()
  const globalShortcutResult = registerGlobalActivationShortcut(startupSettings.general.globalActivationShortcut)
  if (!globalShortcutResult.ok) {
    appendDebugInfo(`Global activation shortcut register failed: ${startupSettings.general.globalActivationShortcut} (${globalShortcutResult.reason})`)
  }
  preloadWebsterBlueDetector()

  const reactDevToolsPath = path.join(
    'C:/Users/Admin/AppData/Local/Google/Chrome/User Data/Default/Extensions/fmkadmapgofadopljbjfkapdkoienihi/7.0.1_0'
  );

  try {
    const extension = await session.defaultSession.extensions.loadExtension(
      // const extension = await mainWindow.webContents.session.loadExtension(
      reactDevToolsPath,
      {
        allowFileAccess: true,
      }
    );

    console.log('React DevTools loaded:', extension.name);



    // mainWindow.webContents.openDevTools();

  } catch (error) {
    console.error('React DevTools load failed:', error);
  }



  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  // app.on('activate', () => {
  //   if (BrowserWindow.getAllWindows().length === 0) {
  //     createWindow();
  //   }
  // });
});

app.on('will-quit', () => {
  appQuitting = true
  globalShortcut.unregisterAll()
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

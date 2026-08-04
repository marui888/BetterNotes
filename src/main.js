import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, screen, session, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import { convertSrtToVtt } from './main/srtToVtt';
import { captureWebsterOutput, doubleClickWebsterClientPoint } from './main/websterCapture';
import { listTxtFilesInFolder, readWordFile, saveWordFile } from './main/wordFileService';
import { cycleMDictDictionary, findDictionaryWindows, lookupMDict, lookupWebsterAndRead } from './main/dictionaryAhkBridge';

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
const pendingDebugMessages = []
let allowClose = false
let closeRequestPending = false
let windowLayoutBeforeTextMode = null
let websterBlueDetectorPromise = null
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

function getRecentStatePath() {
  return path.join(app.getPath('userData'), 'recent-state.json')
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
        {
          type: 'separator',
        },
        {
          label: 'Debug Info',
          click: () => createDebugWindow(),
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
          role: 'close',
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

function getVideoNotePath(filePath) {
  const parsedPath = path.parse(filePath)
  return path.join(parsedPath.dir, `${parsedPath.name}.json`)
}

function getPictureNotePath(filePath) {
  const parsedPath = path.parse(filePath)
  return path.join(parsedPath.dir, `${parsedPath.name}.picture.note.json`)
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

async function listVideoSubtitleCandidates(filePath, subtitleExtension) {
  const parsedPath = path.parse(filePath)
  const wantedExt = subtitleExtension.toLowerCase()

  try {
    const entries = await fs.readdir(parsedPath.dir, { withFileTypes: true })
    return entries
      .filter((entry) => {
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== wantedExt) {
          return false
        }

        const lowerName = entry.name.toLowerCase()
        const lowerBase = parsedPath.name.toLowerCase()
        return lowerName === `${lowerBase}${wantedExt}` || lowerName.startsWith(`${lowerBase}.`)
      })
      .map((entry) => buildSubtitleInfo(parsedPath.dir, parsedPath.name, entry.name))
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

async function listImageFilesInFolder(folderPath) {
  try {
    const entries = await fs.readdir(folderPath, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && isImageFile(entry.name))
      .map((entry) => ({
        fileName: entry.name,
        filePath: path.join(folderPath, entry.name),
      }))
      .sort((a, b) => a.fileName.localeCompare(b.fileName))
  } catch (error) {
    console.error('list image files failed:', error)
    return []
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

async function buildVideoFileInfo(filePath) {
  filePath = normalizeFilePath(filePath)

  if (!isMp4File(filePath) || !(await fileExists(filePath))) {
    return { ok: false, reason: 'invalid-mp4-file' }
  }

  const folderPath = path.dirname(filePath)
  const fileName = path.basename(filePath)
  const notePath = getVideoNotePath(filePath)
  const notes = await readJsonFile(notePath, [])
  const mp4Files = await listMp4FilesInFolder(folderPath)
  const subtitleCandidates = await listVideoSubtitleCandidates(filePath, '.vtt')
  const srtSubtitleCandidates = subtitleCandidates.length === 0
    ? await listVideoSubtitleCandidates(filePath, '.srt')
    : []

  return {
    ok: true,
    filePath,
    fileName,
    folderPath,
    fileUrl: pathToFileURL(filePath).toString(),
    notePath,
    notes: Array.isArray(notes) ? notes : [],
    mp4Files,
    subtitleCandidates,
    srtSubtitleCandidates,
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

async function operateImageFile({ filePath, operation, targetFileName }) {
  const sourcePath = normalizeFilePath(filePath)
  if (!isImageFile(sourcePath) || !(await fileExists(sourcePath))) {
    return { ok: false, reason: 'invalid-image-file' }
  }

  const parsedPath = path.parse(sourcePath)
  const safeTargetFileName = path.basename(targetFileName || parsedPath.base)
  if (!isImageFile(safeTargetFileName)) {
    return { ok: false, reason: 'invalid-target-file-name' }
  }

  const targetFolder = operation === 'move' || operation === 'moveRename'
    ? path.join(parsedPath.dir, 'tempPictures')
    : parsedPath.dir

  if (targetFolder !== parsedPath.dir) {
    await fs.mkdir(targetFolder, { recursive: true })
  }

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

function dockWindowForTextMode() {
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
  const width = Math.max(320, Math.round(workArea.width / 4))

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
  ipcMain.handle('video:openFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Video Files', extensions: ['mp4'] }],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true }
    }

    return buildVideoFileInfo(result.filePaths[0])
  })

  ipcMain.handle('video:getFileInfo', async (_event, filePath) => buildVideoFileInfo(filePath))

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

  ipcMain.handle('text:openExternal', async (_event, filePath) => {
    const normalizedPath = normalizeFilePath(filePath)
    if (path.extname(normalizedPath).toLowerCase() !== '.txt' || !(await fileExists(normalizedPath))) {
      return { ok: false, reason: 'invalid-text-file' }
    }

    const errorMessage = await shell.openPath(normalizedPath)
    return errorMessage ? { ok: false, reason: errorMessage } : { ok: true }
  })

  ipcMain.handle('text:lookupMDict', async (_event, word) => lookupMDict(word))
  ipcMain.handle('text:cycleMDictDictionary', async () => cycleMDictDictionary())
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

  ipcMain.handle('app:dockTextModeWindow', async () => dockWindowForTextMode())
  ipcMain.handle('app:restoreWindowAfterTextMode', async () => restoreWindowAfterTextMode())

  ipcMain.handle('app:closeResponse', async (_event, canClose) => {
    closeRequestPending = false
    if (canClose && mainWindow && !mainWindow.isDestroyed()) {
      allowClose = true
      mainWindow.close()
    }
    return { ok: true }
  })
}

const createWindow = () => {
  logStartup('createWindow start')
  // Create the browser window.
  // const mainWindow = new BrowserWindow({
  mainWindow = new BrowserWindow({

    width: 800,
    height: 600,
    icon: path.join(process.cwd(), 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,
    },
  });

  mainWindow.maximize()

  mainWindow.webContents.once('did-finish-load', () => {
    logStartup('mainWindow did-finish-load')
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
    debugWindow = null
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
  createWindow();
  buildAppMenu();
  logStartup('menu built')
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

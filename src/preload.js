import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('videoApi', {
  openVideoFile: (options) => ipcRenderer.invoke('video:openFile', options),
  getVideoFileInfo: (filePath, options) => ipcRenderer.invoke('video:getFileInfo', filePath, options),
  validateMp4Path: (filePath) => ipcRenderer.invoke('video:validateMp4Path', filePath),
  readNotes: (filePath) => ipcRenderer.invoke('video:readNotes', filePath),
  readSubtitleText: (filePath) => ipcRenderer.invoke('video:readSubtitleText', filePath),
  saveNotes: (filePath, notes) => ipcRenderer.invoke('video:saveNotes', filePath, notes),
  listMp4Files: (folderPath) => ipcRenderer.invoke('video:listMp4Files', folderPath),
  readClipboardText: () => ipcRenderer.invoke('video:readClipboardText'),
  convertSrtSubtitle: (payload) => ipcRenderer.invoke('video:convertSrtSubtitle', payload),
})

contextBridge.exposeInMainWorld('imageApi', {
  openImageFile: () => ipcRenderer.invoke('image:openFile'),
  openImageFolder: () => ipcRenderer.invoke('image:openFolder'),
  getImageFileInfo: (filePath) => ipcRenderer.invoke('image:getFileInfo', filePath),
  listImageFiles: (folderPath) => ipcRenderer.invoke('image:listFiles', folderPath),
  readNote: (filePath) => ipcRenderer.invoke('image:readNote', filePath),
  readTxtFallbackNote: (filePath) => ipcRenderer.invoke('image:readTxtFallbackNote', filePath),
  saveNote: (filePath, note) => ipcRenderer.invoke('image:saveNote', filePath, note),
  rename: (payload) => ipcRenderer.invoke('image:rename', payload),
  renameAndMove: (payload) => ipcRenderer.invoke('image:renameAndMove', payload),
  operateFile: (payload) => ipcRenderer.invoke('image:operateFile', payload),
})

contextBridge.exposeInMainWorld('textApi', {
  openTextFile: () => ipcRenderer.invoke('text:openFile'),
  readTextFile: (filePath) => ipcRenderer.invoke('text:readFile', filePath),
  listTxtFiles: (folderPath) => ipcRenderer.invoke('text:listTxtFiles', folderPath),
  saveTextFile: (filePath, records) => ipcRenderer.invoke('text:saveFile', filePath, records),
  convertFolderTxtToUtf8: (folderPath) => ipcRenderer.invoke('text:convertFolderTxtToUtf8', folderPath),
  appendTextLine: (filePath, line) => ipcRenderer.invoke('text:appendLine', filePath, line),
  appendSpecialTextLine: (filePath, line) => ipcRenderer.invoke('text:appendSpecialTextLine', filePath, line),
  appendMonthlyNoteLine: (payload) => ipcRenderer.invoke('text:appendMonthlyNoteLine', payload),
  selectFolder: () => ipcRenderer.invoke('text:selectFolder'),
  openTextFileExternal: (filePath) => ipcRenderer.invoke('text:openExternal', filePath),
  readClipboardText: () => ipcRenderer.invoke('text:readClipboardText'),
  getMDictInputText: () => ipcRenderer.invoke('text:getMDictInputText'),
  lookupMDict: (word) => ipcRenderer.invoke('text:lookupMDict', word),
  lookupMDictRestore: (word) => ipcRenderer.invoke('text:lookupMDictRestore', word),
  cycleMDictDictionary: () => ipcRenderer.invoke('text:cycleMDictDictionary'),
  lookupWebster: (word) => ipcRenderer.invoke('text:lookupWebster', word),
  lookupWebsterAndRead: (word) => ipcRenderer.invoke('text:lookupWebsterAndRead', word),
  findDictionaryWindows: () => ipcRenderer.invoke('text:findDictionaryWindows'),
  captureWebsterOutput: () => ipcRenderer.invoke('text:captureWebsterOutput'),
  detectWebsterBlueText: () => ipcRenderer.invoke('text:detectWebsterBlueText'),
  clickWebsterBlueText: (areaIndex) => ipcRenderer.invoke('text:clickWebsterBlueText', areaIndex),
})

contextBridge.exposeInMainWorld('appApi', {
  loadRecentState: () => ipcRenderer.invoke('app:loadRecentState'),
  saveRecentState: (recentState) => ipcRenderer.invoke('app:saveRecentState', recentState),
  loadSettings: () => ipcRenderer.invoke('app:loadSettings'),
  saveSettings: (settings) => ipcRenderer.invoke('app:saveSettings', settings),
  selectFolder: () => ipcRenderer.invoke('app:selectFolder'),
  loadLastSessionState: () => ipcRenderer.invoke('app:loadLastSessionState'),
  saveLastSessionState: (sessionState) => ipcRenderer.invoke('app:saveLastSessionState', sessionState),
  registerGlobalActivationShortcut: (shortcut) => ipcRenderer.invoke('app:registerGlobalActivationShortcut', shortcut),
  onShowSettings: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('app:showSettings', listener)
    return () => ipcRenderer.removeListener('app:showSettings', listener)
  },
  onConvertTxtToUtf8: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('app:convertTxtToUtf8', listener)
    return () => ipcRenderer.removeListener('app:convertTxtToUtf8', listener)
  },
  onRequestClose: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('app:requestClose', listener)
    return () => ipcRenderer.removeListener('app:requestClose', listener)
  },
  closeResponse: (canClose) => ipcRenderer.invoke('app:closeResponse', canClose),
  focusMainWindow: () => ipcRenderer.invoke('app:focusMainWindow'),
  dockTextModeWindow: (options) => ipcRenderer.invoke('app:dockTextModeWindow', options),
  restoreWindowAfterTextMode: () => ipcRenderer.invoke('app:restoreWindowAfterTextMode'),
})

contextBridge.exposeInMainWorld('keywordApi', {
  openPicker: () => ipcRenderer.invoke('keyword:openPicker'),
  listKeywords: (options) => ipcRenderer.invoke('keyword:list', options),
  insertKeywords: (payload) => ipcRenderer.invoke('keyword:insert', payload),
  hidePicker: () => ipcRenderer.invoke('keyword:hidePicker'),
  onOpen: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('keyword:opened', listener)
    return () => ipcRenderer.removeListener('keyword:opened', listener)
  },
  onInsert: (handler) => {
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('keyword:insert', listener)
    return () => ipcRenderer.removeListener('keyword:insert', listener)
  },
})

contextBridge.exposeInMainWorld('debugApi', {
  log: (message) => ipcRenderer.send('debug:log', message),
  show: () => ipcRenderer.invoke('debug:show'),
  close: () => ipcRenderer.invoke('debug:close'),
  onAppend: (handler) => {
    const listener = (_event, item) => handler(item)
    ipcRenderer.on('debug:append', listener)
    return () => ipcRenderer.removeListener('debug:append', listener)
  },
})

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('videoApi', {
  openVideoFile: () => ipcRenderer.invoke('video:openFile'),
  getVideoFileInfo: (filePath) => ipcRenderer.invoke('video:getFileInfo', filePath),
  validateMp4Path: (filePath) => ipcRenderer.invoke('video:validateMp4Path', filePath),
  readNotes: (filePath) => ipcRenderer.invoke('video:readNotes', filePath),
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
  openTextFileExternal: (filePath) => ipcRenderer.invoke('text:openExternal', filePath),
  lookupMDict: (word) => ipcRenderer.invoke('text:lookupMDict', word),
  cycleMDictDictionary: () => ipcRenderer.invoke('text:cycleMDictDictionary'),
  lookupWebsterAndRead: (word) => ipcRenderer.invoke('text:lookupWebsterAndRead', word),
  findDictionaryWindows: () => ipcRenderer.invoke('text:findDictionaryWindows'),
  captureWebsterOutput: () => ipcRenderer.invoke('text:captureWebsterOutput'),
  detectWebsterBlueText: () => ipcRenderer.invoke('text:detectWebsterBlueText'),
  clickWebsterBlueText: (areaIndex) => ipcRenderer.invoke('text:clickWebsterBlueText', areaIndex),
})

contextBridge.exposeInMainWorld('appApi', {
  loadRecentState: () => ipcRenderer.invoke('app:loadRecentState'),
  saveRecentState: (recentState) => ipcRenderer.invoke('app:saveRecentState', recentState),
  onRequestClose: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('app:requestClose', listener)
    return () => ipcRenderer.removeListener('app:requestClose', listener)
  },
  closeResponse: (canClose) => ipcRenderer.invoke('app:closeResponse', canClose),
  dockTextModeWindow: () => ipcRenderer.invoke('app:dockTextModeWindow'),
  restoreWindowAfterTextMode: () => ipcRenderer.invoke('app:restoreWindowAfterTextMode'),
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

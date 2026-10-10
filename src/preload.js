import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('videoApi', {
  openVideoFile: (options) => ipcRenderer.invoke('video:openFile', options),
  importNotesText: () => ipcRenderer.invoke('video:importNotesText'),
  getVideoFileInfo: (filePath, options) => ipcRenderer.invoke('video:getFileInfo', filePath, options),
  resolveVideoPath: (filePath) => ipcRenderer.invoke('video:resolveVideoPath', filePath),
  readNotes: (filePath) => ipcRenderer.invoke('video:readNotes', filePath),
  readSubtitleText: (filePath) => ipcRenderer.invoke('video:readSubtitleText', filePath),
  updateVttCueText: (payload) => ipcRenderer.invoke('video:updateVttCueText', payload),
  openSubtitleExternal: (filePath) => ipcRenderer.invoke('video:openSubtitleExternal', filePath),
  selectLegacyNoteFiles: () => ipcRenderer.invoke('video:selectLegacyNoteFiles'),
  selectLegacyNoteFolder: (options) => ipcRenderer.invoke('video:selectLegacyNoteFolder', options),
  loadLegacyNoteSources: (sources) => ipcRenderer.invoke('video:loadLegacyNoteSources', sources),
  saveLegacyNoteContent: (payload) => ipcRenderer.invoke('video:saveLegacyNoteContent', payload),
  saveNotes: (filePath, notes, expectedModifiedTime) => (
    ipcRenderer.invoke('video:saveNotes', filePath, notes, expectedModifiedTime)
  ),
  listMp4Files: (folderPath) => ipcRenderer.invoke('video:listMp4Files', folderPath),
  showFileInFolder: (filePath) => ipcRenderer.invoke('video:showFileInFolder', filePath),
  renameFile: (payload) => ipcRenderer.invoke('video:renameFile', payload),
  readClipboardText: () => ipcRenderer.invoke('video:readClipboardText'),
  writeClipboardText: (text) => ipcRenderer.invoke('video:writeClipboardText', text),
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
  writeClipboardText: (text) => ipcRenderer.invoke('text:writeClipboardText', text),
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

contextBridge.exposeInMainWorld('wordLibraryApi', {
  getStatus: () => ipcRenderer.invoke('wordLibrary:getStatus'),
  listSources: () => ipcRenderer.invoke('wordLibrary:listSources'),
  getFilterOptions: () => ipcRenderer.invoke('wordLibrary:getFilterOptions'),
  query: (filters, options) => ipcRenderer.invoke('wordLibrary:query', filters, options),
  saveFilterFile: (filters) => ipcRenderer.invoke('wordLibrary:saveFilterFile', filters),
  loadFilterFile: () => ipcRenderer.invoke('wordLibrary:loadFilterFile'),
  listStudyPlans: () => ipcRenderer.invoke('wordLibrary:listStudyPlans'),
  deleteStudyPlan: (planId) => ipcRenderer.invoke('wordLibrary:deleteStudyPlan', planId),
  createStudyPlan: (payload) => ipcRenderer.invoke('wordLibrary:createStudyPlan', payload),
  refreshStudyPlanScope: (planId) => ipcRenderer.invoke('wordLibrary:refreshStudyPlanScope', planId),
  listStudyPlanItems: (planId, options) => (
    ipcRenderer.invoke('wordLibrary:listStudyPlanItems', planId, options)
  ),
  getStudyPlanItemOccurrences: (planId, planItemId) => (
    ipcRenderer.invoke('wordLibrary:getStudyPlanItemOccurrences', planId, planItemId)
  ),
  getActiveStudySession: () => ipcRenderer.invoke('wordLibrary:getActiveStudySession'),
  startStudySession: (planId) => ipcRenderer.invoke('wordLibrary:startStudySession', planId),
  applyStudyReviewAction: (sessionId, action) => (
    ipcRenderer.invoke('wordLibrary:applyStudyReviewAction', sessionId, action)
  ),
  reviewTo: (planId, planItemId) => ipcRenderer.invoke('wordLibrary:reviewTo', planId, planItemId),
  endStudySession: (sessionId) => ipcRenderer.invoke('wordLibrary:endStudySession', sessionId),
  listStudyReviewHistory: (planId, options) => (
    ipcRenderer.invoke('wordLibrary:listStudyReviewHistory', planId, options)
  ),
  listStudyReviewEvents: (sessionId) => (
    ipcRenderer.invoke('wordLibrary:listStudyReviewEvents', sessionId)
  ),
  addSource: () => ipcRenderer.invoke('wordLibrary:addSource'),
  refreshSources: (enabledSourceIds) => ipcRenderer.invoke('wordLibrary:refreshSources', enabledSourceIds),
  deleteSource: (sourceId) => ipcRenderer.invoke('wordLibrary:deleteSource', sourceId),
})

contextBridge.exposeInMainWorld('mixedNotesApi', {
  listSources: () => ipcRenderer.invoke('mixedNotes:listSources'),
  getFilterOptions: () => ipcRenderer.invoke('mixedNotes:getFilterOptions'),
  query: (filters, options) => ipcRenderer.invoke('mixedNotes:query', filters, options),
  saveFilterFile: (filters) => ipcRenderer.invoke('mixedNotes:saveFilterFile', filters),
  loadFilterFile: () => ipcRenderer.invoke('mixedNotes:loadFilterFile'),
  listStudyPlans: () => ipcRenderer.invoke('mixedNotes:listStudyPlans'),
  deleteStudyPlan: (id) => ipcRenderer.invoke('mixedNotes:deleteStudyPlan', id),
  createStudyPlan: (payload) => ipcRenderer.invoke('mixedNotes:createStudyPlan', payload),
  refreshStudyPlanScope: (id) => ipcRenderer.invoke('mixedNotes:refreshStudyPlanScope', id),
  listStudyPlanItems: (id, options) => ipcRenderer.invoke('mixedNotes:listStudyPlanItems', id, options),
  getStudyPlanItemOccurrences: (planId, itemId) => ipcRenderer.invoke('mixedNotes:getStudyPlanItemOccurrences', planId, itemId),
  getActiveStudySession: () => ipcRenderer.invoke('mixedNotes:getActiveStudySession'),
  startStudySession: (id) => ipcRenderer.invoke('mixedNotes:startStudySession', id),
  applyStudyReviewAction: (id, action) => ipcRenderer.invoke('mixedNotes:applyStudyReviewAction', id, action),
  reviewTo: (planId, itemId) => ipcRenderer.invoke('mixedNotes:reviewTo', planId, itemId),
  endStudySession: (id) => ipcRenderer.invoke('mixedNotes:endStudySession', id),
  listStudyReviewHistory: (id, options) => ipcRenderer.invoke('mixedNotes:listStudyReviewHistory', id, options),
  listStudyReviewEvents: (id) => ipcRenderer.invoke('mixedNotes:listStudyReviewEvents', id),
  addSource: () => ipcRenderer.invoke('mixedNotes:addSource'),
  refreshSources: (ids) => ipcRenderer.invoke('mixedNotes:refreshSources', ids),
  deleteSource: (id) => ipcRenderer.invoke('mixedNotes:deleteSource', id),
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
  onGlobalActivationChanged: (handler) => {
    const listener = (_event, state) => handler(state)
    ipcRenderer.on('app:globalActivationChanged', listener)
    return () => ipcRenderer.removeListener('app:globalActivationChanged', listener)
  },
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

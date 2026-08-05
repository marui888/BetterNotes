import { create } from 'zustand'

export const APP_MODES = {
  VIDEO: 'video',
  IMAGE: 'image',
  TEXT: 'text',
  SEARCH: 'search',
}

const RECENT_FILES_STORAGE_KEY = 'recentFilesByMode'
const RECENT_FOLDERS_STORAGE_KEY = 'recentFoldersByMode'
const EMPTY_RECENT_FILES = {
  video: [],
  image: [],
  text: [],
  search: [],
}
const EMPTY_RECENT_FOLDERS = {
  video: [],
  image: [],
  text: [],
  search: [],
}

function cloneRecentBuckets(value) {
  return {
    video: Array.isArray(value?.video) ? [...value.video] : [],
    image: Array.isArray(value?.image) ? [...value.image] : [],
    text: Array.isArray(value?.text) ? [...value.text] : [],
    search: Array.isArray(value?.search) ? [...value.search] : [],
  }
}

function normalizeRecentState(recentState) {
  return {
    recentFiles: cloneRecentBuckets(recentState?.recentFiles),
    recentFolders: cloneRecentBuckets(recentState?.recentFolders),
  }
}

function mergeRecentBuckets(primary, fallback) {
  return {
    video: [...new Set([...(primary.video || []), ...(fallback.video || [])])].slice(0, 20),
    image: [...new Set([...(primary.image || []), ...(fallback.image || [])])].slice(0, 20),
    text: [...new Set([...(primary.text || []), ...(fallback.text || [])])].slice(0, 20),
    search: [...new Set([...(primary.search || []), ...(fallback.search || [])])].slice(0, 20),
  }
}

function loadRecentFilesFromLocalStorage() {
  if (typeof localStorage === 'undefined') {
    return cloneRecentBuckets(EMPTY_RECENT_FILES)
  }

  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_FILES_STORAGE_KEY) || '{}')
    return cloneRecentBuckets(parsed)
  } catch {
    return cloneRecentBuckets(EMPTY_RECENT_FILES)
  }
}

function saveRecentFilesToLocalStorage(recentFiles) {
  if (typeof localStorage === 'undefined') {
    return
  }

  localStorage.setItem(RECENT_FILES_STORAGE_KEY, JSON.stringify(recentFiles))
}

function loadRecentFoldersFromLocalStorage() {
  if (typeof localStorage === 'undefined') {
    return cloneRecentBuckets(EMPTY_RECENT_FOLDERS)
  }

  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_FOLDERS_STORAGE_KEY) || '{}')
    return cloneRecentBuckets(parsed)
  } catch {
    return cloneRecentBuckets(EMPTY_RECENT_FOLDERS)
  }
}

function saveRecentFoldersToLocalStorage(recentFolders) {
  if (typeof localStorage === 'undefined') {
    return
  }

  localStorage.setItem(RECENT_FOLDERS_STORAGE_KEY, JSON.stringify(recentFolders))
}

function saveRecentState(recentFiles, recentFolders) {
  const recentState = normalizeRecentState({ recentFiles, recentFolders })
  saveRecentFilesToLocalStorage(recentState.recentFiles)
  saveRecentFoldersToLocalStorage(recentState.recentFolders)
  const savePromise = window.appApi?.saveRecentState?.(recentState)
  savePromise?.catch?.((error) => {
    console.error('save recent state failed:', error)
  })
}

const initialRecentFiles = loadRecentFilesFromLocalStorage()
const initialRecentFolders = loadRecentFoldersFromLocalStorage()

export const useAppStore = create((set) => ({
  mode: APP_MODES.VIDEO,
  currentFile: null,
  dirty: false,
  dirtyByMode: {
    video: false,
    image: false,
    text: false,
    search: false,
  },
  textAutoPlayRunning: false,
  recentFiles: initialRecentFiles,
  recentFolders: initialRecentFolders,
  leaveGuards: {},
  sessionProviders: {},
  restoreSessionState: null,

  initializeRecentState: async () => {
    if (!window.appApi?.loadRecentState) {
      return
    }

    try {
      const result = await window.appApi.loadRecentState()
      if (!result?.ok) {
        return
      }

      const hostRecentState = normalizeRecentState(result.recentState)
      const recentState = {
        recentFiles: mergeRecentBuckets(hostRecentState.recentFiles, initialRecentFiles),
        recentFolders: mergeRecentBuckets(hostRecentState.recentFolders, initialRecentFolders),
      }
      saveRecentFilesToLocalStorage(recentState.recentFiles)
      saveRecentFoldersToLocalStorage(recentState.recentFolders)
      window.appApi?.saveRecentState?.(recentState)
      set({
        recentFiles: recentState.recentFiles,
        recentFolders: recentState.recentFolders,
      })
    } catch (error) {
      console.error('load recent state failed:', error)
    }
  },
  setMode: (mode) => set({ mode }),
  setCurrentFile: (currentFile) => set({ currentFile }),
  setDirty: (modeOrDirty, maybeDirty) =>
    set((state) => {
      if (typeof modeOrDirty === 'string') {
        const dirty = Boolean(maybeDirty)
        return {
          dirty: Object.entries({
            ...state.dirtyByMode,
            [modeOrDirty]: dirty,
          }).some(([, value]) => value),
          dirtyByMode: {
            ...state.dirtyByMode,
            [modeOrDirty]: dirty,
          },
        }
      }

      return {
        dirty: Boolean(modeOrDirty),
      }
    }),
  setTextAutoPlayRunning: (textAutoPlayRunning) => set({ textAutoPlayRunning }),
  setLeaveGuard: (modeOrGuard, maybeGuard) =>
    set((state) => {
      if (typeof modeOrGuard === 'string') {
        const leaveGuards = { ...state.leaveGuards }
        if (maybeGuard) {
          leaveGuards[modeOrGuard] = maybeGuard
        } else {
          delete leaveGuards[modeOrGuard]
        }
        return { leaveGuards }
      }

      return { leaveGuards: { ...state.leaveGuards, global: modeOrGuard } }
    }),
  registerSessionProvider: (mode, provider) =>
    set((state) => ({
      sessionProviders: provider
        ? { ...state.sessionProviders, [mode]: provider }
        : Object.fromEntries(Object.entries(state.sessionProviders).filter(([key]) => key !== mode)),
    })),
  setRestoreSessionState: (restoreSessionState) => set({ restoreSessionState }),
  addRecentFile: (mode, filePath) =>
    set((state) => {
      if (!mode || !filePath) {
        return state
      }

      const currentList = Array.isArray(state.recentFiles[mode])
        ? state.recentFiles[mode]
        : []
      const nextList = [
        filePath,
        ...currentList.filter((item) => item !== filePath),
      ].slice(0, 20)
      const recentFiles = {
        ...state.recentFiles,
        [mode]: nextList,
      }

      saveRecentState(recentFiles, state.recentFolders)
      return { recentFiles }
    }),
  addRecentFolder: (mode, folderPath) =>
    set((state) => {
      if (!mode || !folderPath) {
        return state
      }

      const currentList = Array.isArray(state.recentFolders[mode])
        ? state.recentFolders[mode]
        : []
      const nextList = [
        folderPath,
        ...currentList.filter((item) => item !== folderPath),
      ].slice(0, 20)
      const recentFolders = {
        ...state.recentFolders,
        [mode]: nextList,
      }

      saveRecentState(state.recentFiles, recentFolders)
      return { recentFolders }
    }),
}))

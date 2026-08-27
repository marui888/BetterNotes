import { create } from 'zustand'
import { APP_MODES } from './appStore'

export const SHORTCUT_SCOPES = {
  VIDEO: APP_MODES.VIDEO,
  IMAGE: APP_MODES.IMAGE,
  TEXT: APP_MODES.TEXT,
  SEARCH: APP_MODES.SEARCH,
  GLOBAL: 'global',
}

export const DEFAULT_APP_SETTINGS = {
  general: {
    defaultMode: APP_MODES.VIDEO,
    globalActivationShortcut: 'Ctrl+Alt+F',
    monthlyNotesFolder: '',
    specialTextFolder: '',
    keywordFolder: '',
    defaultKeywordFile: '',
    extraSubtitleFolder: '',
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
    [APP_MODES.VIDEO]: {
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
    [APP_MODES.IMAGE]: {
      'image.intoEditingFocus': 'Alt+E',
      'image.previousImage': '',
      'image.nextImage': '',
      'image.saveNote': '',
      'image.renameFile': '',
      'image.moveFile': '',
      'image.moveRenameFile': '',
    },
    [APP_MODES.TEXT]: {
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
    [APP_MODES.SEARCH]: {},
    global: {
      'global.switchToVideo': 'Ctrl+K V',
      'global.switchToPicture': 'Ctrl+K P',
      'global.switchToText': 'Ctrl+K T',
      'global.switchToManagement': 'Ctrl+K M',
    },
  },
}

function mergeShortcutBucket(scope, value) {
  const defaults = DEFAULT_APP_SETTINGS.shortcuts[scope] || {}
  const merged = value && typeof value === 'object'
    ? { ...defaults, ...value }
    : { ...defaults }
  if (scope === APP_MODES.VIDEO && !merged['video.intoEditingFocus'] && value?.['video.toggleFocus']) {
    merged['video.intoEditingFocus'] = value['video.toggleFocus']
  }
  if (scope === APP_MODES.VIDEO && !merged['video.quickUpdateRange'] && value?.['video.updateRange']) {
    merged['video.quickUpdateRange'] = value['video.updateRange']
  }
  if (scope === APP_MODES.TEXT && !merged['text.saveToSpecificFile'] && value?.['text.saveTo']) {
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
    [APP_MODES.VIDEO]: mergeShortcutBucket(APP_MODES.VIDEO, value?.[APP_MODES.VIDEO]),
    [APP_MODES.IMAGE]: mergeShortcutBucket(APP_MODES.IMAGE, value?.[APP_MODES.IMAGE]),
    [APP_MODES.TEXT]: mergeShortcutBucket(APP_MODES.TEXT, value?.[APP_MODES.TEXT]),
    [APP_MODES.SEARCH]: mergeShortcutBucket(APP_MODES.SEARCH, value?.[APP_MODES.SEARCH]),
    global: mergeShortcutBucket('global', value?.global),
  }
}

export function normalizeAppSettings(value) {
  const defaultMode = Object.values(APP_MODES).includes(value?.general?.defaultMode)
    ? value.general.defaultMode
    : DEFAULT_APP_SETTINGS.general.defaultMode
  const globalActivationShortcut = typeof value?.general?.globalActivationShortcut === 'string'
    ? value.general.globalActivationShortcut
    : DEFAULT_APP_SETTINGS.general.globalActivationShortcut
  const monthlyNotesFolder = typeof value?.general?.monthlyNotesFolder === 'string'
    ? value.general.monthlyNotesFolder
    : DEFAULT_APP_SETTINGS.general.monthlyNotesFolder
  const specialTextFolder = typeof value?.general?.specialTextFolder === 'string'
    ? value.general.specialTextFolder
    : DEFAULT_APP_SETTINGS.general.specialTextFolder
  const keywordFolder = typeof value?.general?.keywordFolder === 'string'
    ? value.general.keywordFolder
    : DEFAULT_APP_SETTINGS.general.keywordFolder
  const defaultKeywordFile = typeof value?.general?.defaultKeywordFile === 'string'
    ? value.general.defaultKeywordFile
    : DEFAULT_APP_SETTINGS.general.defaultKeywordFile
  const extraSubtitleFolder = typeof value?.general?.extraSubtitleFolder === 'string'
    ? value.general.extraSubtitleFolder.trim()
    : DEFAULT_APP_SETTINGS.general.extraSubtitleFolder
  const playAllSubtitleSuffix = typeof value?.general?.playAllSubtitleSuffix === 'string'
    ? value.general.playAllSubtitleSuffix
    : DEFAULT_APP_SETTINGS.general.playAllSubtitleSuffix
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
    ? value.general.picModeWideMoveFolder.trim()
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

export const useSettingsStore = create((set, get) => ({
  initialized: false,
  settings: DEFAULT_APP_SETTINGS,

  initializeSettings: async () => {
    if (!window.appApi?.loadSettings) {
      set({ initialized: true })
      return DEFAULT_APP_SETTINGS
    }

    try {
      const result = await window.appApi.loadSettings()
      const settings = normalizeAppSettings(result?.settings)
      set({ initialized: true, settings })
      return settings
    } catch (error) {
      console.error('load settings failed:', error)
      set({ initialized: true })
      return get().settings
    }
  },

  saveSettings: async (nextSettings) => {
    const settings = normalizeAppSettings(nextSettings)
    if (window.appApi?.saveSettings) {
      const result = await window.appApi.saveSettings(settings)
      const savedSettings = normalizeAppSettings(result?.settings || settings)
      set({ settings: savedSettings })
      return savedSettings
    }

    set({ settings })
    return settings
  },
}))

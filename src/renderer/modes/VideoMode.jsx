import { useEffect, useMemo, useRef, useState } from 'react'
import { APP_MODES, useAppStore } from '../../stores/appStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useVideoStore } from '../../stores/videoStore'
import { registerActions, runAction } from '../actions/actionRegistry'
import FilterHistoryInput from '../components/FilterHistoryInput'
import SimpleContextMenu from '../components/SimpleContextMenu'
import useKeywordInsertion from '../hooks/useKeywordInsertion'
import { compileFilterExpression } from '../utils/filterExpression'
import RollingSubtitlePanel from '../components/rollingSubtitle'
import { parseSubtitleCues } from '../video/subtitleParser'
import VideoPlayer from '../video/VideoPlayer'

const PLAYBACK_RATES = [0.1, 0.3, 0.5, 0.8, 0.9, 1, 1.2, 1.4, 1.6, 1.8, 2.0]
const SHORT_JUMP_SECONDS = 2
const LONG_JUMP_SECONDS = 8
const QUICK_NOTE_FORWARD_SECONDS = 5
const QUICK_NOTE_BACKWARD_SECONDS = 2
const PLAYBACK_RATE_STEP = 0.05
const MIN_PLAYBACK_RATE = 0.1
const MAX_PLAYBACK_RATE = 2
const VOLUME_STEP = 0.05
const VIDEO_OPACITY_STEP = 0.1
const VIDEO_VERTICAL_SPLITTER_WIDTH = 6
const SUBTITLE_CENTER_VIEW_HIDDEN_DIM = 1
const MAX_FILTER_HISTORY_ITEMS = 50
const MAX_NOTES_POOL_FOLDER_DEPTH = 4
const MAX_NOTES_POOL_SOURCES = 50
const SUBTITLE_PICK_CHORD_ACTIONS = [
  { actionId: 'subtitlePick.copySave', key: 'Z', label: 'Copy&Save&Exit', decision: 'copySave' },
  { actionId: 'subtitlePick.copy', key: 'X', label: 'Copy&Exit', decision: 'copy' },
  { actionId: 'subtitlePick.save', key: 'C', label: 'Save&Exit', decision: 'save' },
  { actionId: 'subtitlePick.cancel', key: 'V', label: 'Cancel', decision: 'cancel' },
]
const SUBTITLE_READING_CHORD_ACTIONS = SUBTITLE_PICK_CHORD_ACTIONS.map((action) => ({
  ...action,
  label: action.label.replace('&Exit', ''),
}))
const SUBTITLE_SPEAK_PADDING_SECONDS = 0
const MAX_READING_POSITIONS = 30
const ROLLING_PANEL_DOCK_POSITIONS = ['left', 'center', 'right']
const MP4_SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'createdTime', label: 'MP4 created' },
  { value: 'jsonModifiedTime', label: 'JSON modified' },
]
const VIDEO_OPEN_SOURCES = ['default', 'pool']

const createLoadedVideoState = () => ({
  activeSource: 'default',
  activeLoaded: false,
  sources: {
    default: { filePath: '', playbackTime: 0 },
    pool: { filePath: '', playbackTime: 0 },
  },
})

function normalizeLoadedVideoSlot(value) {
  const playbackTime = Number(value?.playbackTime)
  return {
    filePath: typeof value?.filePath === 'string' ? value.filePath : '',
    playbackTime: Number.isFinite(playbackTime) && playbackTime >= 0 ? playbackTime : 0,
  }
}

function normalizeLoadedVideoState(value, legacySnapshot = null) {
  const normalized = createLoadedVideoState()
  const activeSource = VIDEO_OPEN_SOURCES.includes(value?.activeSource)
    ? value.activeSource
    : legacySnapshot?.videoOpenSource === 'pool' ? 'pool' : 'default'
  normalized.activeSource = activeSource
  normalized.activeLoaded = typeof value?.activeLoaded === 'boolean'
    ? value.activeLoaded
    : Boolean(value?.sources?.[activeSource]?.filePath || legacySnapshot?.currentFilePath)
  normalized.sources.default = normalizeLoadedVideoSlot(value?.sources?.default)
  normalized.sources.pool = normalizeLoadedVideoSlot(value?.sources?.pool)

  if (!normalized.sources[activeSource].filePath && legacySnapshot?.currentFilePath) {
    normalized.sources[activeSource] = normalizeLoadedVideoSlot({
      filePath: legacySnapshot.currentFilePath,
      playbackTime: legacySnapshot.playbackTime,
    })
  }

  return normalized
}
const FULLSCREEN_LAYOUT_KEYS = {
  0: 'f0',
  3: 'f3',
  4: 'f4',
}

const createFullscreenViewState = () => ({
  hideSub: false,
  hideView: false,
  hvLayout: 0,
  videoOpacity: 1,
})

const createFullscreenViewStates = () => ({
  f0: createFullscreenViewState(),
  f3: createFullscreenViewState(),
  f4: createFullscreenViewState(),
})

function normalizeFullscreenViewState(value) {
  const rawVideoOpacity = value?.videoOpacity
  const hasVideoOpacity = rawVideoOpacity !== null
    && rawVideoOpacity !== undefined
    && rawVideoOpacity !== ''
    && Number.isFinite(Number(rawVideoOpacity))
  const videoOpacity = hasVideoOpacity
    ? Math.max(0, Math.min(1, Math.round(Number(rawVideoOpacity) * 10) / 10))
    : value?.hideView === true ? 0 : 1
  return {
    hideSub: value?.hideSub === true,
    hideView: videoOpacity === 0,
    hvLayout: Number(value?.hvLayout) === 1 ? 1 : 0,
    videoOpacity,
  }
}

function normalizeToggleViewSnapshot(value, legacyActiveState = 0) {
  return {
    activeState: Number(value?.activeState ?? legacyActiveState) === 4 ? 4 : 0,
    states: {
      f0: normalizeFullscreenViewState(value?.states?.f0),
      f4: normalizeFullscreenViewState(value?.states?.f4),
    },
  }
}

function normalizeRollingPanelViewState(value, fallbackFontSize = null) {
  const numberOrNull = (candidate) => (
    candidate !== null && candidate !== undefined && candidate !== '' && Number.isFinite(Number(candidate))
      ? Number(candidate)
      : null
  )
  const dockPosition = ROLLING_PANEL_DOCK_POSITIONS.includes(value?.dockPosition)
    ? value.dockPosition
    : 'left'
  const fontSize = Number(value?.fontSize ?? fallbackFontSize)
  return {
    x: numberOrNull(value?.x),
    y: numberOrNull(value?.y),
    width: numberOrNull(value?.width),
    height: numberOrNull(value?.height),
    fontSize: (value?.fontSize ?? fallbackFontSize) !== null
      && (value?.fontSize ?? fallbackFontSize) !== undefined
      && (value?.fontSize ?? fallbackFontSize) !== ''
      && Number.isFinite(fontSize)
      ? Math.max(10, Math.min(92, fontSize))
      : null,
    dockPosition,
  }
}

function normalizeRollingPanelViewSnapshot(value, fallbackFontSize = null) {
  return {
    states: {
      f0: normalizeRollingPanelViewState(value?.states?.f0, fallbackFontSize),
      f4: normalizeRollingPanelViewState(value?.states?.f4, fallbackFontSize),
    },
  }
}

function normalizePlayingView(value, legacyPlaybackRate = 1) {
  const playbackRate = Number(value?.playbackRate ?? legacyPlaybackRate)
  const volume = Number(value?.volume)
  return {
    playbackRate: Number.isFinite(playbackRate)
      ? Math.max(MIN_PLAYBACK_RATE, Math.min(MAX_PLAYBACK_RATE, playbackRate))
      : 1,
    volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1,
  }
}

function normalizeFilterHistory(value) {
  const seen = new Set()
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false
      seen.add(item)
      return true
    })
    .slice(0, MAX_FILTER_HISTORY_ITEMS)
}

function normalizeMp4FileEntry(entry) {
  if (typeof entry === 'string') {
    return { fileName: entry, createdTime: null, jsonModifiedTime: null }
  }

  return {
    fileName: String(entry?.fileName || ''),
    createdTime: entry?.createdTime != null && Number.isFinite(Number(entry.createdTime))
      ? Number(entry.createdTime)
      : null,
    jsonModifiedTime: entry?.jsonModifiedTime != null && Number.isFinite(Number(entry.jsonModifiedTime))
      ? Number(entry.jsonModifiedTime)
      : null,
  }
}

function compareMp4FileNames(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

function sortMp4Files(files, sortKey, sortDirection) {
  const direction = sortDirection === 'desc' ? -1 : 1
  return (Array.isArray(files) ? files : [])
    .map(normalizeMp4FileEntry)
    .filter((entry) => entry.fileName)
    .sort((a, b) => {
      if (sortKey === 'createdTime' || sortKey === 'jsonModifiedTime') {
        const aTime = a[sortKey]
        const bTime = b[sortKey]
        const aMissing = !Number.isFinite(aTime)
        const bMissing = !Number.isFinite(bTime)
        if (aMissing !== bMissing) return aMissing ? 1 : -1
        if (!aMissing && aTime !== bTime) return (aTime - bTime) * direction
      }

      return compareMp4FileNames(a.fileName, b.fileName) * direction
    })
}
const MIN_NOTE_ITEM_FONT_SIZE = 9
const MAX_NOTE_ITEM_FONT_SIZE = 18
const CONTEXT_MENU_WIDTH = 210
const CONTEXT_MENU_ITEM_HEIGHT = 36
const CONTEXT_MENU_OFFSET = 8
const CONTEXT_MENU_PADDING = 8

function formatTime(seconds) {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const wholeSeconds = Math.floor(value)
  const hours = Math.floor(wholeSeconds / 3600)
  const minutes = Math.floor((wholeSeconds % 3600) / 60)
  const secs = wholeSeconds % 60
  const pad = (part) => part.toString().padStart(2, '0')

  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}.0`
}

function formatDuration(seconds) {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  if (value < 60) return `+${value.toFixed(1)}s`

  const wholeSeconds = Math.floor(value)
  const minutes = Math.floor(wholeSeconds / 60)
  const secs = wholeSeconds % 60
  const fraction = Math.floor((value - wholeSeconds) * 10)
  return `+${minutes}:${secs.toString().padStart(2, '0')}.${fraction}`
}

function countTextMatches(text, findText) {
  const source = String(text || '')
  const needle = String(findText || '')
  if (!needle) return 0

  let count = 0
  let index = source.indexOf(needle)
  while (index >= 0) {
    count += 1
    index = source.indexOf(needle, index + needle.length)
  }
  return count
}

function replaceAllText(text, findText, replaceText) {
  if (!findText) return String(text || '')
  return String(text || '').split(findText).join(replaceText)
}

function getNoteDuration(note) {
  const startSeconds = parseTime(note?.start)
  const endSeconds = parseTime(note?.end)
  return Number.isFinite(startSeconds) && Number.isFinite(endSeconds)
    ? endSeconds - startSeconds
    : Number.NaN
}

function parseTime(timeText) {
  if (!timeText) return Number.NaN

  const parts = timeText.split(':')
  if (parts.length !== 3) return Number.NaN

  const hours = Number(parts[0])
  const minutes = Number(parts[1])
  const seconds = Number(parts[2])

  if (![hours, minutes, seconds].every(Number.isFinite)) return Number.NaN

  return hours * 3600 + minutes * 60 + seconds
}

function splitPath(filePath) {
  const value = filePath || ''
  const lastSlash = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'))

  if (lastSlash < 0) {
    return { folderPath: '', fileName: value }
  }

  return {
    folderPath: value.slice(0, lastSlash),
    fileName: value.slice(lastSlash + 1),
  }
}

function joinPath(folderPath, fileName) {
  if (!folderPath || !fileName) return ''
  const separator = folderPath.endsWith('\\') || folderPath.endsWith('/') ? '' : '\\'
  return `${folderPath}${separator}${fileName}`
}

function createNumericJid() {
  const digits = []
  const values = new Uint32Array(10)
  const largestEvenDigitRange = 4294967290

  while (digits.length < 10) {
    window.crypto.getRandomValues(values)
    values.forEach((value) => {
      if (digits.length < 10 && value < largestEvenDigitRange) {
        digits.push(String(value % 10))
      }
    })
  }

  return digits.join('')
}

function splitRenameFileName(fileName) {
  const value = String(fileName || '')
  const extensionIndex = value.lastIndexOf('.')
  const hasExtension = extensionIndex > 0
  return {
    baseName: hasExtension ? value.slice(0, extensionIndex) : value,
    extension: hasExtension ? value.slice(extensionIndex) : '',
  }
}

function getRenameSuffixState(fileName) {
  const { baseName } = splitRenameFileName(fileName)
  return {
    hasJid: /(?:_JID_\d{8}| \(Jid_\d{10}\))(?=_JOM$|$)/i.test(baseName),
    hasJom: /_JOM$/i.test(baseName),
  }
}

function setNumericJidSuffix(fileName, enabled) {
  const { baseName, extension } = splitRenameFileName(fileName)
  const existingJidPattern = /(?:_JID_\d{8}| \(Jid_\d{10}\))(?=_JOM$|$)/i

  if (!enabled) return `${baseName.replace(existingJidPattern, '')}${extension}`
  if (existingJidPattern.test(baseName)) return `${baseName}${extension}`

  const jidSuffix = ` (Jid_${createNumericJid()})`
  const nextBaseName = /_JOM$/i.test(baseName)
    ? `${baseName.slice(0, -4)}${jidSuffix}_JOM`
    : `${baseName}${jidSuffix}`
  return `${nextBaseName}${extension}`
}

function setJomSuffix(fileName, enabled) {
  const { baseName, extension } = splitRenameFileName(fileName)
  const baseNameWithoutJom = baseName.replace(/_JOM$/i, '')
  return `${baseNameWithoutJom}${enabled ? '_JOM' : ''}${extension}`
}

function regenerateNumericJid(fileName) {
  const { baseName, extension } = splitRenameFileName(fileName)
  const nextBaseName = baseName.replace(
    / \(Jid_\d{10}\)(?=_JOM$|$)/i,
    ` (Jid_${createNumericJid()})`,
  )

  return `${nextBaseName}${extension}`
}

function isSameFilePath(firstPath, secondPath) {
  const first = String(firstPath || '').replaceAll('/', '\\').toLowerCase()
  const second = String(secondPath || '').replaceAll('/', '\\').toLowerCase()
  return Boolean(first && second && first === second)
}

function getNotesPoolSourceId(type, sourcePath) {
  const normalizedPath = String(sourcePath || '').replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase()
  return normalizedPath ? `${type === 'folder' ? 'folder' : 'file'}:${normalizedPath}` : ''
}

function normalizeNotesPoolSource(source) {
  const type = source?.type === 'folder' ? 'folder' : 'file'
  const sourcePath = String(source?.path || '')
  const id = getNotesPoolSourceId(type, sourcePath)
  if (!id) return null

  return {
    id,
    type,
    path: sourcePath,
    depth: type === 'folder'
      ? Math.max(0, Math.min(MAX_NOTES_POOL_FOLDER_DEPTH, Math.trunc(Number(source?.depth) || 0)))
      : 0,
    selected: source?.selected === true,
    lastUsedAt: Number(source?.lastUsedAt) || Date.now(),
    error: typeof source?.error === 'string' ? source.error : '',
  }
}

function normalizeNotesPoolSources(value) {
  const byId = new Map()
  ;(Array.isArray(value) ? value : []).forEach((source) => {
    const normalized = normalizeNotesPoolSource(source)
    if (normalized && !byId.has(normalized.id)) byId.set(normalized.id, normalized)
  })
  return [...byId.values()]
}

function limitNotesPoolSources(value, loadedSources = []) {
  const records = normalizeNotesPoolSources(value)
    .sort((left, right) => right.lastUsedAt - left.lastUsedAt)
  const protectedIds = new Set([
    ...records.filter((source) => source.selected).map((source) => source.id),
    ...normalizeNotesPoolSources(loadedSources).map((source) => source.id),
  ])
  const protectedRecords = records.filter((source) => protectedIds.has(source.id))
  const recentRecords = records.filter((source) => !protectedIds.has(source.id))
  return [
    ...protectedRecords,
    ...recentRecords.slice(0, Math.max(0, MAX_NOTES_POOL_SOURCES - protectedRecords.length)),
  ]
}

function getNotesPoolSourceConfigKey(source) {
  const normalized = normalizeNotesPoolSource(source)
  if (!normalized) return ''
  return normalized.type === 'folder'
    ? `${normalized.id}:d${normalized.depth}`
    : normalized.id
}

function areNotesPoolSourceConfigsEqual(first, second) {
  const firstKeys = (Array.isArray(first) ? first : []).map(getNotesPoolSourceConfigKey).filter(Boolean).sort()
  const secondKeys = (Array.isArray(second) ? second : []).map(getNotesPoolSourceConfigKey).filter(Boolean).sort()
  return firstKeys.length === secondKeys.length && firstKeys.every((key, index) => key === secondKeys[index])
}

function getNotesPoolSourceLabel(source) {
  const cleanPath = String(source?.path || '').replace(/[\\/]+$/, '')
  const { fileName } = splitPath(cleanPath)
  return fileName || cleanPath || '-'
}

function describeNotesPoolSourceError(reason) {
  const messages = {
    'folder-not-found': 'Folder not found',
    'file-not-found': 'File not found',
    'access-denied': 'Access denied',
    'invalid-json-file': 'Invalid JSON',
    'invalid-note-json': 'Invalid JSON',
    'missing-video-file': 'Matching MP4 not found',
    'unsupported-source': 'Unsupported source',
  }
  return messages[reason] || String(reason || 'Unable to load source')
}

function normalizeReadingPositions(value) {
  const seen = new Set()
  return (Array.isArray(value) ? value : [])
    .map((entry) => ({
      videoPath: String(entry?.videoPath || ''),
      subtitlePath: String(entry?.subtitlePath || ''),
      cueIndex: Number.isInteger(Number(entry?.cueIndex)) ? Number(entry.cueIndex) : -1,
      cueStart: Number(entry?.cueStart),
      updatedAt: String(entry?.updatedAt || ''),
    }))
    .filter((entry) => {
      const key = entry.videoPath.replaceAll('/', '\\').toLowerCase()
      if (!key || !Number.isFinite(entry.cueStart) || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_READING_POSITIONS)
}

function removeFileExtension(fileName) {
  const dotIndex = String(fileName || '').lastIndexOf('.')
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName
}

function matchesSubtitleSuffix(subtitle, suffix) {
  const cleanSuffix = String(suffix || '').trim().toLowerCase()
  if (!cleanSuffix) return false

  const subtitleName = String(subtitle?.fileName || subtitle?.filePath || '').toLowerCase()
  const suffixes = cleanSuffix.endsWith('.vtt')
    ? [cleanSuffix, `${cleanSuffix.slice(0, -4)}.srt`]
    : [cleanSuffix]

  return suffixes.some((candidate) => subtitleName.endsWith(candidate))
}

function normalizeSubtitleLanguages(info) {
  if (Array.isArray(info?.subtitleLanguages) && info.subtitleLanguages.length > 0) {
    return info.subtitleLanguages.map((entry) => ({
      language: entry.language || '',
      label: entry.label || entry.language || 'Default',
      subtitle: entry.subtitle || null,
      srtSubtitle: entry.srtSubtitle || null,
    }))
  }

  const languageMap = new Map()
  const addSubtitle = (subtitle, keyName) => {
    if (!subtitle?.filePath) return
    const language = subtitle.language || ''
    const current = languageMap.get(language) || {
      language,
      label: subtitle.label || language || 'Default',
      subtitle: null,
      srtSubtitle: null,
    }
    current[keyName] = subtitle
    languageMap.set(language, current)
  }

  ;(info?.subtitleCandidates || []).forEach((subtitle) => addSubtitle(subtitle, 'subtitle'))
  ;(info?.srtSubtitleCandidates || []).forEach((subtitle) => addSubtitle(subtitle, 'srtSubtitle'))
  return [...languageMap.values()]
}

function getSubtitleLanguageKey(language) {
  return language || '__default__'
}

function getContextMenuPosition(event, itemCount) {
  const estimatedHeight = Math.max(1, itemCount) * CONTEXT_MENU_ITEM_HEIGHT
  const maxLeft = Math.max(CONTEXT_MENU_PADDING, window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_PADDING)
  const maxTop = Math.max(CONTEXT_MENU_PADDING, window.innerHeight - estimatedHeight - CONTEXT_MENU_PADDING)
  let left = event.clientX + CONTEXT_MENU_OFFSET
  let top = event.clientY + CONTEXT_MENU_OFFSET

  if (left > maxLeft) left = event.clientX - CONTEXT_MENU_WIDTH - CONTEXT_MENU_OFFSET
  if (top > maxTop) top = event.clientY - estimatedHeight - CONTEXT_MENU_OFFSET

  return {
    x: Math.max(CONTEXT_MENU_PADDING, Math.min(left, maxLeft)),
    y: Math.max(CONTEXT_MENU_PADDING, Math.min(top, maxTop)),
  }
}

export default function VideoMode() {
  const playerRef = useRef(null)
  const videoStageRef = useRef(null)
  const videoBottomPanelRef = useRef(null)
  const notesListRef = useRef(null)
  const notesPoolListRef = useRef(null)
  const notesPoolSourceButtonRef = useRef(null)
  const notesPoolSourceMenuRef = useRef(null)
  const externalNoteEditorRef = useRef(null)
  const directoryListRef = useRef(null)
  const noteEditorRef = useRef(null)
  const leaveGuardHandlerRef = useRef(null)
  const dialogResolveRef = useRef(null)
  const toastTimerRef = useRef(null)
  const subtitlePickChordTimerRef = useRef(null)
  const subtitleInteractionModeRef = useRef('follow')
  const speakSubtitlePreviewRef = useRef(false)
  const stopSpeakSubtitleRef = useRef(null)
  const readingPositionsRef = useRef([])
  const readingSessionRef = useRef(null)
  const readingResumeHandledRef = useRef(false)
  const playingViewRef = useRef(normalizePlayingView(null))
  const videoOpenSourceRef = useRef('default')
  const activeVideoPathRef = useRef('')
  const activeVideoGenerationRef = useRef(0)
  const loadedVideoStateRef = useRef(createLoadedVideoState())
  const [leftTab, setLeftTab] = useState('notes')
  const [dialog, setDialog] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [keywordMenu, setKeywordMenu] = useState(null)
  const [replaceDialog, setReplaceDialog] = useState(null)
  const [notesFilterText, setNotesFilterText] = useState('')
  const [notesFilterHistory, setNotesFilterHistory] = useState([])
  const [notesFilterOn, setNotesFilterOn] = useState(false)
  const [notesReverse, setNotesReverse] = useState(false)
  const [rightToolTab, setRightToolTab] = useState('main')
  const [externalNotes, setExternalNotes] = useState([])
  const [externalNotesFilterText, setExternalNotesFilterText] = useState('')
  const [externalNotesFilterHistory, setExternalNotesFilterHistory] = useState([])
  const [externalNotesFilterOn, setExternalNotesFilterOn] = useState(false)
  const [externalNotesReverse, setExternalNotesReverse] = useState(false)
  const [externalNotesShowFileName, setExternalNotesShowFileName] = useState(true)
  const [externalNotesFolderDepth, setExternalNotesFolderDepth] = useState(0)
  const [externalNoteSources, setExternalNoteSources] = useState([])
  const [externalNoteLoadedSources, setExternalNoteLoadedSources] = useState([])
  const [externalNoteSourcesOpen, setExternalNoteSourcesOpen] = useState(false)
  const [externalNoteSourcesPosition, setExternalNoteSourcesPosition] = useState({ left: 8, top: 8 })
  const [externalNotesReloading, setExternalNotesReloading] = useState(false)
  const [selectedExternalNoteId, setSelectedExternalNoteId] = useState('')
  const [expandedExternalNoteId, setExpandedExternalNoteId] = useState('')
  const [externalNoteDraftContent, setExternalNoteDraftContent] = useState('')
  const [dirtyExternalNoteIds, setDirtyExternalNoteIds] = useState(() => new Set())
  const [videoLeftWidth, setVideoLeftWidth] = useState(200)
  const [videoRightWidth, setVideoRightWidth] = useState(240)
  const [videoBottomSideWidth, setVideoBottomSideWidth] = useState(360)
  const [videoStageRatio, setVideoStageRatio] = useState(0.74)
  const [fullscreenCycleState, setFullscreenCycleState] = useState(0)
  const [fullscreenViewStates, setFullscreenViewStates] = useState(createFullscreenViewStates)
  const [rollingPanelView, setRollingPanelView] = useState(() => normalizeRollingPanelViewSnapshot(null))
  const [subtitleCenterSideRatio, setSubtitleCenterSideRatio] = useState(1 / 6)
  const [subtitleCenterInfoHeight, setSubtitleCenterInfoHeight] = useState(180)
  const [rollingSubtitleCenterLayoutRequest, setRollingSubtitleCenterLayoutRequest] = useState(0)
  const [rollingSubtitlePickRequest, setRollingSubtitlePickRequest] = useState(0)
  const [rollingSubtitleFontStepRequest, setRollingSubtitleFontStepRequest] = useState(() => ({
    sequence: 0,
    direction: 0,
  }))
  const [selectedDirectoryMp4Name, setSelectedDirectoryMp4Name] = useState('')
  const [directoryFolderPath, setDirectoryFolderPath] = useState('')
  const [mp4SortKey, setMp4SortKey] = useState('name')
  const [mp4SortDirection, setMp4SortDirection] = useState('asc')
  const [mp4RecentSectionRatio, setMp4RecentSectionRatio] = useState(0.39)
  const [playAll, setPlayAll] = useState(true)
  const [titleOn, setTitleOn] = useState(true)
  const [subtitleLanguages, setSubtitleLanguages] = useState([])
  const [selectedSubtitleLanguageKey, setSelectedSubtitleLanguageKey] = useState('')
  const [selectedSubtitle, setSelectedSubtitle] = useState(null)
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false)
  const [rollingSubtitleCues, setRollingSubtitleCues] = useState([])
  const [rollingSubtitleError, setRollingSubtitleError] = useState('')
  const [videoOpenSource, setVideoOpenSource] = useState('default')
  const [currentPlaybackTime, setCurrentPlaybackTime] = useState(0)
  const [videoDurationSeconds, setVideoDurationSeconds] = useState(0)
  const [videoDurationText, setVideoDurationText] = useState('--:--:--.-')
  const [videoControlMode, setVideoControlMode] = useState(false)
  const [volume, setVolume] = useState(1)
  const [subtitleNotePreviewContent, setSubtitleNotePreviewContent] = useState(null)
  const [subtitleInteractionMode, setSubtitleInteractionMode] = useState('follow')
  const [subtitleReadingStatus, setSubtitleReadingStatus] = useState(null)
  const [, setReadingPositions] = useState([])

  const settings = useSettingsStore((state) => state.settings)
  const saveSettings = useSettingsStore((state) => state.saveSettings)
  const extraSubtitleFolder = settings.general.extraSubtitleFolder
  const subtitleDisplayMode = settings.general.subtitleDisplayMode || 'native'
  const rollingSubtitleFontSize = settings.general.rollingSubtitleFontSize
  const pickSubAutoSelectCurrent = settings.general.pickSubAutoSelectCurrent === true
  const segmentedShortcutWaitMs = settings.general.segmentedShortcutWaitSec * 1000
  const subtitleCenterViewBlurPx = settings.general.subtitleCenterViewBlurPx ?? 18
  const videoNotesFontSize = settings.general.videoNotesFontSize || 11
  const videoNotesPoolFontSize = settings.general.videoNotesPoolFontSize || 11
  const locateNotePastLimitSec = settings.general.locateNotePastLimitSec ?? 100
  const locateNoteFutureLimitSec = settings.general.locateNoteFutureLimitSec ?? 10
  const playAllSubtitleSuffix = useSettingsStore((state) => state.settings.general.playAllSubtitleSuffix)
  const subtitleConvertPromptTimeoutSec = useSettingsStore((state) => state.settings.general.subtitleConvertPromptTimeoutSec)
  const mode = useAppStore((state) => state.mode)
  const dirty = useAppStore((state) => state.dirtyByMode.video)
  const recentVideoFiles = useAppStore((state) => state.recentFiles.video || [])
  const recentVideoFolders = useAppStore((state) => state.recentFolders.video || [])
  const setDirty = useAppStore((state) => state.setDirty)
  const setCurrentFile = useAppStore((state) => state.setCurrentFile)
  const addRecentFile = useAppStore((state) => state.addRecentFile)
  const replaceRecentFile = useAppStore((state) => state.replaceRecentFile)
  const addRecentFolder = useAppStore((state) => state.addRecentFolder)
  const setLeaveGuard = useAppStore((state) => state.setLeaveGuard)
  const registerSessionProvider = useAppStore((state) => state.registerSessionProvider)
  const restoreSessionState = useAppStore((state) => state.restoreSessionState)

  const videoFile = useVideoStore((state) => state.videoFile)
  const notes = useVideoStore((state) => state.notes)
  const selectedNoteId = useVideoStore((state) => state.selectedNoteId)
  const curStart = useVideoStore((state) => state.curStart)
  const curEnd = useVideoStore((state) => state.curEnd)
  const noteDraft = useVideoStore((state) => state.noteDraft)
  const selectedStart = useVideoStore((state) => state.selectedStart)
  const selectedEnd = useVideoStore((state) => state.selectedEnd)
  const playingTime = useVideoStore((state) => state.playingTime)
  const playbackRate = useVideoStore((state) => state.playbackRate)
  const repeat = useVideoStore((state) => state.repeat)
  const directoryMp4Files = useVideoStore((state) => state.directoryMp4Files)
  const setVideoFile = useVideoStore((state) => state.setVideoFile)
  const setNotes = useVideoStore((state) => state.setNotes)
  const setSelectedNoteId = useVideoStore((state) => state.setSelectedNoteId)
  const setCurStart = useVideoStore((state) => state.setCurStart)
  const setCurEnd = useVideoStore((state) => state.setCurEnd)
  const setNoteDraft = useVideoStore((state) => state.setNoteDraft)
  const setSelectedStart = useVideoStore((state) => state.setSelectedStart)
  const setSelectedEnd = useVideoStore((state) => state.setSelectedEnd)
  const setPlayingTime = useVideoStore((state) => state.setPlayingTime)
  const setPlaybackRate = useVideoStore((state) => state.setPlaybackRate)
  const setRepeat = useVideoStore((state) => state.setRepeat)
  const setDirectoryMp4Files = useVideoStore((state) => state.setDirectoryMp4Files)
  const addNote = useVideoStore((state) => state.addNote)
  const insertNoteAt = useVideoStore((state) => state.insertNoteAt)
  const updateNote = useVideoStore((state) => state.updateNote)
  const deleteNote = useVideoStore((state) => state.deleteNote)
  const clearNotes = useVideoStore((state) => state.clearNotes)
  const moveNote = useVideoStore((state) => state.moveNote)


  useEffect(() => {
    console.log(`[startup:renderer] VideoMode mounted +${Math.round(performance.now())}ms`)
  }, [])

  const selectedNote = notes.find((note) => note.id === selectedNoteId) || null
  const selectedNoteIndex = notes.findIndex((note) => note.id === selectedNoteId)
  const notesFilterExpression = useMemo(
    () => compileFilterExpression(notesFilterText),
    [notesFilterText]
  )
  const externalNotesFilterExpression = useMemo(
    () => compileFilterExpression(externalNotesFilterText),
    [externalNotesFilterText]
  )
  const sortedDirectoryMp4Files = useMemo(
    () => sortMp4Files(directoryMp4Files, mp4SortKey, mp4SortDirection),
    [directoryMp4Files, mp4SortDirection, mp4SortKey]
  )
  const directoryJsonFileCount = useMemo(
    () => directoryMp4Files.reduce((count, entry) => (
      Number.isFinite(normalizeMp4FileEntry(entry).jsonModifiedTime) ? count + 1 : count
    ), 0),
    [directoryMp4Files]
  )
  const fullscreenLayoutKey = FULLSCREEN_LAYOUT_KEYS[fullscreenCycleState] || 'f0'
  const fullscreenViewState = fullscreenViewStates[fullscreenLayoutKey] || createFullscreenViewState()
  const rollingPanelViewKey = fullscreenCycleState === 4 ? 'f4' : 'f0'
  const currentRollingPanelView = rollingPanelView.states[rollingPanelViewKey]
  const currentRollingFontSize = Number.isFinite(Number(currentRollingPanelView?.fontSize))
    ? Number(currentRollingPanelView.fontSize)
    : rollingSubtitleFontSize
  const videoViewDim = fullscreenViewState.hideView ? SUBTITLE_CENTER_VIEW_HIDDEN_DIM : 0
  const canPickRollingSubtitle = titleOn
    && subtitleDisplayMode === 'rolling'
    && Boolean(selectedSubtitle)
    && rollingSubtitleCues.length > 0
    && !fullscreenViewState.hideSub
  const subtitleCapabilities = {
    canManualPlay: Boolean(videoFile?.filePath) && subtitleInteractionMode !== 'reading',
    canReadByWheel: subtitleInteractionMode === 'reading',
    canEditSubtitle: subtitleInteractionMode === 'pick' || subtitleInteractionMode === 'reading',
    canSpeakSubtitle: canPickRollingSubtitle,
    canToggleReading: subtitleInteractionMode === 'pick' || subtitleInteractionMode === 'reading',
  }

  const mergeReadingPosition = (position, positions = readingPositionsRef.current) => normalizeReadingPositions([
    position,
    ...positions.filter((entry) => !isSameFilePath(entry.videoPath, position.videoPath)),
  ])

  const buildCurrentReadingPosition = () => {
    const session = readingSessionRef.current
    if (!session?.videoPath) return null
    const cueStart = Number(session.cueStart)
    if (!Number.isFinite(cueStart)) return null
    return {
      videoPath: session.videoPath,
      subtitlePath: session.subtitlePath || '',
      cueIndex: Number.isInteger(Number(session.cueIndex)) ? Number(session.cueIndex) : -1,
      cueStart,
      updatedAt: new Date().toISOString(),
    }
  }

  const getReadingPositionsSnapshot = () => {
    const currentPosition = buildCurrentReadingPosition()
    return currentPosition ? mergeReadingPosition(currentPosition) : readingPositionsRef.current
  }

  const requestSessionStateSave = () => {
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('app-session-save-request'))
    }, 0)
  }

  const saveCurrentReadingPosition = ({ persist = true } = {}) => {
    const currentPosition = buildCurrentReadingPosition()
    if (!currentPosition) return false
    const nextPositions = mergeReadingPosition(currentPosition)
    readingPositionsRef.current = nextPositions
    setReadingPositions(nextPositions)
    if (persist) requestSessionStateSave()
    return true
  }

  const findCueIndexAtTime = (time) => {
    if (rollingSubtitleCues.length === 0 || !Number.isFinite(Number(time))) return -1
    const targetTime = Number(time)
    const containingIndex = rollingSubtitleCues.findIndex((cue) => (
      targetTime >= Number(cue.start) && targetTime <= Number(cue.end)
    ))
    if (containingIndex >= 0) return containingIndex
    return rollingSubtitleCues.reduce((nearestIndex, cue, index) => (
      Math.abs(Number(cue.start) - targetTime)
        < Math.abs(Number(rollingSubtitleCues[nearestIndex]?.start) - targetTime)
        ? index
        : nearestIndex
    ), 0)
  }

  useEffect(() => {
    subtitleInteractionModeRef.current = subtitleInteractionMode
  }, [subtitleInteractionMode])

  useEffect(() => {
    if (subtitleInteractionModeRef.current === 'reading') saveCurrentReadingPosition()
    readingSessionRef.current = null
    subtitleInteractionModeRef.current = 'follow'
    setSubtitleInteractionMode('follow')
    setSubtitleReadingStatus(null)
    setSubtitleNotePreviewContent(null)
    stopSpeakSubtitleRef.current?.()
  }, [selectedSubtitle?.filePath, videoFile?.filePath])

  const changeSubtitleInteractionMode = (nextMode) => {
    const currentMode = subtitleInteractionModeRef.current
    const allowed = (currentMode === 'follow' && nextMode === 'pick')
      || (currentMode === 'pick' && ['follow', 'reading'].includes(nextMode))
      || (currentMode === 'reading' && nextMode === 'pick')
      || currentMode === nextMode
    if (!allowed) return false

    if (currentMode === 'reading' && nextMode !== 'reading') {
      stopSpeakSubtitleRef.current?.()
      saveCurrentReadingPosition()
      readingSessionRef.current = null
    }
    if (nextMode === 'reading') playerRef.current?.pause?.()
    if (nextMode !== 'reading') setSubtitleReadingStatus(null)
    subtitleInteractionModeRef.current = nextMode
    setSubtitleInteractionMode(nextMode)
    return true
  }

  const toggleSubtitleReading = async () => {
    if (subtitleInteractionModeRef.current === 'reading') {
      changeSubtitleInteractionMode('pick')
      return
    }
    if (subtitleInteractionModeRef.current !== 'pick' || !videoFile?.filePath) return

    const shouldOfferResume = !readingResumeHandledRef.current
    readingResumeHandledRef.current = true
    const savedPosition = shouldOfferResume
      ? readingPositionsRef.current.find((entry) => (
        isSameFilePath(entry.videoPath, videoFile.filePath)
      ))
      : null
    let targetTime = getPlayerTime()
    let targetCueIndex = findCueIndexAtTime(targetTime)

    if (savedPosition) {
      const decision = await showActionDialog({
        title: 'Resume subtitle reading?',
        message: 'A saved reading position was found for this video.',
        defaultValue: 'resume',
        cancelValue: 'current',
        actions: [
          { label: 'Resume', value: 'resume', primary: true },
          { label: 'Current Position', value: 'current' },
        ],
      })
      if (decision === 'resume') {
        targetTime = savedPosition.cueStart
        targetCueIndex = findCueIndexAtTime(targetTime)
        playerRef.current?.currentTime?.(targetTime)
        setCurrentPlaybackTime(targetTime)
        setPlayingTime(formatTime(targetTime))
      }
    }

    readingSessionRef.current = {
      videoPath: videoFile.filePath,
      subtitlePath: selectedSubtitle?.filePath || '',
      cueIndex: targetCueIndex,
      cueStart: targetTime,
    }
    changeSubtitleInteractionMode('reading')
  }

  useEffect(() => {
    if (canPickRollingSubtitle || subtitleInteractionModeRef.current === 'follow') return
    if (subtitleInteractionModeRef.current === 'reading') saveCurrentReadingPosition()
    readingSessionRef.current = null
    stopSpeakSubtitleRef.current?.()
    subtitleInteractionModeRef.current = 'follow'
    setSubtitleInteractionMode('follow')
    setSubtitleReadingStatus(null)
    setSubtitleNotePreviewContent(null)
  }, [canPickRollingSubtitle])

  const updateCurrentFullscreenViewState = (updater) => {
    setFullscreenViewStates((current) => {
      const currentState = current[fullscreenLayoutKey] || createFullscreenViewState()
      const patch = typeof updater === 'function' ? updater(currentState) : updater
      return {
        ...current,
        [fullscreenLayoutKey]: {
          ...currentState,
          ...patch,
        },
      }
    })
  }

  const toggleCurrentSubtitleHidden = () => {
    updateCurrentFullscreenViewState((state) => ({ hideSub: !state.hideSub }))
  }

  const toggleCurrentVideoHidden = () => {
    updateCurrentFullscreenViewState((state) => {
      const hideView = !state.hideView
      return {
        hideView,
        videoOpacity: hideView ? 0 : 1,
      }
    })
  }

  const changeCurrentVideoOpacity = (direction) => {
    updateCurrentFullscreenViewState((state) => {
      const currentOpacity = Number.isFinite(Number(state.videoOpacity))
        ? Number(state.videoOpacity)
        : state.hideView ? 0 : 1
      const videoOpacity = Math.max(
        0,
        Math.min(1, Math.round((currentOpacity + (direction * VIDEO_OPACITY_STEP)) * 10) / 10),
      )
      return {
        hideView: videoOpacity === 0,
        videoOpacity,
      }
    })
  }

  const changeRollingSubtitleFontSize = (direction) => {
    if (!titleOn || subtitleDisplayMode !== 'rolling' || !selectedSubtitle) return
    setRollingSubtitleFontStepRequest((current) => ({
      sequence: current.sequence + 1,
      direction: direction < 0 ? -1 : 1,
    }))
  }

  const toggleCurrentHvLayout = () => {
    updateCurrentFullscreenViewState((state) => ({ hvLayout: state.hvLayout === 1 ? 0 : 1 }))
    window.requestAnimationFrame(requestRollingSubtitleLayout)
  }
  const visibleNotes = useMemo(() => {
    const rows = notes
      .map((note, index) => ({ note, index }))
      .filter(({ note }) => {
        if (!notesFilterOn || !notesFilterExpression.active || !notesFilterExpression.ok) return true
        return notesFilterExpression.matches(note.content)
      })

    return notesReverse ? rows.reverse() : rows
  }, [notes, notesFilterExpression, notesFilterOn, notesReverse])
  const selectedExternalNote = externalNotes.find((note) => note.id === selectedExternalNoteId) || null
  const selectedExternalNoteIndex = externalNotes.findIndex((note) => note.id === selectedExternalNoteId)
  const selectedExternalNoteDirty = selectedExternalNote
    ? dirtyExternalNoteIds.has(selectedExternalNote.id)
    : false
  const activeNoteSource = videoOpenSource === 'pool' && selectedExternalNote ? 'pool' : 'default'
  const activeNoteDraft = subtitleNotePreviewContent ?? (activeNoteSource === 'pool' ? externalNoteDraftContent : noteDraft)
  const activeNoteStart = activeNoteSource === 'pool' ? selectedExternalNote?.start : selectedStart || selectedNote?.start
  const activeNoteEnd = activeNoteSource === 'pool' ? selectedExternalNote?.end : selectedEnd || selectedNote?.end
  const externalNoteFileCount = useMemo(
    () => new Set(externalNotes.map((note) => note.sourceJsonPath).filter(Boolean)).size,
    [externalNotes]
  )
  const selectedExternalNoteSources = useMemo(
    () => externalNoteSources.filter((source) => source.selected),
    [externalNoteSources]
  )
  const externalNoteSourceLoadFailures = useMemo(
    () => externalNoteSources.filter((source) => source.selected && source.error),
    [externalNoteSources]
  )
  const externalNoteSourcesNeedReload = useMemo(
    () => !areNotesPoolSourceConfigsEqual(selectedExternalNoteSources, externalNoteLoadedSources),
    [externalNoteLoadedSources, selectedExternalNoteSources]
  )
  const sortedExternalNoteSources = useMemo(() => {
    const loadedIds = new Set(externalNoteLoadedSources.map((source) => source.id))
    return [...externalNoteSources].sort((left, right) => {
      const loadedDifference = Number(loadedIds.has(right.id)) - Number(loadedIds.has(left.id))
      if (loadedDifference) return loadedDifference
      return (Number(right.lastUsedAt) || 0) - (Number(left.lastUsedAt) || 0)
    })
  }, [externalNoteLoadedSources, externalNoteSources])
  const cleanableExternalNoteSourceCount = useMemo(() => {
    const loadedIds = new Set(externalNoteLoadedSources.map((source) => source.id))
    return externalNoteSources.filter((source) => !loadedIds.has(source.id)).length
  }, [externalNoteLoadedSources, externalNoteSources])
  const visibleExternalNotes = useMemo(() => {
    const rows = externalNotes
      .map((note, index) => ({ note, index }))
      .filter(({ note }) => {
        if (!externalNotesFilterOn || !externalNotesFilterExpression.active || !externalNotesFilterExpression.ok) return true
        return externalNotesFilterExpression.matches(note.content)
      })

    return externalNotesReverse ? rows.reverse() : rows
  }, [externalNotes, externalNotesFilterExpression, externalNotesFilterOn, externalNotesReverse])

  const resizeExternalNoteEditor = () => {
    const textarea = externalNoteEditorRef.current
    const list = notesPoolListRef.current
    const row = textarea?.closest?.('.notes-pool-row')
    if (!textarea || !list || !row || list.clientHeight <= 0) return

    const minimumHeight = Math.max(52, Number.parseFloat(window.getComputedStyle(textarea).minHeight) || 0)
    textarea.style.height = `${minimumHeight}px`
    textarea.style.overflowY = 'hidden'

    const reservedHeight = Math.max(0, row.scrollHeight - textarea.offsetHeight)
    const maximumHeight = Math.max(minimumHeight, list.clientHeight - reservedHeight)
    const contentHeight = Math.max(minimumHeight, textarea.scrollHeight)
    textarea.style.height = `${Math.min(contentHeight, maximumHeight)}px`
    textarea.style.overflowY = contentHeight > maximumHeight ? 'auto' : 'hidden'
  }

  useEffect(() => {
    if (!expandedExternalNoteId || rightToolTab !== 'notesPool') return undefined

    const frameId = window.requestAnimationFrame(resizeExternalNoteEditor)
    const list = notesPoolListRef.current
    const ResizeObserverClass = window.ResizeObserver
    const observer = typeof ResizeObserverClass === 'function'
      ? new ResizeObserverClass(() => window.requestAnimationFrame(resizeExternalNoteEditor))
      : null
    if (list) observer?.observe(list)

    return () => {
      window.cancelAnimationFrame(frameId)
      observer?.disconnect()
    }
  }, [expandedExternalNoteId, externalNoteDraftContent, rightToolTab, videoNotesPoolFontSize])

  useEffect(() => {
    if (!externalNoteSourcesOpen) return undefined

    const closeOnOutsidePointer = (event) => {
      if (notesPoolSourceMenuRef.current?.contains(event.target)) return
      if (notesPoolSourceButtonRef.current?.contains(event.target)) return
      setExternalNoteSourcesOpen(false)
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setExternalNoteSourcesOpen(false)
    }

    window.addEventListener('pointerdown', closeOnOutsidePointer)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePointer)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [externalNoteSourcesOpen])

  const saveFilterCondition = (scope) => {
    const filterText = scope === 'pool' ? externalNotesFilterText : notesFilterText
    const value = filterText.trim()
    if (!value) return

    const updateHistory = (current) => normalizeFilterHistory([
      value,
      ...current.filter((item) => item !== value),
    ])
    if (scope === 'pool') {
      setExternalNotesFilterHistory(updateHistory)
    } else {
      setNotesFilterHistory(updateHistory)
    }
    showAutoMessage('Filter saved.', 'Filter', 900)
  }

  const updateCurrentRollingPanelView = (patch) => {
    setRollingPanelView((current) => ({
      ...current,
      states: {
        ...current.states,
        [rollingPanelViewKey]: normalizeRollingPanelViewState({
          ...current.states[rollingPanelViewKey],
          ...patch,
        }),
      },
    }))
  }

  const deleteFilterCondition = (scope, value) => {
    const updateHistory = (current) => current.filter((item) => item !== value)
    if (scope === 'pool') {
      setExternalNotesFilterHistory(updateHistory)
    } else {
      setNotesFilterHistory(updateHistory)
    }
  }

  const selectedSubtitleLanguage = subtitleLanguages.find(
    (entry) => getSubtitleLanguageKey(entry.language) === selectedSubtitleLanguageKey
  )
  const selectedSubtitleLabel = selectedSubtitleLanguage?.label || selectedSubtitleLanguage?.language || 'None'
  const keywordInsertion = useKeywordInsertion({
    isActive: mode === APP_MODES.VIDEO,
    targets: {
      noteEditor: {
        ref: noteEditorRef,
        setValue: setNoteDraft,
      },
    },
  })

  const scrollSelectedNoteIntoView = () => {
    window.requestAnimationFrame(() => {
      const row = notesListRef.current?.querySelector('.note-row.active')
      row?.scrollIntoView({ block: 'nearest' })
    })
  }

  useEffect(() => {
    let canceled = false

    async function loadRollingSubtitleCues() {
      setRollingSubtitleCues([])
      setRollingSubtitleError('')
      if (!selectedSubtitle?.filePath) return

      const result = await window.videoApi?.readSubtitleText?.(selectedSubtitle.filePath)
      if (canceled) return

      if (!result?.ok) {
        const reason = result?.reason || 'read-subtitle-failed'
        setRollingSubtitleError(reason)
        window.debugApi?.log(`Rolling subtitle read failed: ${selectedSubtitle.filePath} (${reason})`)
        return
      }

      setRollingSubtitleCues(parseSubtitleCues(result.content || ''))
    }

    loadRollingSubtitleCues()
    return () => {
      canceled = true
    }
  }, [selectedSubtitle])

  useEffect(() => {
    if (leftTab === 'notes') scrollSelectedNoteIntoView()
  }, [leftTab, selectedNoteId])

  const scrollSelectedDirectoryMp4IntoView = () => {
    window.requestAnimationFrame(() => {
      const row = directoryListRef.current?.querySelector('.mp4-list-row.active')
      row?.scrollIntoView({ block: 'nearest' })
    })
  }

  useEffect(() => {
    if (leftTab === 'files') scrollSelectedDirectoryMp4IntoView()
  }, [leftTab, selectedDirectoryMp4Name])

  const clearSubtitlePickChord = () => {
    if (subtitlePickChordTimerRef.current) {
      clearTimeout(subtitlePickChordTimerRef.current)
      subtitlePickChordTimerRef.current = null
      window.dispatchEvent(new CustomEvent('shortcut-chord-change', { detail: null }))
    }
  }

  useEffect(() => {
    const handleChordCancel = () => {
      clearSubtitlePickChord()
      setDialog((current) => (
        current?.kind === 'subtitlePick' && current.shortcutChordActive
          ? { ...current, shortcutChordActive: false }
          : current
      ))
    }

    window.addEventListener('shortcut-chord-cancel', handleChordCancel)
    return () => window.removeEventListener('shortcut-chord-cancel', handleChordCancel)
  }, [])

  const closeDialog = (decision) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current)
      toastTimerRef.current = null
    }
    clearSubtitlePickChord()

    const resolve = dialogResolveRef.current
    dialogResolveRef.current = null
    setDialog(null)
    resolve?.(decision)
  }

  const showActionDialog = (options) => new Promise((resolve) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current)
      toastTimerRef.current = null
    }

    dialogResolveRef.current = resolve
    setDialog(options)

    if (Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0) {
      toastTimerRef.current = setTimeout(() => {
        closeDialog(options.timeoutValue || options.cancelValue || 'cancel')
      }, Number(options.timeoutMs))
    }
  })

  const showSubtitleChoiceDialog = (subtitleCandidates, options = {}) => new Promise((resolve) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current)
      toastTimerRef.current = null
    }

    dialogResolveRef.current = resolve
    setDialog({
      title: options.title || 'Select subtitle file',
      subtitleCandidates,
      defaultValue: subtitleCandidates[0]?.filePath || 'none',
      cancelValue: 'none',
      nonModal: true,
      actions: [{ label: options.noneLabel || 'No subtitle', value: 'none' }],
    })

    if (Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0) {
      toastTimerRef.current = setTimeout(() => {
        closeDialog(options.timeoutValue || subtitleCandidates[0]?.filePath || 'none')
      }, Number(options.timeoutMs))
    }
  })

  const showAutoMessage = (message, title = 'Message', timeout = 1200) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current)
    }

    setDialog({
      title,
      message,
      actions: [{ label: 'OK', value: 'ok', primary: true }],
      autoClose: true,
    })

    toastTimerRef.current = setTimeout(() => {
      closeDialog('ok')
    }, timeout)
  }

  useEffect(() => () => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current)
    }
    clearSubtitlePickChord()
    stopSpeakSubtitleRef.current?.()
  }, [])

  useEffect(() => {
    if (!dialog) return undefined

    const onKeyDown = (event) => {
      if (dialog.kind === 'videoRename') {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          closeDialog({ decision: 'cancel', text: dialog.fileName || '', jidGenerated: dialog.jidGenerated === true })
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          event.stopPropagation()
          closeDialog({ decision: 'ok', text: dialog.fileName || '', jidGenerated: dialog.jidGenerated === true })
        }
        return
      }

      if (dialog.kind === 'videoRenameConfirm') {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          closeDialog('back')
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          event.stopPropagation()
          closeDialog('confirm')
        }
        return
      }

      if (dialog.kind === 'subtitlePick' || dialog.kind === 'subtitleEdit') {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          event.stopImmediatePropagation?.()
          closeDialog({ decision: 'cancel', text: dialog.subtitleText || '' })
          return
        }

        if (dialog.kind === 'subtitlePick' && dialog.shortcutChordActive && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
          const key = event.key?.toUpperCase?.() || ''
          const chordAction = SUBTITLE_PICK_CHORD_ACTIONS.find((action) => action.key === key)
          if (chordAction) {
            event.preventDefault()
            event.stopPropagation()
            event.stopImmediatePropagation?.()
            closeDialog({ decision: chordAction.decision, text: dialog.subtitleText || '' })
            return
          }

          if (key.length === 1) {
            clearSubtitlePickChord()
            setDialog((current) => current?.kind === 'subtitlePick'
              ? { ...current, shortcutChordActive: false }
              : current)
          }
        }
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        closeDialog(dialog.cancelValue || 'cancel')
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        closeDialog(dialog.defaultValue || dialog.actions?.[0]?.value || 'ok')
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [dialog])

  useEffect(() => {
    if (!contextMenu) return undefined

    const closeMenu = () => setContextMenu(null)
    window.addEventListener('click', closeMenu, true)
    window.addEventListener('contextmenu', closeMenu, true)
    return () => {
      window.removeEventListener('click', closeMenu, true)
      window.removeEventListener('contextmenu', closeMenu, true)
    }
  }, [contextMenu])

  useEffect(() => {
    if (!keywordMenu) return undefined

    const closeMenu = () => setKeywordMenu(null)
    window.addEventListener('click', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
    }
  }, [keywordMenu])

  useEffect(() => {
    if (!subtitleMenuOpen) return undefined

    const closeMenu = () => setSubtitleMenuOpen(false)
    window.addEventListener('click', closeMenu)
    return () => window.removeEventListener('click', closeMenu)
  }, [subtitleMenuOpen])

  const getPlayerTime = () => playerRef.current?.currentTime() ?? 0

  const getLoadedVideoStateSnapshot = () => {
    const snapshot = normalizeLoadedVideoState(loadedVideoStateRef.current)
    const activeSource = videoOpenSourceRef.current === 'pool' ? 'pool' : 'default'
    const playbackTime = Number(getPlayerTime())
    snapshot.activeSource = activeSource
    snapshot.activeLoaded = Boolean(videoFile?.filePath)
    if (videoFile?.filePath && snapshot.sources[activeSource].filePath) {
      snapshot.sources[activeSource] = {
        ...snapshot.sources[activeSource],
        playbackTime: Number.isFinite(playbackTime) && playbackTime >= 0 ? playbackTime : 0,
      }
    }
    return snapshot
  }

  const rememberCurrentLoadedVideo = () => {
    loadedVideoStateRef.current = getLoadedVideoStateSnapshot()
  }

  const changeVideoOpenSource = (nextSource) => {
    const normalizedSource = nextSource === 'pool' ? 'pool' : 'default'
    const sourceChanged = videoOpenSourceRef.current !== normalizedSource
    if (sourceChanged) {
      rememberCurrentLoadedVideo()
    }
    const playbackTime = Number(getPlayerTime())
    loadedVideoStateRef.current = {
      ...loadedVideoStateRef.current,
      activeSource: normalizedSource,
      activeLoaded: Boolean(videoFile?.filePath),
      sources: sourceChanged && videoFile?.filePath
        ? {
          ...loadedVideoStateRef.current.sources,
          [normalizedSource]: {
            filePath: videoFile.filePath,
            playbackTime: Number.isFinite(playbackTime) && playbackTime >= 0 ? playbackTime : 0,
          },
        }
        : loadedVideoStateRef.current.sources,
    }
    videoOpenSourceRef.current = normalizedSource
    setVideoOpenSource(normalizedSource)
  }

  const getDuration = () => {
    const duration = playerRef.current?.duration?.()
    return Number.isFinite(duration) ? duration : Number.POSITIVE_INFINITY
  }

  const refreshVideoDurationText = () => {
    const duration = Number(playerRef.current?.duration?.())
    const validDuration = Number.isFinite(duration) && duration > 0 ? duration : 0
    setVideoDurationSeconds(validDuration)
    setVideoDurationText(validDuration > 0 ? formatTime(validDuration) : '--:--:--.-')
  }

  const handleHiddenVideoSeek = (event) => {
    const nextTime = Number(event.target.value)
    if (!Number.isFinite(nextTime) || videoDurationSeconds <= 0) return

    playerRef.current?.currentTime?.(nextTime)
    setCurrentPlaybackTime(nextTime)
    setPlayingTime(formatTime(nextTime))
  }

  const getPlaybackRate = () => {
    const playerRate = Number(playerRef.current?.playbackRate?.())
    return Number.isFinite(playerRate) && playerRate > 0
      ? playerRate
      : playbackRate || 1
  }

  const scaleTimeDistance = (seconds) => seconds * getPlaybackRate()

  const seekByScaledSeconds = (seconds) => {
    const player = playerRef.current
    if (!player) return

    const duration = getDuration()
    const nextTime = Math.min(duration, Math.max(0, getPlayerTime() + scaleTimeDistance(seconds)))
    player.currentTime(nextTime)
  }

  const seekToCurrentStart = () => {
    const startSeconds = parseTime(curStart)
    if (!Number.isFinite(startSeconds)) {
      showAutoMessage('Action message.', 'Message', 900)
      return
    }

    const duration = getDuration()
    const nextTime = Math.min(duration, Math.max(0, startSeconds))
    playerRef.current?.currentTime?.(nextTime)
    setPlayingTime(formatTime(nextTime))
  }

  const seekWhenReady = (seconds) => {
    const player = playerRef.current
    const targetTime = Number(seconds)
    if (!player || !Number.isFinite(targetTime)) return
    const videoGeneration = activeVideoGenerationRef.current

    const applySeek = () => {
      if (videoGeneration !== activeVideoGenerationRef.current) return
      const duration = getDuration()
      const nextTime = Math.min(duration, Math.max(0, targetTime))
      player.currentTime(nextTime)
      setPlayingTime(formatTime(nextTime))
    }

    player.one?.('loadedmetadata', applySeek)
    player.one?.('loadeddata', applySeek)
    setTimeout(applySeek, 120)
  }

  const buildCaptureRange = (forwardSeconds = QUICK_NOTE_FORWARD_SECONDS, backwardSeconds = QUICK_NOTE_BACKWARD_SECONDS) => {
    const currentTime = getPlayerTime()
    const duration = getDuration()
    const scaledBackward = scaleTimeDistance(backwardSeconds)
    const scaledForward = scaleTimeDistance(forwardSeconds)
    const start = currentTime - scaledBackward < 0 ? 0 : currentTime - scaledBackward
    let end = Math.min(duration, start + scaledForward)

    if (!Number.isFinite(end) || end <= start) {
      end = start + 1
    }

    return {
      start: formatTime(start),
      end: formatTime(end),
    }
  }

  const normalizeRange = (range) => {
    const startSeconds = parseTime(range.start)
    const endSeconds = parseTime(range.end)

    if (!Number.isFinite(startSeconds)) {
      showAutoMessage('Action message.', 'Message', 1800)
      return null
    }

    if (!Number.isFinite(endSeconds) || endSeconds <= startSeconds) {
      showAutoMessage('End time adjusted to start + 1s.', 'Time adjusted', 1600)
      return {
        start: range.start,
        end: formatTime(startSeconds + 1),
      }
    }

    return range
  }

  const requestVideoPlay = ({ source = 'manual', silent = false } = {}) => {
    const player = playerRef.current
    if (!activeVideoPathRef.current || !player?.play) return false

    const speakPreview = source === 'speak-sub' && speakSubtitlePreviewRef.current
    if (subtitleInteractionModeRef.current === 'reading' && !speakPreview) {
      player.pause?.()
      if (!silent) {
        showAutoMessage('Exit Sub Reading before playback.', 'Subtitle Reading', 1400)
      }
      return false
    }

    const result = player.play()
    if (result?.catch) {
      result.catch(() => {
        if (!silent) showAutoMessage('Action message.', 'Message', 1800)
      })
    }
    return true
  }

  const playFromCurrentPosition = (options = {}) => {
    const player = playerRef.current
    if (!player?.play) return false
    if (subtitleInteractionModeRef.current === 'reading' && options.source !== 'speak-sub') {
      return requestVideoPlay(options)
    }

    const tryPlay = () => {
      requestVideoPlay(options)
    }

    tryPlay()
    player.one?.('seeked', tryPlay)
    setTimeout(tryPlay, 80)
    return true
  }

  const togglePlayPause = () => {
    const player = playerRef.current
    if (!player) return

    if (player.paused?.()) {
      playFromCurrentPosition()
      return
    }

    player.pause?.()
  }

  const selectNote = async (note) => {
    if (!note) return false
    if (activeNoteSource === 'default' && note.id === selectedNoteId) {
      setSubtitleNotePreviewContent(null)
      setNoteDraft(note.content || '')
      setSelectedStart(note.start || '')
      setSelectedEnd(note.end || '')
      return true
    }

    const leaveResult = await confirmActiveNoteContentBeforeLeave()
    if (!leaveResult.canLeave) return false

    setSubtitleNotePreviewContent(null)
    setSelectedNoteId(note.id)
    setNoteDraft(note.content)
    setSelectedStart(note.start)
    setSelectedEnd(note.end)
    changeVideoOpenSource('default')
    return true
  }

  const selectNoteByIndex = async (index) => {
    if (notes.length === 0) return null

    const safeIndex = Math.max(0, Math.min(index, notes.length - 1))
    const note = notes[safeIndex]
    return await selectNote(note) ? note : null
  }

  const jumpToNote = async (note) => {
    if (!note) return
    const startSeconds = parseTime(note.start)
    if (!Number.isFinite(startSeconds)) return

    const noteVideoPath = note.sourceVideoPath || videoFile?.filePath || ''
    const currentVideoPath = videoFile?.filePath || ''

    if (noteVideoPath && !isSameFilePath(noteVideoPath, currentVideoPath)) {
      const canSwitch = await confirmBeforeSwitchVideo()
      if (!canSwitch) return

      const info = await window.videoApi?.getVideoFileInfo?.(noteVideoPath, { extraSubtitleFolder })
      if (!info?.ok) {
        showAutoMessage('Action message.', 'Message', 1400)
        return
      }

      await loadVideoInfo(info, {
        autoplay: true,
        seekTime: startSeconds,
        selectedNoteIndex: Number.isInteger(note.noteIndex) ? note.noteIndex : undefined,
      })
      return
    }

    const canSelect = await selectNote(note)
    if (!canSelect) return
    if (!playerRef.current) return

    playerRef.current.pause?.()
    playerRef.current.currentTime(startSeconds)
    setCurStart(note.start)
    setCurEnd(note.end)
    playFromCurrentPosition()
  }

  const applyPlaybackRate = (rate) => {
    const player = playerRef.current
    const nextRate = Number(rate)
    if (!player?.playbackRate || !Number.isFinite(nextRate) || nextRate <= 0) return

    player.playbackRate(nextRate)
    playingViewRef.current = { ...playingViewRef.current, playbackRate: nextRate }
    setPlaybackRate(nextRate)
  }

  const applyPlayingView = (playingView = playingViewRef.current) => {
    const player = playerRef.current
    if (!player) return
    const normalized = normalizePlayingView(playingView)
    playingViewRef.current = normalized
    player.playbackRate?.(normalized.playbackRate)
    player.volume?.(normalized.volume)
    setPlaybackRate(normalized.playbackRate)
    setVolume(normalized.volume)
  }

  const playAfterVideoSourceLoaded = (options = {}) => {
    const player = playerRef.current
    if (!player?.play) return
    const videoGeneration = activeVideoGenerationRef.current
    if (subtitleInteractionModeRef.current === 'reading') {
      requestVideoPlay({ source: 'autoplay' })
      return
    }

    const tryPlay = () => {
      if (videoGeneration !== activeVideoGenerationRef.current) return
      if (options.playbackRate) {
        applyPlaybackRate(options.playbackRate)
      }

      requestVideoPlay({ source: 'autoplay' })
    }

    player.one?.('loadedmetadata', tryPlay)
    player.one?.('canplay', tryPlay)
    setTimeout(tryPlay, 180)
  }

  const saveVideoNotes = async ({ silent = false, notesOverride = null } = {}) => {
    if (!videoFile?.filePath || !window.videoApi?.saveNotes) {
      showAutoMessage('No video file to save.')
      return false
    }

    const notesToSave = Array.isArray(notesOverride) ? notesOverride : notes
    const payload = notesToSave.map((note) => ({
      ...(note.raw || {}),
      Start: note.start,
      End: note.end,
      Content: note.content,
    }))

    const result = await window.videoApi.saveNotes(videoFile.filePath, payload)
    if (!result?.ok) {
      showAutoMessage('No video file to save.')
      return false
    }

    if (Number.isFinite(Number(result.jsonModifiedTime))) {
      setDirectoryMp4Files(directoryMp4Files.map((entry) => {
        const normalizedEntry = normalizeMp4FileEntry(entry)
        return normalizedEntry.fileName === videoFile.fileName
          ? { ...normalizedEntry, jsonModifiedTime: Number(result.jsonModifiedTime) }
          : normalizedEntry
      }))
    }
    setDirty(APP_MODES.VIDEO, false)
    if (!silent) {
      showAutoMessage('Action message.', 'Message', 900)
    }
    return true
  }

  const confirmBeforeSwitchVideo = async () => {
    const leaveResult = await confirmActiveNoteContentBeforeLeave()
    if (!leaveResult.canLeave) return false

    if (!dirty && !leaveResult.defaultContentSynced) return true

    const decision = await showActionDialog({
      title: 'Video notes changed',
      message: 'Current video notes have unsaved changes. Save before switching video?',
      defaultValue: 'save',
      cancelValue: 'cancel',
      actions: [
        { label: 'Save and Switch', value: 'save', primary: true },
        { label: 'Discard Changes', value: 'discard', danger: true },
        { label: 'Cancel', value: 'cancel' },
      ],
    })

    if (decision === 'save') {
      return saveVideoNotes({ silent: true, notesOverride: leaveResult.notesToSave })
    }

    if (decision === 'discard') {
      setDirty(APP_MODES.VIDEO, false)
      return true
    }

    return false
  }

  const closeCurrentVideo = async () => {
    if (!videoFile?.filePath) return

    const canClose = await confirmBeforeSwitchVideo()
    if (!canClose) return

    playerRef.current?.pause?.()
    rememberCurrentLoadedVideo()
    loadedVideoStateRef.current = {
      ...loadedVideoStateRef.current,
      activeLoaded: false,
    }
    if (subtitleInteractionModeRef.current === 'reading') {
      saveCurrentReadingPosition()
    }
    readingSessionRef.current = null
    subtitleInteractionModeRef.current = 'follow'
    setSubtitleInteractionMode('follow')
    setSubtitleReadingStatus(null)
    setSubtitleNotePreviewContent(null)
    stopSpeakSubtitleRef.current?.()
    clearSubtitlePickChord()
    setSubtitleLanguages([])
    setSelectedSubtitleLanguageKey('')
    setSelectedSubtitle(null)
    setSubtitleMenuOpen(false)
    setRollingSubtitleCues([])
    setRollingSubtitleError('')
    activeVideoGenerationRef.current += 1
    activeVideoPathRef.current = ''
    setVideoFile(null)
    setCurrentFile('')
    setCurrentPlaybackTime(0)
    setVideoDurationSeconds(0)
    setVideoDurationText('--:--:--.-')
    setPlayingTime('00:00:00.0')
    setCurStart('')
    setCurEnd('')

    if (videoOpenSourceRef.current === 'default') {
      setNotes([])
      setSelectedNoteId(null)
      setNoteDraft('')
      setSelectedStart('')
      setSelectedEnd('')
      setDirty(APP_MODES.VIDEO, false)
    }
  }

  leaveGuardHandlerRef.current = confirmBeforeSwitchVideo

  useEffect(() => {
    setLeaveGuard(APP_MODES.VIDEO, () => leaveGuardHandlerRef.current?.() ?? true)
    return () => setLeaveGuard(APP_MODES.VIDEO, null)
  }, [setLeaveGuard])

  useEffect(() => {
    registerSessionProvider(APP_MODES.VIDEO, () => ({
      currentFilePath: videoFile?.filePath || '',
      folderPath: directoryFolderPath,
      leftTab,
      rightToolTab,
      selectedNoteIndex: notes.findIndex((note) => note.id === selectedNoteId),
      playbackTime: getPlayerTime(),
      mainMiddleView: {
        toggleView: {
          activeState: fullscreenCycleState === 4 ? 4 : 0,
          states: {
            f0: normalizeFullscreenViewState(fullscreenViewStates.f0),
            f4: normalizeFullscreenViewState(fullscreenViewStates.f4),
          },
        },
        rollingPanelView: normalizeRollingPanelViewSnapshot(rollingPanelView, rollingSubtitleFontSize),
        playingView: normalizePlayingView({
          playbackRate: getPlaybackRate(),
          volume: playerRef.current?.volume?.() ?? playingViewRef.current.volume,
        }),
      },
      filterHistory: {
        notes: notesFilterHistory,
        notesPool: externalNotesFilterHistory,
      },
      mp4FileSort: {
        key: mp4SortKey,
        direction: mp4SortDirection,
      },
      readingPositions: getReadingPositionsSnapshot(),

      videoOpenSource,
      loadedVideoState: getLoadedVideoStateSnapshot(),
      notesPool: {
        notes: externalNotes,
        filterText: externalNotesFilterText,
        filterOn: externalNotesFilterOn,
        reverse: externalNotesReverse,
        showFileName: externalNotesShowFileName,
        folderSearchDepth: externalNotesFolderDepth,
        sources: externalNoteSources,
        loadedSources: externalNoteLoadedSources,
        selectedNoteId: selectedExternalNoteId,
        expandedNoteId: expandedExternalNoteId,
        draftContent: externalNoteDraftContent,
        dirtyNoteIds: [...dirtyExternalNoteIds],
      },
    }))
    return () => registerSessionProvider(APP_MODES.VIDEO, null)
  }, [
    dirtyExternalNoteIds,
    directoryFolderPath,
    expandedExternalNoteId,
    externalNoteDraftContent,
    externalNotes,
    externalNotesFilterHistory,
    externalNotesFilterOn,
    externalNotesFilterText,
    externalNotesFolderDepth,
    externalNoteLoadedSources,
    externalNoteSources,
    externalNotesReverse,
    externalNotesShowFileName,
    fullscreenCycleState,
    fullscreenViewStates,
    leftTab,
    mp4SortDirection,
    mp4SortKey,
    notes,
    notesFilterHistory,
    playbackRate,
    registerSessionProvider,
    rightToolTab,
    rollingPanelView,
    rollingSubtitleFontSize,
    selectedExternalNoteId,
    selectedNoteId,
    videoFile?.filePath,
    videoFile?.folderPath,
    videoOpenSource,
  ])

  useEffect(() => {
    const snapshot = restoreSessionState?.modes?.video
    if (!snapshot) return
    let canceled = false

    if (snapshot.leftTab === 'notes' || snapshot.leftTab === 'files') setLeftTab(snapshot.leftTab)
    if (snapshot.rightToolTab === 'main' || snapshot.rightToolTab === 'notesPool') setRightToolTab(snapshot.rightToolTab)
    const mainMiddleViewSnapshot = snapshot.mainMiddleView || {}
    const restoredToggleView = normalizeToggleViewSnapshot(
      mainMiddleViewSnapshot.toggleView || snapshot.toggleView,
      snapshot.fullscreenCycleState,
    )
    const restoredRollingPanelView = normalizeRollingPanelViewSnapshot(mainMiddleViewSnapshot.rollingPanelView)
    const restoredPlayingView = normalizePlayingView(mainMiddleViewSnapshot.playingView, snapshot.playbackRate)
    setFullscreenCycleState(restoredToggleView.activeState)
    setFullscreenViewStates((current) => ({
      ...current,
      f0: restoredToggleView.states.f0,
      f4: restoredToggleView.states.f4,
    }))
    setRollingPanelView(restoredRollingPanelView)
    playingViewRef.current = restoredPlayingView
    setPlaybackRate(restoredPlayingView.playbackRate)
    setVolume(restoredPlayingView.volume)
    setNotesFilterHistory(normalizeFilterHistory(snapshot.filterHistory?.notes))
    setExternalNotesFilterHistory(normalizeFilterHistory(snapshot.filterHistory?.notesPool))
    if (MP4_SORT_OPTIONS.some((option) => option.value === snapshot.mp4FileSort?.key)) {
      setMp4SortKey(snapshot.mp4FileSort.key)
    }
    if (snapshot.mp4FileSort?.direction === 'asc' || snapshot.mp4FileSort?.direction === 'desc') {
      setMp4SortDirection(snapshot.mp4FileSort.direction)
    }
    const restoredReadingPositions = normalizeReadingPositions(snapshot.readingPositions)
    readingPositionsRef.current = restoredReadingPositions
    setReadingPositions(restoredReadingPositions)

    const notesPoolSnapshot = snapshot.notesPool || {}
    const restoredExternalNotes = Array.isArray(notesPoolSnapshot.notes) ? notesPoolSnapshot.notes : []
    setExternalNotes(restoredExternalNotes)
    setExternalNotesFilterText(typeof notesPoolSnapshot.filterText === 'string' ? notesPoolSnapshot.filterText : '')
    setExternalNotesFilterOn(notesPoolSnapshot.filterOn === true)
    setExternalNotesReverse(notesPoolSnapshot.reverse === true)
    setExternalNotesShowFileName(notesPoolSnapshot.showFileName !== false)
    setExternalNotesFolderDepth(Math.max(
      0,
      Math.min(MAX_NOTES_POOL_FOLDER_DEPTH, Math.trunc(Number(notesPoolSnapshot.folderSearchDepth) || 0))
    ))
    const legacySourcePaths = [...new Set(restoredExternalNotes.map((note) => note.sourceJsonPath).filter(Boolean))]
    const restoredSources = normalizeNotesPoolSources(
      Array.isArray(notesPoolSnapshot.sources)
        ? notesPoolSnapshot.sources
        : legacySourcePaths.map((sourcePath, index) => ({
            type: 'file',
            path: sourcePath,
            selected: true,
            lastUsedAt: Date.now() - index,
          }))
    )
    const restoredLoadedSources = normalizeNotesPoolSources(
      Array.isArray(notesPoolSnapshot.loadedSources)
        ? notesPoolSnapshot.loadedSources
        : restoredSources.filter((source) => source.selected)
    ).map((source) => ({ ...source, selected: true, error: '' }))
    setExternalNoteSources(limitNotesPoolSources(restoredSources, restoredLoadedSources))
    setExternalNoteLoadedSources(restoredLoadedSources)
    const restoredExternalNoteId = restoredExternalNotes.some((note) => note.id === notesPoolSnapshot.selectedNoteId)
      ? notesPoolSnapshot.selectedNoteId
      : ''
    setSelectedExternalNoteId(restoredExternalNoteId)
    setExpandedExternalNoteId(
      restoredExternalNotes.some((note) => note.id === notesPoolSnapshot.expandedNoteId)
        ? notesPoolSnapshot.expandedNoteId
        : ''
    )
    setExternalNoteDraftContent(typeof notesPoolSnapshot.draftContent === 'string' ? notesPoolSnapshot.draftContent : '')
    setDirtyExternalNoteIds(() => new Set(Array.isArray(notesPoolSnapshot.dirtyNoteIds) ? notesPoolSnapshot.dirtyNoteIds : []))

    const restoredLoadedVideoState = normalizeLoadedVideoState(snapshot.loadedVideoState, snapshot)
    const restoredVideoOpenSource = restoredLoadedVideoState.activeSource
    const restoredActiveVideo = restoredLoadedVideoState.sources[restoredVideoOpenSource]
    loadedVideoStateRef.current = restoredLoadedVideoState
    videoOpenSourceRef.current = restoredVideoOpenSource
    setVideoOpenSource(restoredVideoOpenSource)
    const restoredDirectoryFolder = typeof snapshot.folderPath === 'string' && snapshot.folderPath
      ? snapshot.folderPath
      : splitPath(restoredActiveVideo.filePath).folderPath
    setDirectoryFolderPath(restoredDirectoryFolder)
    if (!restoredLoadedVideoState.activeLoaded && restoredDirectoryFolder && window.videoApi?.listMp4Files) {
      window.videoApi.listMp4Files(restoredDirectoryFolder).then((result) => {
        if (canceled || !result?.ok) return
        setDirectoryMp4Files((result.mp4Files || []).map(normalizeMp4FileEntry))
        setSelectedDirectoryMp4Name(splitPath(restoredActiveVideo.filePath).fileName)
      }).catch((error) => {
        window.debugApi?.log(`Closed video folder restore failed: ${error?.message || error}`)
      })
    }
    if (
      restoredVideoOpenSource === 'pool'
      && restoredLoadedVideoState.sources.default.filePath
      && window.videoApi?.readNotes
    ) {
      const defaultFilePath = restoredLoadedVideoState.sources.default.filePath
      window.videoApi.readNotes(defaultFilePath).then((result) => {
        if (canceled || !result?.ok) return
        const restoredDefaultNotes = (Array.isArray(result.notes) ? result.notes : []).map((note, index) => ({
          id: `${defaultFilePath}-${index}`,
          noteIndex: index,
          sourceVideoPath: defaultFilePath,
          sourceVideoName: splitPath(defaultFilePath).fileName,
          start: note.Start || note.start || '',
          end: note.End || note.end || '',
          content: note.Content || note.content || '',
          raw: note,
        }))
        const restoredDefaultNoteIndex = Number.isInteger(Number(snapshot.selectedNoteIndex))
          && Number(snapshot.selectedNoteIndex) >= 0
          && Number(snapshot.selectedNoteIndex) < restoredDefaultNotes.length
          ? Number(snapshot.selectedNoteIndex)
          : -1
        const restoredDefaultNote = restoredDefaultNoteIndex >= 0
          ? restoredDefaultNotes[restoredDefaultNoteIndex]
          : null

        setNotes(restoredDefaultNotes)
        setSelectedNoteId(restoredDefaultNote?.id || null)
        setNoteDraft(restoredDefaultNote?.content || '')
        setSelectedStart(restoredDefaultNote?.start || '')
        setSelectedEnd(restoredDefaultNote?.end || '')
        setDirty(APP_MODES.VIDEO, false)
      }).catch((error) => {
        window.debugApi?.log(`Default video notes restore failed: ${error?.message || error}`)
      })
    }
    if (restoredLoadedVideoState.activeLoaded && restoredActiveVideo.filePath) {
      openVideoFileFullPath(restoredActiveVideo.filePath, {
        autoplay: false,
        playbackRate: restoredPlayingView.playbackRate,
        selectedNoteIndex: snapshot.selectedNoteIndex,
        seekTime: restoredActiveVideo.playbackTime,
        updateDirectoryMp4Files: restoredVideoOpenSource !== 'pool',
        videoOpenSource: restoredVideoOpenSource,
      })
    }
    return () => {
      canceled = true
    }
  }, [restoreSessionState])

  const chooseSubtitleLanguage = async (languageOptions = [], options = {}) => {
    if (languageOptions.length === 0) {
      return null
    }

    if (languageOptions.length === 1) {
      return languageOptions[0]
    }

    if (options.playAllAuto) {
      const matchedLanguage = languageOptions.find((entry) => (
        matchesSubtitleSuffix(entry.subtitle, playAllSubtitleSuffix)
        || matchesSubtitleSuffix(entry.srtSubtitle, playAllSubtitleSuffix)
      ))
      if (matchedLanguage) return matchedLanguage
    }

    const selectedLanguage = await showSubtitleChoiceDialog(languageOptions.map((entry) => ({
      ...entry,
      filePath: getSubtitleLanguageKey(entry.language),
      fileName: entry.subtitle?.fileName || entry.srtSubtitle?.fileName || '',
    })), {
      timeoutMs: subtitleConvertPromptTimeoutSec * 1000,
      timeoutValue: getSubtitleLanguageKey(languageOptions[0]?.language),
    })
    if (!selectedLanguage || selectedLanguage === 'none') {
      return null
    }

    return languageOptions.find((entry) => getSubtitleLanguageKey(entry.language) === selectedLanguage) || null
  }

  const chooseSrtSubtitleForConversion = async (srtSubtitle, options = {}) => {
    if (!srtSubtitle) {
      return null
    }

    if (options.autoConvertSrt) {
      return srtSubtitle
    }

    const decision = await showActionDialog({
      title: 'Convert SRT subtitle',
      message: 'No VTT subtitle found. Convert SRT subtitle ' + srtSubtitle.fileName + ' to VTT?',
      defaultValue: 'convert',
      cancelValue: 'cancel',
      timeoutMs: subtitleConvertPromptTimeoutSec * 1000,
      timeoutValue: 'cancel',
      actions: [
        { label: 'Convert', value: 'convert', primary: true },
        { label: 'Cancel', value: 'cancel' },
      ],
    })

    return decision === 'convert' ? srtSubtitle : null
  }

  const convertSrtSubtitleInBackground = async (videoInfo, srtSubtitle) => {
    if (!window.videoApi?.convertSrtSubtitle || !srtSubtitle?.filePath) {
      return
    }

    try {
      const result = await window.videoApi.convertSrtSubtitle({
        filePath: srtSubtitle.filePath,
        videoBaseName: removeFileExtension(videoInfo.fileName),
      })

      if (result?.ok && result.subtitle) {
        setSelectedSubtitle(result.subtitle)
        setSelectedSubtitleLanguageKey(getSubtitleLanguageKey(result.subtitle.language))
        setSubtitleLanguages((current) => current.map((entry) => (
          (entry.language || '') === (result.subtitle.language || '')
            ? { ...entry, subtitle: result.subtitle }
            : entry
        )))
        showAutoMessage('Action message.', 'Message', 900)
        return
      }

      showAutoMessage('Action message.', 'Message', 1500)
    } catch {
      showAutoMessage('Action message.', 'Message', 1500)
    }
  }

  const applySubtitleLanguage = async (languageKey, languageOptions = subtitleLanguages, options = {}) => {
    if (!languageKey) {
      setSelectedSubtitle(null)
      return
    }

    const entry = languageOptions.find((item) => getSubtitleLanguageKey(item.language) === languageKey)
    if (!entry) {
      setSelectedSubtitle(null)
      return
    }

    if (entry.subtitle) {
      setSelectedSubtitle(entry.subtitle)
      return
    }

    const srtSubtitle = await chooseSrtSubtitleForConversion(entry.srtSubtitle, options)
    if (srtSubtitle && videoFile) {
      convertSrtSubtitleInBackground(videoFile, srtSubtitle)
    }
  }

  const selectSubtitleLanguage = (languageKey) => {
    setSelectedSubtitleLanguageKey(languageKey)
    setSubtitleMenuOpen(false)
    if (titleOn) {
      applySubtitleLanguage(languageKey)
    }
  }

  const openSubtitleExternal = async (entry) => {
    const subtitlePath = entry?.subtitle?.filePath || entry?.srtSubtitle?.filePath || ''
    if (!subtitlePath) return

    const result = await window.videoApi?.openSubtitleExternal?.(subtitlePath)
    if (!result?.ok) {
      showAutoMessage('Action message.', 'Message', 1400)
    }
  }

  const handleSubtitleToggle = (event) => {
    const enabled = event.target.checked
    setTitleOn(enabled)
    if (enabled) {
      applySubtitleLanguage(selectedSubtitleLanguageKey)
    }
  }

  const loadVideoInfo = async (info, options = {}) => {
    if (!info?.ok) {
      const errorMessage = info?.reason === 'matching-mp4-not-found'
        ? 'Matching MP4 file not found.'
        : info?.reason === 'unsupported-video-source'
          ? 'Only MP4 or JSON files are supported.'
          : 'File not found.'
      showAutoMessage(errorMessage, 'Open video', 1800)
      return
    }

    if (
      options.allowPoolToDefault !== true
      && options.videoOpenSource !== 'pool'
      && activeNoteSource === 'pool'
      && selectedExternalNote?.sourceVideoPath
      && isSameFilePath(info.filePath, selectedExternalNote.sourceVideoPath)
    ) {
      showAutoMessage('Action message.', 'Message', 1800)
      return
    }

    const rememberedClosedSlot = !loadedVideoStateRef.current.activeLoaded && options.seekTime == null
      ? Object.values(loadedVideoStateRef.current.sources).find((slot) => (
          isSameFilePath(slot.filePath, info.filePath)
        ))
      : null
    const restoredSeekTime = rememberedClosedSlot?.playbackTime ?? options.seekTime
    const restoreClosedVideo = Boolean(rememberedClosedSlot)

    const nextSubtitleLanguages = normalizeSubtitleLanguages(info)
    const subtitleOptions = {
      ...options,
      playAllAuto: options.playAllAuto || playAll,
    }
    const subtitleLanguage = await chooseSubtitleLanguage(nextSubtitleLanguages, subtitleOptions)
    const selectedLanguageKey = subtitleLanguage ? getSubtitleLanguageKey(subtitleLanguage.language) : ''
    const subtitle = subtitleLanguage?.subtitle || null
    const srtSubtitle = subtitle ? null : await chooseSrtSubtitleForConversion(subtitleLanguage?.srtSubtitle, {
      ...subtitleOptions,
      autoConvertSrt: subtitleOptions.playAllAuto || Boolean(subtitleLanguage),
    })

    const nextVideoOpenSource = options.videoOpenSource === 'pool' ? 'pool' : 'default'
    const restoredPlaybackTime = Number(restoredSeekTime)
    rememberCurrentLoadedVideo()
    loadedVideoStateRef.current = {
      ...loadedVideoStateRef.current,
      activeSource: nextVideoOpenSource,
      activeLoaded: true,
      sources: {
        ...loadedVideoStateRef.current.sources,
        [nextVideoOpenSource]: {
          filePath: info.filePath,
          playbackTime: Number.isFinite(restoredPlaybackTime) && restoredPlaybackTime >= 0
            ? restoredPlaybackTime
            : 0,
        },
      },
    }
    videoOpenSourceRef.current = nextVideoOpenSource
    activeVideoGenerationRef.current += 1
    activeVideoPathRef.current = info.filePath
    readingResumeHandledRef.current = false
    setVideoFile(info)
    setVideoOpenSource(nextVideoOpenSource)
    setSubtitleLanguages(nextSubtitleLanguages)
    setSelectedSubtitleLanguageKey(selectedLanguageKey)
    setSelectedSubtitle(subtitle)
    setCurrentFile(info.filePath)
    if (nextVideoOpenSource === 'default' && info.folderPath) {
      setDirectoryFolderPath(info.folderPath)
    }
    setVideoDurationSeconds(0)
    setVideoDurationText('--:--:--.-')
    addRecentFile(APP_MODES.VIDEO, info.filePath)
    if (info.folderPath) {
      addRecentFolder(APP_MODES.VIDEO, info.folderPath)
    }
    if (nextVideoOpenSource === 'default') {
      const loadedNotes = (info.notes || []).map((note, index) => ({
        id: `${info.filePath}-${index}`,
        noteIndex: index,
        sourceVideoPath: info.filePath,
        sourceVideoName: info.fileName || '',
        start: note.Start || note.start || '',
        end: note.End || note.end || '',
        content: note.Content || note.content || '',
        raw: note,
      }))
      const restoredNoteIndex = Number.isFinite(Number(options.selectedNoteIndex))
        ? Math.max(0, Math.min(Number(options.selectedNoteIndex), loadedNotes.length - 1))
        : -1
      const restoredNote = restoredNoteIndex >= 0 ? loadedNotes[restoredNoteIndex] : null

      setNotes(loadedNotes)
      if (options.updateDirectoryMp4Files !== false) {
        setDirectoryMp4Files(info.mp4Files || [])
      }
      setSelectedDirectoryMp4Name(info.fileName || '')
      setSelectedNoteId(restoredNote?.id || null)
      setNoteDraft(restoredNote?.content || '')
      setSelectedStart(restoredNote?.start || '')
      setSelectedEnd(restoredNote?.end || '')
      setCurStart('')
      setCurEnd('')
      setDirty(APP_MODES.VIDEO, false)
    }

    const nextPlayingView = normalizePlayingView({
      ...playingViewRef.current,
      playbackRate: options.playbackRate ?? playingViewRef.current.playbackRate,
    })
    playingViewRef.current = nextPlayingView
    applyPlayingView(nextPlayingView)

    if (Number.isFinite(Number(restoredSeekTime))) {
      seekWhenReady(Number(restoredSeekTime))
    }

    if (options.autoplay && !restoreClosedVideo) {
      playAfterVideoSourceLoaded({ playbackRate: options.playbackRate })
    }

    if (srtSubtitle) {
      convertSrtSubtitleInBackground(info, srtSubtitle)
    }
  }

  const openVideoFileFullPath = async (fullPath, options = {}) => {
    if (!fullPath || !window.videoApi?.getVideoFileInfo) return

    const rememberedClosedSlot = !loadedVideoStateRef.current.activeLoaded
      ? Object.values(loadedVideoStateRef.current.sources).find((slot) => (
          isSameFilePath(slot.filePath, fullPath)
        ))
      : null
    const openOptions = rememberedClosedSlot && options.seekTime == null
      ? {
          ...options,
          autoplay: false,
          seekTime: rememberedClosedSlot.playbackTime,
        }
      : options

    if (
      openOptions.allowPoolToDefault !== true
      && activeNoteSource === 'pool'
      && selectedExternalNote?.sourceVideoPath
      && isSameFilePath(fullPath, selectedExternalNote.sourceVideoPath)
      && openOptions.videoOpenSource !== 'pool'
    ) {
      showAutoMessage('Action message.', 'Message', 1800)
      return
    }

    if (!openOptions.skipSwitchConfirm) {
      const canSwitch = await confirmBeforeSwitchVideo()
      if (!canSwitch) return
    }

    const poolSource = openOptions.videoOpenSource === 'pool'
    const info = await window.videoApi.getVideoFileInfo(fullPath, {
      extraSubtitleFolder,
      loadDirectoryMp4Files: !poolSource && openOptions.updateDirectoryMp4Files !== false,
      loadNotes: !poolSource,
    })
    await loadVideoInfo(info, openOptions)
  }

  const openVideoFilePath = async (fileName) => {
    if (!directoryFolderPath) return
    openVideoFileFullPath(joinPath(directoryFolderPath, fileName), { autoplay: true })
  }

  const openRecentVideoFile = async (fullPath) => {
    const sameFileOpenFromPool = videoOpenSourceRef.current === 'pool'
      && isSameFilePath(fullPath, videoFile?.filePath)

    if (!sameFileOpenFromPool) {
      await openVideoFileFullPath(fullPath, { autoplay: true })
      return
    }

    const decision = await showActionDialog({
      title: 'Switch video source',
      message: 'This file is already open from Pool. Switch to Default mode?',
      defaultValue: 'switch',
      cancelValue: 'cancel',
      actions: [
        { label: 'Switch to Default', value: 'switch', primary: true },
        { label: 'Cancel', value: 'cancel' },
      ],
    })
    if (decision !== 'switch') return

    await openVideoFileFullPath(fullPath, {
      allowPoolToDefault: true,
      autoplay: true,
      videoOpenSource: 'default',
    })
  }

  const copyMp4FileName = async (filePath) => {
    const { fileName } = splitPath(filePath)
    if (!fileName || !window.videoApi?.writeClipboardText) return
    await window.videoApi.writeClipboardText(fileName)
    showAutoMessage('Filename copied.', 'MP4 File', 900)
  }

  const openMp4Folder = async (filePath) => {
    const result = await window.videoApi?.showFileInFolder?.(filePath)
    if (!result?.ok) {
      showAutoMessage('Unable to open the file folder.', 'MP4 File', 1600)
    }
  }

  const renameMp4File = async (filePath) => {
    if (!filePath || isSameFilePath(filePath, videoFile?.filePath)) return

    const { folderPath, fileName } = splitPath(filePath)
    let draftFileName = fileName
    let draftJidGenerated = false
    let collisionRegenerated = false
    let result = null

    while (true) {
      const suffixState = getRenameSuffixState(draftFileName)
      const response = await showActionDialog({
        kind: 'videoRename',
        title: collisionRegenerated ? 'Rename MP4 File - JID collision' : 'Rename MP4 File',
        originalFileName: fileName,
        fileName: draftFileName,
        jidChecked: suffixState.hasJid,
        jomChecked: suffixState.hasJom,
        jidGenerated: draftJidGenerated,
        defaultValue: 'ok',
        cancelValue: 'cancel',
        actions: [
          { label: 'OK', value: 'ok', primary: true },
          { label: 'Cancel', value: 'cancel' },
        ],
      })
      if (response?.decision !== 'ok') return

      const nextFileName = String(response.text || '').trim()
      if (nextFileName === fileName) return

      const confirmDecision = await showActionDialog({
        kind: 'videoRenameConfirm',
        title: 'Confirm Rename',
        originalFileName: fileName,
        fileName: nextFileName,
        defaultValue: 'confirm',
        cancelValue: 'back',
        actions: [
          { label: 'Confirm', value: 'confirm', primary: true },
          { label: 'Back', value: 'back' },
        ],
      })
      if (confirmDecision !== 'confirm') {
        draftFileName = nextFileName
        draftJidGenerated = response.jidGenerated === true
        collisionRegenerated = false
        continue
      }

      result = await window.videoApi?.renameFile?.({ filePath, fileName: nextFileName })
      if (result?.ok || result?.reason !== 'target-file-exists' || !response.jidGenerated) break

      draftFileName = regenerateNumericJid(nextFileName)
      draftJidGenerated = true
      collisionRegenerated = true
    }

    if (!result?.ok) {
      const message = result?.reason === 'target-file-exists'
        ? 'A file with the new name already exists.'
        : result?.reason === 'invalid-file-name'
          ? 'Enter a valid MP4 filename.'
          : result?.reason === 'file-not-found'
            ? 'The MP4 file was not found.'
            : `Rename failed${result?.reason ? `: ${result.reason}` : '.'}`
      showAutoMessage(message, 'Rename MP4 File', 1800)
      return
    }

    replaceRecentFile(APP_MODES.VIDEO, filePath, result.filePath)
    if (isSameFilePath(folderPath, directoryFolderPath)) {
      setDirectoryMp4Files(result.mp4Files || [])
      if (selectedDirectoryMp4Name === fileName) {
        setSelectedDirectoryMp4Name(result.fileName)
      }
    }
    loadedVideoStateRef.current = {
      ...loadedVideoStateRef.current,
      sources: Object.fromEntries(Object.entries(loadedVideoStateRef.current.sources).map(([source, state]) => [
        source,
        isSameFilePath(state.filePath, filePath) ? { ...state, filePath: result.filePath } : state,
      ])),
    }
    const renamedPathMap = new Map((result.renamedFiles || []).map((entry) => [
      String(entry.from || '').replaceAll('/', '\\').toLowerCase(),
      entry.to,
    ]))
    readingPositionsRef.current = readingPositionsRef.current.map((entry) => ({
      ...entry,
      videoPath: isSameFilePath(entry.videoPath, filePath) ? result.filePath : entry.videoPath,
      subtitlePath: renamedPathMap.get(String(entry.subtitlePath || '').replaceAll('/', '\\').toLowerCase())
        || entry.subtitlePath,
    }))
    if (notes.some((note) => isSameFilePath(note.sourceVideoPath, filePath))) {
      setNotes(notes.map((note) => (
        isSameFilePath(note.sourceVideoPath, filePath)
          ? { ...note, sourceVideoPath: result.filePath, sourceVideoName: result.fileName }
          : note
      )))
    }
    showAutoMessage('File renamed.', 'Rename MP4 File', 1100)
  }

  const confirmBeforePlayNextVideo = async () => {
    const leaveResult = await confirmActiveNoteContentBeforeLeave()
    if (!leaveResult.canLeave) return false

    if (!dirty && !leaveResult.defaultContentSynced) return true

    const decision = await showActionDialog({
      title: 'Video notes changed',
      message: 'Current video notes have unsaved changes. Save before playing next video?',
      defaultValue: 'save-next',
      cancelValue: 'stay',
      actions: [
        { label: 'Save and Play Next', value: 'save-next', primary: true },
        { label: 'Discard and Play Next', value: 'discard-next' },
        { label: 'Stay Here', value: 'stay' },
      ],
    })

    if (decision === 'save-next') {
      return saveVideoNotes({ silent: true, notesOverride: leaveResult.notesToSave })
    }

    if (decision === 'discard-next') {
      setDirty(APP_MODES.VIDEO, false)
      return true
    }

    playerRef.current?.pause?.()
    return false
  }

  const playNextDirectoryVideo = async () => {
    if (!playAll || repeat || !videoFile?.folderPath || sortedDirectoryMp4Files.length === 0) return

    const currentIndex = sortedDirectoryMp4Files.findIndex((entry) => entry.fileName === videoFile.fileName)
    if (currentIndex < 0 || currentIndex >= sortedDirectoryMp4Files.length - 1) return

    const canPlayNext = await confirmBeforePlayNextVideo()
    if (!canPlayNext) return

    const nextFileName = sortedDirectoryMp4Files[currentIndex + 1].fileName
    openVideoFileFullPath(joinPath(videoFile.folderPath, nextFileName), {
      autoplay: true,
      playbackRate: getPlaybackRate(),
      playAllAuto: true,
      skipSwitchConfirm: true,
    })
  }

  const selectDirectoryMp4ByIndex = (index) => {
    if (sortedDirectoryMp4Files.length === 0) return ''

    const safeIndex = Math.max(0, Math.min(index, sortedDirectoryMp4Files.length - 1))
    const fileName = sortedDirectoryMp4Files[safeIndex].fileName
    setSelectedDirectoryMp4Name(fileName)
    return fileName
  }

  const handleDirectoryMp4KeyDown = (event) => {
    if (!['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) return

    event.preventDefault()
    event.stopPropagation()

    if (event.key === 'Enter') {
      const fileName = selectedDirectoryMp4Name || selectDirectoryMp4ByIndex(0)
      if (fileName) openVideoFilePath(fileName)
      return
    }

    const currentIndex = sortedDirectoryMp4Files.findIndex((entry) => entry.fileName === selectedDirectoryMp4Name)
    const baseIndex = currentIndex >= 0 ? currentIndex : 0
    const nextIndex = event.key === 'ArrowUp' ? baseIndex - 1 : baseIndex + 1
    selectDirectoryMp4ByIndex(currentIndex >= 0 ? nextIndex : 0)
  }

  const loadVideoFolderPath = async (folderPath) => {
    if (!folderPath || !window.videoApi?.listMp4Files) return

    const canSwitch = await confirmBeforeSwitchVideo()
    if (!canSwitch) return

    const result = await window.videoApi.listMp4Files(folderPath)
    if (!result?.ok) return

    addRecentFolder(APP_MODES.VIDEO, folderPath)
    const mp4Files = (result.mp4Files || []).map(normalizeMp4FileEntry)
    const sortedMp4Files = sortMp4Files(mp4Files, mp4SortKey, mp4SortDirection)
    const firstFileName = sortedMp4Files[0]?.fileName || ''
    setDirectoryFolderPath(folderPath)
    setDirectoryMp4Files(mp4Files)
    setSelectedDirectoryMp4Name(firstFileName)

    if (firstFileName && window.videoApi?.getVideoFileInfo) {
      const info = await window.videoApi.getVideoFileInfo(joinPath(folderPath, firstFileName), { extraSubtitleFolder })
      await loadVideoInfo({
        ...info,
        mp4Files,
      })
    }
  }

  const openVideoFile = async () => {
    if (!window.videoApi?.openVideoFile) {
      showAutoMessage('No video file to save.')
      return
    }

    const canSwitch = await confirmBeforeSwitchVideo()
    if (!canSwitch) return

    const info = await window.videoApi.openVideoFile({ extraSubtitleFolder })
    if (info?.canceled) return
    await loadVideoInfo(info, { autoplay: true })
  }

  const appendExternalNotes = (result) => {
    if (!result?.ok && !result?.canceled) {
      showAutoMessage('Action message.', 'Message', 1400)
      return
    }

    if (result?.canceled) return

    const loadedNotes = Array.isArray(result?.notes) ? result.notes : []
    const sourceResults = Array.isArray(result?.sourceResults) ? result.sourceResults : []
    const loadedSourceRecords = sourceResults
      .filter((source) => source.ok)
      .map((source) => normalizeNotesPoolSource({ ...source, selected: true, error: '' }))
      .filter(Boolean)
    const loadedSourceIds = new Set(loadedSourceRecords.map((source) => source.id))
    const now = Date.now()

    setExternalNotes((current) => {
      const byId = new Map(current.map((note) => [note.id, note]))
      loadedNotes.forEach((note) => byId.set(note.id, note))
      return [...byId.values()]
    })
    setDirtyExternalNoteIds((current) => {
      const next = new Set(current)
      loadedNotes.forEach((note) => next.delete(note.id))
      return next
    })
    setExternalNoteLoadedSources((current) => {
      const byId = new Map(current.map((source) => [source.id, source]))
      loadedSourceRecords.forEach((source) => {
        const previous = byId.get(source.id)
        if (source.type === 'folder' && previous?.type === 'folder' && source.depth < previous.depth) {
          return
        }
        byId.set(source.id, source)
      })
      return [...byId.values()]
    })
    setExternalNoteSources((current) => {
      const byId = new Map(current.map((source) => [source.id, source]))
      sourceResults.forEach((source, index) => {
        const normalized = normalizeNotesPoolSource({
          ...source,
          selected: true,
          lastUsedAt: now - index,
          error: source.ok ? '' : describeNotesPoolSourceError(source.reason),
        })
        if (normalized) byId.set(normalized.id, normalized)
      })
      const records = [...byId.values()].sort((left, right) => right.lastUsedAt - left.lastUsedAt)
      const protectedIds = new Set([
        ...externalNoteLoadedSources.map((source) => source.id),
        ...loadedSourceIds,
        ...records.filter((source) => source.selected).map((source) => source.id),
      ])
      const protectedRecords = records.filter((source) => protectedIds.has(source.id))
      const recentRecords = records.filter((source) => !protectedIds.has(source.id))
      return [...protectedRecords, ...recentRecords.slice(0, Math.max(0, MAX_NOTES_POOL_SOURCES - protectedRecords.length))]
    })
    setRightToolTab('notesPool')
    const skippedCount = Array.isArray(result?.skippedFiles) ? result.skippedFiles.length : 0
    const failedCount = sourceResults.filter((source) => !source.ok).length
    showAutoMessage(
      'Loaded ' + loadedNotes.length + ' legacy video notes'
        + (skippedCount ? ', skipped ' + skippedCount + ' JSON files' : '')
        + (failedCount ? ', ' + failedCount + ' source failed' : '')
        + '.',
      'Notes Pool',
      1800
    )
  }

  const toggleExternalNoteSource = (sourceId) => {
    setExternalNoteSources((current) => current.map((source) => (
      source.id === sourceId
        ? { ...source, selected: !source.selected, error: '' }
        : source
    )))
  }

  const toggleExternalNoteSourcesMenu = () => {
    if (externalNoteSourcesOpen) {
      setExternalNoteSourcesOpen(false)
      return
    }

    const bounds = notesPoolSourceButtonRef.current?.getBoundingClientRect()
    const menuWidth = Math.min(340, Math.max(220, window.innerWidth - 16))
    const menuTop = Math.min(window.innerHeight - 48, (bounds?.bottom || 8) + 4)
    setExternalNoteSourcesPosition({
      left: Math.max(8, Math.min(window.innerWidth - menuWidth - 8, (bounds?.right || window.innerWidth) - menuWidth)),
      top: menuTop,
      width: menuWidth,
      maxHeight: Math.max(40, window.innerHeight - menuTop - 8),
    })
    setExternalNoteSourcesOpen(true)
  }

  const cleanRecentExternalNoteSources = async () => {
    if (cleanableExternalNoteSourceCount === 0) return
    setExternalNoteSourcesOpen(false)
    const decision = await showActionDialog({
      title: 'Clean sources',
      message: 'Remove all sources that are not currently loaded?',
      actions: [
        { label: 'Clean', value: 'clean', primary: true },
        { label: 'Cancel', value: 'cancel' },
      ],
      defaultValue: 'cancel',
      cancelValue: 'cancel',
    })
    if (decision !== 'clean') return

    const loadedIds = new Set(externalNoteLoadedSources.map((source) => source.id))
    setExternalNoteSources((current) => current.filter((source) => loadedIds.has(source.id)))
  }

  const removeRecentExternalNoteSource = async (source) => {
    const isLoaded = externalNoteLoadedSources.some((loadedSource) => loadedSource.id === source?.id)
    if (!source || source.selected || isLoaded) return

    setExternalNoteSourcesOpen(false)
    const decision = await showActionDialog({
      title: 'Remove source',
      message: 'Remove this source from recent sources?',
      actions: [
        { label: 'Remove', value: 'remove', danger: true },
        { label: 'Cancel', value: 'cancel' },
      ],
      defaultValue: 'cancel',
      cancelValue: 'cancel',
    })
    if (decision !== 'remove') return

    setExternalNoteSources((current) => current.filter((item) => item.id !== source.id))
  }

  const reloadExternalNoteSources = async () => {
    if (selectedExternalNoteSources.length === 0 || externalNotesReloading) return
    if (!window.videoApi?.loadLegacyNoteSources) {
      showAutoMessage('Action message.', 'Message', 1400)
      return
    }

    const canLeave = await confirmExternalNoteDirtyBeforeLeave()
    if (!canLeave) return

    setExternalNotesReloading(true)
    try {
      const result = await window.videoApi.loadLegacyNoteSources(selectedExternalNoteSources.map((source) => ({
        type: source.type,
        path: source.path,
        depth: source.depth,
      })))
      if (!result?.ok) {
        showAutoMessage('Reload failed.', 'Notes Pool', 1800)
        return
      }

      const loadedNotes = Array.isArray(result.notes) ? result.notes : []
      const sourceResults = Array.isArray(result.sourceResults) ? result.sourceResults : []
      const successfulSources = sourceResults
        .filter((source) => source.ok)
        .map((source) => normalizeNotesPoolSource({ ...source, selected: true, error: '' }))
        .filter(Boolean)
      const resultById = new Map(sourceResults.map((source) => [
        getNotesPoolSourceId(source.type, source.path),
        source,
      ]))

      setExternalNotes(loadedNotes)
      setExternalNoteLoadedSources(successfulSources)
      const reloadTime = Date.now()
      setExternalNoteSources((current) => limitNotesPoolSources(current.map((source, index) => {
        if (!source.selected) return { ...source, error: '' }
        const sourceResult = resultById.get(source.id)
        return {
          ...source,
          lastUsedAt: reloadTime - index,
          error: sourceResult?.ok ? '' : describeNotesPoolSourceError(sourceResult?.reason),
        }
      }), successfulSources))
      setDirtyExternalNoteIds(new Set())

      const loadedNoteIds = new Set(loadedNotes.map((note) => note.id))
      if (!loadedNoteIds.has(selectedExternalNoteId)) {
        setSelectedExternalNoteId('')
        setExpandedExternalNoteId('')
        setExternalNoteDraftContent('')
      } else {
        const reloadedSelectedNote = loadedNotes.find((note) => note.id === selectedExternalNoteId)
        setExternalNoteDraftContent(reloadedSelectedNote?.content || '')
      }

      const failedCount = sourceResults.filter((source) => !source.ok).length
      showAutoMessage(
        failedCount
          ? `Reloaded ${successfulSources.length} sources; ${failedCount} failed.`
          : `Reloaded ${successfulSources.length} sources.`,
        'Notes Pool',
        1800
      )
    } catch (error) {
      showAutoMessage('Reload failed.', 'Notes Pool', 1800)
      window.debugApi?.log(`Notes Pool reload failed: ${error.message || String(error)}`)
    } finally {
      setExternalNotesReloading(false)
    }
  }

  const updateExternalNoteDraftContent = (noteId, content) => {
    setExternalNoteDraftContent(content)
    setDirtyExternalNoteIds((current) => {
      const next = new Set(current)
      const note = externalNotes.find((item) => item.id === noteId)
      if (note && content !== (note.content || '')) {
        next.add(noteId)
      } else {
        next.delete(noteId)
      }
      return next
    })
  }

  const updateExternalNoteFromMainEditor = (noteId, changes) => {
    if (!noteId) return

    setExternalNotes((current) => current.map((note) => (
      note.id === noteId ? { ...note, ...changes } : note
    )))

    if (Object.prototype.hasOwnProperty.call(changes, 'content')) {
      setExternalNoteDraftContent(changes.content || '')
    }

    setDirtyExternalNoteIds((current) => {
      const next = new Set(current)
      next.add(noteId)
      return next
    })
  }

  const saveExternalNoteContent = async (externalNote, content = externalNoteDraftContent) => {
    if (!externalNote || !window.videoApi?.saveLegacyNoteContent) {
      showAutoMessage('Action message.', 'Message', 1400)
      return false
    }

    const result = await window.videoApi.saveLegacyNoteContent({
      sourceJsonPath: externalNote.sourceJsonPath,
      noteIndex: externalNote.noteIndex,
      matchStart: externalNote.raw?.Start || externalNote.raw?.start || externalNote.start,
      matchEnd: externalNote.raw?.End || externalNote.raw?.end || externalNote.end,
      start: externalNote.start,
      end: externalNote.end,
      content,
    })

    if (!result?.ok) {
      const reason = result?.reason || 'save-legacy-note-failed'
      showAutoMessage('Action message.', 'Message', 1600)
      window.debugApi?.log(`Save legacy video note failed: ${externalNote.sourceJsonPath}#${externalNote.noteIndex} (${reason})`)
      return false
    }

    const savedContent = result.note?.content ?? content
    setExternalNotes((current) => current.map((note) => (
      note.id === externalNote.id
        ? {
            ...note,
            noteIndex: Number.isInteger(result.noteIndex) ? result.noteIndex : note.noteIndex,
            start: result.note?.start || note.start,
            end: result.note?.end || note.end,
            content: savedContent,
            raw: result.note?.raw || note.raw,
          }
        : note
    )))
    setExternalNoteDraftContent(savedContent)
    setDirtyExternalNoteIds((current) => {
      const next = new Set(current)
      next.delete(externalNote.id)
      return next
    })
    showAutoMessage('Action message.', 'Message', 900)
    return true
  }

  const cancelExternalNoteEdit = (externalNote = selectedExternalNote) => {
    if (externalNote) {
      const savedContent = externalNote.raw?.Content ?? externalNote.raw?.content ?? externalNote.content ?? ''
      setExternalNotes((current) => current.map((note) => (
        note.id === externalNote.id ? { ...note, content: savedContent } : note
      )))
      setExternalNoteDraftContent(savedContent)
      setDirtyExternalNoteIds((current) => {
        const next = new Set(current)
        next.delete(externalNote.id)
        return next
      })
    }
    setExpandedExternalNoteId('')
  }

  const confirmExternalNoteDirtyBeforeLeave = async () => {
    if (!selectedExternalNoteDirty || !selectedExternalNote) return true

    const decision = await showActionDialog({
      title: 'Note content changed',
      message: 'The current note content has been modified. Save changes before continuing?',
      actions: [
        { label: 'Save', value: 'save', primary: true },
        { label: 'Discard', value: 'discard' },
        { label: 'Continue Editing', value: 'stay' },
      ],
      defaultValue: 'stay',
      cancelValue: 'stay',
    })

    if (decision === 'save') {
      return saveExternalNoteContent(selectedExternalNote, externalNoteDraftContent)
    }

    if (decision === 'discard') {
      cancelExternalNoteEdit(selectedExternalNote)
      return true
    }

    return false
  }

  const confirmActiveNoteContentBeforeLeave = async () => {
    if (activeNoteSource === 'pool') {
      const canLeave = await confirmExternalNoteDirtyBeforeLeave()
      return { canLeave, defaultContentSynced: false, notesToSave: null }
    }

    if (!selectedNote || noteDraft === (selectedNote.content || '')) {
      return { canLeave: true, defaultContentSynced: false, notesToSave: null }
    }

    const decision = await showActionDialog({
      title: 'Note content changed',
      message: 'The current note content has been modified. Save changes before continuing?',
      actions: [
        { label: 'Save', value: 'save', primary: true },
        { label: 'Discard', value: 'discard' },
        { label: 'Continue Editing', value: 'stay' },
      ],
      defaultValue: 'stay',
      cancelValue: 'stay',
    })

    if (decision === 'save') {
      const notesToSave = notes.map((note) => (
        note.id === selectedNote.id ? { ...note, content: noteDraft } : note
      ))
      updateNote(selectedNote.id, { content: noteDraft })
      setDirty(APP_MODES.VIDEO, true)
      return { canLeave: true, defaultContentSynced: true, notesToSave }
    }

    if (decision === 'discard') {
      setNoteDraft(selectedNote.content || '')
      return { canLeave: true, defaultContentSynced: false, notesToSave: null }
    }

    return { canLeave: false, defaultContentSynced: false, notesToSave: null }
  }

  const selectExternalNote = async (externalNote, { skipLeaveConfirm = false } = {}) => {
    if (!externalNote) return false
    if (activeNoteSource === 'pool' && externalNote.id === selectedExternalNoteId) {
      setExpandedExternalNoteId(externalNote.id)
      return true
    }

    if (activeNoteSource === 'pool' && !skipLeaveConfirm) {
      const canLeave = await confirmExternalNoteDirtyBeforeLeave()
      if (!canLeave) return false
    }

    setSubtitleNotePreviewContent(null)
    setSelectedExternalNoteId(externalNote.id)
    setExpandedExternalNoteId(externalNote.id)
    setExternalNoteDraftContent(externalNote.content || '')
    return true
  }

  const loadExternalNotesFromFiles = async () => {
    if (!window.videoApi?.selectLegacyNoteFiles) {
      showAutoMessage('Action message.', 'Message', 1400)
      return
    }

    const canLeave = await confirmExternalNoteDirtyBeforeLeave()
    if (!canLeave) return

    appendExternalNotes(await window.videoApi.selectLegacyNoteFiles())
  }

  const loadExternalNotesFromFolder = async () => {
    if (!window.videoApi?.selectLegacyNoteFolder) {
      showAutoMessage('Action message.', 'Message', 1400)
      return
    }

    const canLeave = await confirmExternalNoteDirtyBeforeLeave()
    if (!canLeave) return

    appendExternalNotes(await window.videoApi.selectLegacyNoteFolder({
      maxDepth: externalNotesFolderDepth,
    }))
  }

  const clearExternalNotes = async () => {
    const decision = await showActionDialog({
      title: 'Clear Notes',
      message: 'Clear all notes from Notes Pool?',
      defaultValue: 'clear',
      cancelValue: 'cancel',
      actions: [
        { label: 'Clear', value: 'clear', danger: true },
        { label: 'Cancel', value: 'cancel' },
      ],
    })
    if (decision !== 'clear') return

    const canLeave = await confirmExternalNoteDirtyBeforeLeave()
    if (!canLeave) return

    setExternalNotes([])
    setSelectedExternalNoteId('')
    setExpandedExternalNoteId('')
    setExternalNoteDraftContent('')
    setDirtyExternalNoteIds(new Set())
    setExternalNoteLoadedSources([])
    setExternalNoteSources((current) => current
      .map((source) => ({
        ...source,
        selected: false,
        error: '',
      }))
      .sort((left, right) => right.lastUsedAt - left.lastUsedAt)
      .slice(0, MAX_NOTES_POOL_SOURCES))
    setExternalNoteSourcesOpen(false)
  }

  const openExternalNoteTarget = async (externalNote) => {
    if (!externalNote?.sourceVideoPath || !window.videoApi?.getVideoFileInfo) return

    const switchingVideo = !isSameFilePath(externalNote.sourceVideoPath, videoFile?.filePath)
    if (!switchingVideo && activeNoteSource !== 'pool') {
      showAutoMessage('Action message.', 'Message', 1800)
      return
    }

    if (switchingVideo) {
      const canSwitch = await confirmBeforeSwitchVideo()
      if (!canSwitch) return
    } else {
      const leaveResult = await confirmActiveNoteContentBeforeLeave()
      if (!leaveResult.canLeave) return
    }

    const canSelect = await selectExternalNote(externalNote, { skipLeaveConfirm: true })
    if (!canSelect) return

    changeVideoOpenSource('pool')
    setExternalNoteDraftContent(externalNote.content || '')
    setCurStart(externalNote.start || '')
    setCurEnd(externalNote.end || '')

    const startSeconds = parseTime(externalNote.start)
    if (!switchingVideo) {
      showAutoMessage('Action message.', 'Message', 1200)
      if (Number.isFinite(startSeconds)) {
        seekWhenReady(startSeconds)
        setTimeout(() => playFromCurrentPosition(), 160)
      }
      return
    }

    const info = await window.videoApi.getVideoFileInfo(externalNote.sourceVideoPath, {
      extraSubtitleFolder,
      loadDirectoryMp4Files: false,
      loadNotes: false,
    })
    if (!info?.ok) {
      showAutoMessage('Action message.', 'Message', 1400)
      return
    }

    await loadVideoInfo(info, {
      autoplay: true,
      seekTime: Number.isFinite(startSeconds) ? startSeconds : undefined,
      updateDirectoryMp4Files: false,
      videoOpenSource: 'pool',
    })
    changeVideoOpenSource('pool')
    setExternalNoteDraftContent(externalNote.content || '')
    setCurStart(externalNote.start || '')
    setCurEnd(externalNote.end || '')
    showAutoMessage('Action message.', 'Message', 1200)
  }

  const writeVideoClipboardText = async (text, label = 'Copy') => {
    if (!window.videoApi?.writeClipboardText) {
      showAutoMessage('Clipboard write API is unavailable.', label, 1200)
      return false
    }

    try {
      await window.videoApi.writeClipboardText(text)
      showAutoMessage('Copied.', label, 700)
      return true
    } catch {
      showAutoMessage('Copy failed.', label, 1200)
      return false
    }
  }

  const getNoteCopySourceFileName = (note) => {
    if (note?.sourceVideoName) return note.sourceVideoName
    if (note?.sourceVideoPath) return splitPath(note.sourceVideoPath).fileName
    return videoFile?.fileName || ''
  }

  const getContextCopyNote = (note = null) => {
    if (note) return note
    if (contextMenu?.type === 'externalNote') return contextMenu.externalNote
    if (contextMenu?.note) return contextMenu.note
    return selectedNote
  }

  const getContextCopyStart = (note = null) => {
    const resolvedNote = getContextCopyNote(note)
    return resolvedNote?.start || curStart || ''
  }

  const copyContextStart = (note = null) => {
    const start = getContextCopyStart(note)
    if (!start) {
      showAutoMessage('No start time.', 'Copy Start', 900)
      return
    }
    writeVideoClipboardText(`{{ startTime: ${start} }}`, 'Copy Start')
  }

  const copyContextStartAndFile = (note = null) => {
    const resolvedNote = getContextCopyNote(note)
    const start = resolvedNote?.start || curStart || ''
    const fileName = getNoteCopySourceFileName(resolvedNote)
    if (!start) {
      showAutoMessage('No start time.', 'Copy Start+File', 900)
      return
    }
    writeVideoClipboardText(`{{ startTime: ${start} ; fileName: ${fileName} }}`, 'Copy Start+File')
  }
  const openFromClipboard = async () => {
    if (!window.videoApi?.readClipboardText || !window.videoApi?.resolveVideoPath) {
      showAutoMessage('No video file to save.')
      return
    }

    let clipboardText = ''
    try {
      clipboardText = await window.videoApi.readClipboardText()
    } catch {
      showAutoMessage('Action message.', 'Message', 1200)
      return
    }

    const result = await window.videoApi.resolveVideoPath(clipboardText)
    if (!result?.ok) {
      const errorMessage = result?.reason === 'matching-mp4-not-found'
        ? 'Matching MP4 file not found.'
        : result?.reason === 'unsupported-video-source'
          ? 'Only MP4 or JSON files are supported.'
          : 'File not found.'
      showAutoMessage(errorMessage, 'GetClip', 1800)
      return
    }

    openVideoFileFullPath(result.filePath, {
      autoplay: true,
      playbackRate: getPlaybackRate(),
    })
  }

  const syncQuickNoteRangeToInfo = (range) => {
    setSelectedStart(range.start)
    setSelectedEnd(range.end)
    setCurStart(range.start)
    setCurEnd(range.end)
  }

  const addQuickNote = async () => {
    if (!videoFile?.filePath) return

    const range = normalizeRange(buildCaptureRange())
    if (!range) return

    addNote(createQuickNote(range, ''))
    setNotesFilterOn(false)
    syncQuickNoteRangeToInfo(range)
    setDirty(APP_MODES.VIDEO, true)
    showAutoMessage('Action message.', 'Message', 900)
  }

  const appendCurrentMark = () => {
    if (!videoFile?.filePath) return

    const startSeconds = parseTime(curStart)
    const endSeconds = parseTime(curEnd)
    if (!Number.isFinite(startSeconds)) {
      showAutoMessage('Action message.', 'Message', 1200)
      return
    }

    const duration = getDuration()
    const safeStart = Math.max(0, startSeconds)
    let safeEnd = Number.isFinite(endSeconds) ? endSeconds : safeStart + 2
    if (safeEnd < safeStart + 2) safeEnd = safeStart + 2
    if (Number.isFinite(duration)) safeEnd = Math.min(duration, safeEnd)
    if (safeEnd <= safeStart) safeEnd = safeStart + 2

    const note = {
      id: `${videoFile.filePath}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sourceVideoPath: videoFile.filePath,
      sourceVideoName: videoFile.fileName || '',
      start: formatTime(safeStart),
      end: formatTime(safeEnd),
      content: activeNoteDraft || '',
      raw: {},
    }
    addNote(note)
    setNotesFilterOn(false)
    setDirty(APP_MODES.VIDEO, true)
    showAutoMessage('Action message.', 'Message', 900)
  }

  const createQuickNote = (range, content = '') => ({
    id: `${videoFile?.filePath || 'video'}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sourceVideoPath: videoFile?.filePath || '',
    sourceVideoName: videoFile?.fileName || '',
    start: range.start,
    end: range.end,
    content,
    raw: {},
  })

  const insertQuickNoteNearSelected = (position) => {
    if (!selectedNoteId || !videoFile?.filePath) {
      showAutoMessage('Action message.', 'Message', 900)
      return
    }

    const selectedIndex = notes.findIndex((note) => note.id === selectedNoteId)
    if (selectedIndex < 0) {
      showAutoMessage('Action message.', 'Message', 900)
      return
    }

    const range = normalizeRange(buildCaptureRange())
    if (!range) return

    const insertIndex = position === 'before' ? selectedIndex : selectedIndex + 1
    insertNoteAt(insertIndex, createQuickNote(range))
    setNotesFilterOn(false)
    syncQuickNoteRangeToInfo(range)
    setDirty(APP_MODES.VIDEO, true)
    showAutoMessage('Action message.', 'Message', 900)
  }

  const deleteSelectedNote = async () => {
    if (!selectedNoteId) {
      showAutoMessage('Action message.', 'Message', 900)
      return
    }

    const decision = await showActionDialog({
      title: 'Confirm action',
      message: 'Confirm this action?',
      defaultValue: 'delete',
      cancelValue: 'cancel',
      actions: [
        { label: 'Delete', value: 'delete', danger: true },
        { label: 'Cancel', value: 'cancel' },
      ],
    })
    if (decision !== 'delete') return

    deleteNote(selectedNoteId)
    setDirty(APP_MODES.VIDEO, true)
  }

  const clearNotesList = async () => {
    const decision = await showActionDialog({
      title: 'Confirm action',
      message: 'Confirm this action?',
      defaultValue: 'clear',
      cancelValue: 'cancel',
      actions: [
        { label: 'Clear', value: 'clear', danger: true },
        { label: 'Cancel', value: 'cancel' },
      ],
    })
    if (decision !== 'clear') return

    clearNotes()
    setCurStart('')
    setCurEnd('')
    setDirty(APP_MODES.VIDEO, true)
  }
  const quickUpdateSelectedRange = async () => {
    if (activeNoteSource === 'pool') {
      if (!selectedExternalNote) {
        showAutoMessage('Action message.', 'Message', 900)
        return
      }

      const range = normalizeRange(buildCaptureRange())
      if (!range) return

      updateExternalNoteFromMainEditor(selectedExternalNote.id, range)
      setCurStart(range.start)
      setCurEnd(range.end)
      showAutoMessage('Action message.', 'Message', 900)
      return
    }

    if (!selectedNoteId) {
      showAutoMessage('Action message.', 'Message', 900)
      return
    }

    const range = normalizeRange(buildCaptureRange())
    if (!range) return

    updateNote(selectedNoteId, range)
    setSelectedStart(range.start)
    setSelectedEnd(range.end)
    setCurStart(range.start)
    setCurEnd(range.end)
    setDirty(APP_MODES.VIDEO, true)
    showAutoMessage('Action message.', 'Message', 900)
  }
  const writeCurrentRangeToSelected = async () => {
    if (activeNoteSource === 'pool') {
      if (!selectedExternalNote || !curStart || !curEnd) return

      const decision = await showActionDialog({
      title: 'Confirm action',
      message: 'Confirm this action?',
        defaultValue: 'update',
        cancelValue: 'cancel',
        actions: [
          { label: 'Update', value: 'update', primary: true },
          { label: 'Cancel', value: 'cancel' },
        ],
      })
      if (decision !== 'update') return

      const range = normalizeRange({ start: curStart, end: curEnd })
      if (!range) return

      updateExternalNoteFromMainEditor(selectedExternalNote.id, range)
      showAutoMessage('Action message.', 'Message', 900)
      return
    }

    if (!selectedNoteId || !curStart || !curEnd) return

    const decision = await showActionDialog({
      title: 'Confirm action',
      message: 'Confirm this action?',
      defaultValue: 'update',
      cancelValue: 'cancel',
      actions: [
        { label: 'Update', value: 'update', primary: true },
        { label: 'Cancel', value: 'cancel' },
      ],
    })
    if (decision !== 'update') return

    const range = normalizeRange({ start: curStart, end: curEnd })
    if (!range) return

    updateNote(selectedNoteId, range)
    setSelectedStart(range.start)
    setSelectedEnd(range.end)
    setDirty(APP_MODES.VIDEO, true)
  }

  const updateSelectedContent = (content) => {
    if (subtitleNotePreviewContent !== null) {
      setSubtitleNotePreviewContent(content)
      return
    }

    if (activeNoteSource === 'pool' && selectedExternalNote) {
      updateExternalNoteFromMainEditor(selectedExternalNote.id, { content })
      return
    }

    setNoteDraft(content)
  }

  const handleNoteEditorFocus = () => {
    if (activeNoteDraft !== 'None') return
    updateSelectedContent('')
  }

  const handleNoteEditorContextMenu = (event) => {
    event.preventDefault()
    event.stopPropagation()
    keywordInsertion.rememberTarget('noteEditor')
    setKeywordMenu(getContextMenuPosition(event, 1))
  }

  const handleNoteEditorKeyDown = (event) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    event.preventDefault()
    event.stopPropagation()
    const rect = noteEditorRef.current?.getBoundingClientRect()
    keywordInsertion.rememberTarget('noteEditor')
    setKeywordMenu({
      x: Math.max(8, Math.min((rect?.left || 0) + 16, window.innerWidth - CONTEXT_MENU_WIDTH - 8)),
      y: Math.max(8, Math.min((rect?.top || 0) + 16, window.innerHeight - CONTEXT_MENU_ITEM_HEIGHT - 8)),
    })
  }

  const confirmUpdateSelectedContent = async () => {
    if (activeNoteSource === 'pool') {
      if (!selectedExternalNote) {
        showAutoMessage('Action message.', 'Message', 900)
        return
      }

      const decision = await showActionDialog({
      title: 'Confirm action',
      message: 'Confirm this action?',
        defaultValue: 'update',
        cancelValue: 'cancel',
        actions: [
          { label: 'Save', value: 'update', primary: true },
          { label: 'Cancel', value: 'cancel' },
        ],
      })
      if (decision !== 'update') return

      await saveExternalNoteContent(selectedExternalNote, externalNoteDraftContent)
      return
    }

    if (!selectedNoteId) {
      showAutoMessage('Action message.', 'Message', 900)
      return
    }

    const decision = await showActionDialog({
      title: 'Confirm action',
      message: 'Confirm this action?',
      defaultValue: 'update',
      cancelValue: 'cancel',
      actions: [
        { label: 'Update', value: 'update', primary: true },
        { label: 'Cancel', value: 'cancel' },
      ],
    })
    if (decision !== 'update') return

    updateNote(selectedNoteId, { content: noteDraft })
    setDirty(APP_MODES.VIDEO, true)
    showAutoMessage('Action message.', 'Message', 900)
  }

  const openReplaceDialog = (scope) => {
    setReplaceDialog({
      scope,
      findText: '',
      replaceText: '',
      busy: false,
    })
  }

  const updateReplaceDialog = (patch) => {
    setReplaceDialog((current) => (current ? { ...current, ...patch } : current))
  }

  const buildReplacePlan = (rows, findText, replaceText) => rows
    .map(({ note }) => {
      const matchCount = countTextMatches(note.content, findText)
      if (matchCount === 0) return null
      return {
        note,
        matchCount,
        nextContent: replaceAllText(note.content, findText, replaceText),
      }
    })
    .filter(Boolean)

  const confirmReplacePlan = async (plan, replaceText) => {
    const matchCount = plan.reduce((total, item) => total + item.matchCount, 0)
    if (matchCount === 0) {
      showAutoMessage('Action message.', 'Message', 1000)
      return false
    }

    const actionText = replaceText === '' ? 'Delete' : 'Replace'
    const decision = await showActionDialog({
      title: 'Confirm action',
      message: 'Confirm this action?',
      defaultValue: 'replace',
      cancelValue: 'cancel',
      actions: [
        { label: actionText, value: 'replace', primary: true },
        { label: 'Cancel', value: 'cancel' },
      ],
    })

    return decision === 'replace'
  }

  const replaceVisibleNotes = async ({ findText, replaceText }) => {
    const plan = buildReplacePlan(visibleNotes, findText, replaceText)
    const canReplace = await confirmReplacePlan(plan, replaceText)
    if (!canReplace) return

    const replacements = new Map(plan.map((item) => [item.note.id, item.nextContent]))
    setNotes(notes.map((note) => (
      replacements.has(note.id) ? { ...note, content: replacements.get(note.id) } : note
    )))

    if (selectedNoteId && replacements.has(selectedNoteId)) {
      setNoteDraft(replacements.get(selectedNoteId))
    }

    setDirty(APP_MODES.VIDEO, true)
    setReplaceDialog(null)
    showAutoMessage('Action message.', 'Message', 1200)
  }

  const replaceVisibleExternalNotes = async ({ findText, replaceText }) => {
    const plan = buildReplacePlan(visibleExternalNotes, findText, replaceText)
    const canReplace = await confirmReplacePlan(plan, replaceText)
    if (!canReplace) return

    updateReplaceDialog({ busy: true })
    const results = []
    for (const item of plan) {
      const result = await window.videoApi?.saveLegacyNoteContent?.({
        sourceJsonPath: item.note.sourceJsonPath,
        noteIndex: item.note.noteIndex,
        matchStart: item.note.raw?.Start || item.note.raw?.start || item.note.start,
        matchEnd: item.note.raw?.End || item.note.raw?.end || item.note.end,
        start: item.note.start,
        end: item.note.end,
        content: item.nextContent,
      })
      results.push({ ...item, result })
    }
    const successResults = results.filter((item) => item.result?.ok)
    const failedResults = results.filter((item) => !item.result?.ok)
    const savedById = new Map(successResults.map((item) => [
      item.note.id,
      {
        content: item.result.note?.content ?? item.nextContent,
        start: item.result.note?.start || item.note.start,
        end: item.result.note?.end || item.note.end,
        raw: item.result.note?.raw || item.note.raw,
        noteIndex: Number.isInteger(item.result.noteIndex) ? item.result.noteIndex : item.note.noteIndex,
      },
    ]))

    setExternalNotes((current) => current.map((note) => (
      savedById.has(note.id) ? { ...note, ...savedById.get(note.id) } : note
    )))

    if (selectedExternalNoteId && savedById.has(selectedExternalNoteId)) {
      setExternalNoteDraftContent(savedById.get(selectedExternalNoteId).content || '')
    }

    setDirtyExternalNoteIds((current) => {
      const next = new Set(current)
      successResults.forEach((item) => next.delete(item.note.id))
      return next
    })

    if (failedResults.length > 0) {
      window.debugApi?.log(`Notes Pool replace failed: ${failedResults.map((item) => item.note.sourceJsonPath).join('; ')}`)
      updateReplaceDialog({ busy: false })
      showAutoMessage(`Save failed for ${failedResults.length} item(s).`, 'Replace', 1800)
      return
    }

    setReplaceDialog(null)
    showAutoMessage('Action message.', 'Message', 1200)
  }

  const executeReplaceDialog = async () => {
    if (!replaceDialog || replaceDialog.busy) return

    const findText = replaceDialog.findText
    const replaceText = replaceDialog.replaceText
    if (!findText) {
      showAutoMessage('Action message.', 'Message', 1000)
      return
    }

    if (replaceDialog.scope === 'pool') {
      await replaceVisibleExternalNotes({ findText, replaceText })
      return
    }

    await replaceVisibleNotes({ findText, replaceText })
  }

  const speedByStep = (step) => {
    const currentRate = getPlaybackRate()
    const nextRate = Math.max(
      MIN_PLAYBACK_RATE,
      Math.min(MAX_PLAYBACK_RATE, Math.round((currentRate + (step * PLAYBACK_RATE_STEP)) * 100) / 100),
    )

    applyPlaybackRate(nextRate)
  }

  const volumeByStep = (step) => {
    const player = playerRef.current
    if (!player?.volume) return

    const currentVolume = Number(player.volume())
    const baseVolume = Number.isFinite(currentVolume) ? currentVolume : volume
    const nextVolume = Math.max(0, Math.min(1, baseVolume + step))
    player.volume(nextVolume)
    playingViewRef.current = { ...playingViewRef.current, volume: nextVolume }
    setVolume(nextVolume)
  }

  const toggleVolumeLevel = () => {
    const player = playerRef.current
    if (!player?.volume) return

    const currentVolume = Number(player.volume())
    const baseVolume = Number.isFinite(currentVolume) ? currentVolume : volume
    const nextVolume = baseVolume < 0.5
      ? 0.5
      : baseVolume < 1
        ? 1
        : 0

    player.volume(nextVolume)
    playingViewRef.current = { ...playingViewRef.current, volume: nextVolume }
    setVolume(nextVolume)
  }

  const cycleFullscreenPanelState = () => {
    setFullscreenCycleState((state) => (state === 4 ? 0 : 4))
  }

  useEffect(() => {
    if (!titleOn || subtitleDisplayMode !== 'rolling' || !selectedSubtitle) return
    if (fullscreenViewState.hvLayout !== 1 && fullscreenCycleState !== 4) return

    setRollingSubtitleCenterLayoutRequest((value) => value + 1)
  }, [fullscreenViewState.hvLayout, fullscreenCycleState, selectedSubtitle, subtitleDisplayMode, titleOn])

  const toggleFocusBetweenNotesListAndTextInput = () => {
    const focusEditor = () => {
      const editor = noteEditorRef.current
      if (!editor) return

      editor.focus()
      editor.selectionStart = editor.selectionEnd = editor.value.length
    }

    if (document.activeElement === noteEditorRef.current) {
      const notesList = notesListRef.current
      if (!notesList) return
      if (leftTab !== 'notes') setLeftTab('notes')
      setTimeout(() => {
        notesList.focus()
      }, 0)
      return
    }

    if (leftTab !== 'notes') {
      setLeftTab('notes')
      setTimeout(focusEditor, 0)
      return
    }

    focusEditor()
  }

  const handleNotesListKeyDown = async (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Enter') {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    if (event.key === 'Enter') {
      const note = selectedNote || visibleNotes[0]?.note || await selectNoteByIndex(0)
      if (note) {
        await jumpToNote(note)
      }
      return
    }

    if (visibleNotes.length === 0) return

    const currentVisibleIndex = visibleNotes.findIndex(({ note }) => note.id === selectedNoteId)
    const baseIndex = currentVisibleIndex >= 0 ? currentVisibleIndex : 0
    const nextIndex = event.key === 'ArrowUp' ? baseIndex - 1 : baseIndex + 1
    const safeIndex = currentVisibleIndex >= 0
      ? Math.max(0, Math.min(nextIndex, visibleNotes.length - 1))
      : 0
    await selectNote(visibleNotes[safeIndex].note)
  }


  const getContextMenuItemCount = (type) => (
    type === 'subtitleCue' ? 3 : type === 'externalNote' ? 4 : type === 'mp4File' ? 3 : 12
  )

  const openMp4FileContextMenu = (event, filePath, listSource) => {
    event.preventDefault()
    event.stopPropagation()
    const position = getContextMenuPosition(event, getContextMenuItemCount('mp4File'))
    setContextMenu({
      type: 'mp4File',
      filePath,
      listSource,
      x: position.x,
      y: position.y,
    })
  }

  const openContextMenu = async (event, type, note = null) => {
    event.preventDefault()
    event.stopPropagation()

    if (note) {
      const canSelect = await selectNote(note)
      if (!canSelect) return
    }

    const position = getContextMenuPosition(event, getContextMenuItemCount(type))
    setContextMenu({
      type,
      note,
      x: position.x,
      y: position.y,
    })
  }

  const openExternalNoteContextMenu = (event, externalNote) => {
    event.preventDefault()
    event.stopPropagation()

    const position = getContextMenuPosition(event, getContextMenuItemCount('externalNote'))
    selectExternalNote(externalNote).then((canOpen) => {
      if (!canOpen) return
      setContextMenu({
        type: 'externalNote',
        externalNote,
        x: position.x,
        y: position.y,
      })
    })
  }

  const openSubtitleCueContextMenu = (event, cue, options = {}) => {
    event.preventDefault()
    event.stopPropagation()

    const position = getContextMenuPosition(event, getContextMenuItemCount('subtitleCue'))
    setContextMenu({
      type: 'subtitleCue',
      cue,
      subtitleInteractionMode: options.subtitleInteractionMode || 'follow',
      playerPaused: playerRef.current?.paused?.() !== false,
      x: position.x,
      y: position.y,
    })
  }

  const moveSelectedNote = (direction) => {
    if (!selectedNoteId) {
      showAutoMessage('Action message.', 'Message', 900)
      return
    }

    const currentIndex = notes.findIndex((note) => note.id === selectedNoteId)
    if (
      currentIndex < 0
      || (direction === 'up' && currentIndex === 0)
      || (direction === 'down' && currentIndex === notes.length - 1)
    ) {
      return
    }

    moveNote(selectedNoteId, direction)
    setDirty(APP_MODES.VIDEO, true)
  }

  const locateNoteByPlaybackTime = async () => {
    const playbackTime = Number(getPlayerTime())
    if (!Number.isFinite(playbackTime)) {
      showAutoMessage('No matching note.', 'Locate Note', 1400)
      return
    }

    const candidates = notes
      .map((note, index) => {
        const noteTime = parseTime(note.start)
        if (!Number.isFinite(noteTime)) return null
        const delta = noteTime - playbackTime
        const distance = Math.abs(delta)
        const inRange = delta === 0
          || (delta < 0 && distance <= locateNotePastLimitSec)
          || (delta > 0 && distance <= locateNoteFutureLimitSec)
        return inRange ? { note, index, delta, distance } : null
      })
      .filter(Boolean)
      .sort((left, right) => (
        (left.distance - right.distance)
        || (Number(left.delta > 0) - Number(right.delta > 0))
        || (left.index - right.index)
      ))

    const target = candidates[0]?.note
    if (!target) {
      showAutoMessage('No matching note.', 'Locate Note', 1400)
      return
    }

    const canSelect = await selectNote(target)
    if (!canSelect) return
    setNotesFilterOn(false)
    setLeftTab('notes')
    scrollSelectedNoteIntoView()
  }

  const runContextMenuAction = (handler) => {
    setContextMenu(null)
    setTimeout(() => {
      handler()
    }, 0)
  }

  const getContextMenuItems = () => {
    if (contextMenu?.type === 'mp4File') {
      const targetPath = contextMenu.filePath
      return [
        { label: 'Copy Filename', action: () => copyMp4FileName(targetPath) },
        { label: 'Open Folder', action: () => openMp4Folder(targetPath) },
        {
          label: 'Rename',
          disabled: isSameFilePath(targetPath, videoFile?.filePath),
          action: () => renameMp4File(targetPath),
        },
      ]
    }

    if (contextMenu?.type === 'subtitleCue') {
      return [
        {
          label: 'Edit Sub',
          disabled: !subtitleCapabilities.canEditSubtitle,
          action: () => editSubtitleCue(contextMenu.cue),
        },
        {
          label: 'Speak Sub',
          disabled: !subtitleCapabilities.canSpeakSubtitle || !contextMenu.playerPaused,
          action: () => speakSubtitleCue(contextMenu.cue),
        },
        {
          label: subtitleInteractionModeRef.current === 'reading' ? 'Out of Reading' : 'Into Reading',
          disabled: !subtitleCapabilities.canToggleReading,
          action: toggleSubtitleReading,
        },
      ]
    }

    if (contextMenu?.type === 'externalNote') {
      const externalNote = contextMenu.externalNote
      return [
        { label: 'Go To', action: () => openExternalNoteTarget(externalNote) },
        { label: 'Copy Start', action: () => copyContextStart(externalNote), separator: true },
        { label: 'Copy Start+File', action: () => copyContextStartAndFile(externalNote) },
        { label: 'Close Menu', action: () => {}, separator: true },
      ]
    }

    const menuNote = contextMenu?.note || selectedNote
    const noteItems = [
      { label: 'Insert Quick After', action: () => insertQuickNoteNearSelected('after') },
      { label: 'Insert Quick Before', action: () => insertQuickNoteNearSelected('before') },
      { label: 'Append Mark', action: () => runAction('video.appendMark') },
      { label: 'Append Quick Mark', action: () => runAction('video.appendQuickMark') },
      { label: 'Quick Update Range', action: quickUpdateSelectedRange, separator: true },
      { label: 'Copy Start', action: () => copyContextStart(menuNote), separator: true },
      { label: 'Copy Start+File', action: () => copyContextStartAndFile(menuNote) },
      { label: 'Move Up', action: () => moveSelectedNote('up') },
      { label: 'Move Down', action: () => moveSelectedNote('down') },
      { label: 'Delete Selected', action: deleteSelectedNote, separator: true },
    ]

    if (contextMenu?.type === 'video') {
      return [
        ...noteItems,
        { label: 'Locate Note', action: locateNoteByPlaybackTime },
        { label: 'Close Menu', action: () => {}, separator: true },
      ]
    }

    return [
      ...noteItems,
      { label: 'Clear Notes List', action: clearNotesList },
      { label: 'Close Menu', action: () => {}, separator: true },
    ]
  }

  const requestPickRollingSubtitle = () => {
    if (!canPickRollingSubtitle) return
    setRollingSubtitlePickRequest((value) => value + 1)
  }

  useEffect(() => registerActions([
    {
      id: 'video.seekStart',
      label: 'Seek Start',
      scope: APP_MODES.VIDEO,
      handler: seekToCurrentStart,
    },
    {
      id: 'video.jumpBack',
      label: 'Jump Back',
      scope: APP_MODES.VIDEO,
      handler: () => seekByScaledSeconds(-SHORT_JUMP_SECONDS),
    },
    {
      id: 'video.setStart',
      label: 'Set Start',
      scope: APP_MODES.VIDEO,
      handler: () => setCurStart(formatTime(getPlayerTime())),
    },
    {
      id: 'video.setEnd',
      label: 'Set End',
      scope: APP_MODES.VIDEO,
      handler: () => setCurEnd(formatTime(getPlayerTime())),
    },
    {
      id: 'video.jumpForward',
      label: 'Jump Forward',
      scope: APP_MODES.VIDEO,
      handler: () => seekByScaledSeconds(SHORT_JUMP_SECONDS),
    },
    {
      id: 'video.intoEditingFocus',
      label: 'Into Editing Focus',
      scope: APP_MODES.VIDEO,
      handler: toggleFocusBetweenNotesListAndTextInput,
    },
    {
      id: 'video.appendMark',
      label: 'Append Mark',
      scope: APP_MODES.VIDEO,
      handler: appendCurrentMark,
    },
    {
      id: 'video.togglePlay',
      label: 'Play / Pause',
      scope: APP_MODES.VIDEO,
      handler: togglePlayPause,
    },
    {
      id: 'video.togglePlayAlt',
      label: 'Play / Pause Alt',
      scope: APP_MODES.VIDEO,
      handler: togglePlayPause,
    },
    {
      id: 'video.toggleControlMode',
      label: 'Toggle Control Mode',
      scope: APP_MODES.VIDEO,
      handler: () => setVideoControlMode((value) => !value),
    },
    {
      id: 'video.toggleControlModeChord',
      label: 'Toggle Control Mode',
      scope: APP_MODES.VIDEO,
      handler: () => setVideoControlMode((value) => !value),
    },
    {
      id: 'video.toggleSubtitleHidden',
      label: 'Hide Subs',
      scope: APP_MODES.VIDEO,
      handler: toggleCurrentSubtitleHidden,
    },
    {
      id: 'video.toggleVideoViewHidden',
      label: 'Hide View',
      scope: APP_MODES.VIDEO,
      handler: toggleCurrentVideoHidden,
    },
    {
      id: 'video.toggleHvLayout',
      label: 'HV Layout',
      scope: APP_MODES.VIDEO,
      handler: toggleCurrentHvLayout,
    },
    {
      id: 'video.saveNotes',
      label: 'Save Notes',
      scope: APP_MODES.VIDEO,
      handler: saveVideoNotes,
    },
    {
      id: 'video.saveNotesAlt',
      label: 'Save Notes Alt',
      scope: APP_MODES.VIDEO,
      handler: saveVideoNotes,
    },
    {
      id: 'video.jumpBackShort',
      label: 'Short Back',
      scope: APP_MODES.VIDEO,
      handler: () => seekByScaledSeconds(-SHORT_JUMP_SECONDS),
    },
    {
      id: 'video.jumpForwardShort',
      label: 'Short Forward',
      scope: APP_MODES.VIDEO,
      handler: () => seekByScaledSeconds(SHORT_JUMP_SECONDS),
    },
    {
      id: 'video.jumpBackLong',
      label: 'Long Back',
      scope: APP_MODES.VIDEO,
      handler: () => seekByScaledSeconds(-LONG_JUMP_SECONDS),
    },
    {
      id: 'video.jumpForwardLong',
      label: 'Long Forward',
      scope: APP_MODES.VIDEO,
      handler: () => seekByScaledSeconds(LONG_JUMP_SECONDS),
    },
    {
      id: 'video.speedUp',
      label: 'Speed Up',
      scope: APP_MODES.VIDEO,
      handler: () => speedByStep(1),
    },
    {
      id: 'video.speedDown',
      label: 'Speed Down',
      scope: APP_MODES.VIDEO,
      handler: () => speedByStep(-1),
    },
    {
      id: 'video.volumeUp',
      label: 'Volume Up',
      scope: APP_MODES.VIDEO,
      handler: () => volumeByStep(VOLUME_STEP),
    },
    {
      id: 'video.volumeDown',
      label: 'Volume Down',
      scope: APP_MODES.VIDEO,
      handler: () => volumeByStep(-VOLUME_STEP),
    },
    {
      id: 'video.rollingFontSizeUp',
      label: 'Rolling Font Size Up',
      scope: APP_MODES.VIDEO,
      handler: () => changeRollingSubtitleFontSize(1),
    },
    {
      id: 'video.rollingFontSizeDown',
      label: 'Rolling Font Size Down',
      scope: APP_MODES.VIDEO,
      handler: () => changeRollingSubtitleFontSize(-1),
    },
    {
      id: 'video.videoOpacityDown',
      label: 'Video Opacity Down',
      scope: APP_MODES.VIDEO,
      handler: () => changeCurrentVideoOpacity(-1),
    },
    {
      id: 'video.videoOpacityUp',
      label: 'Video Opacity Up',
      scope: APP_MODES.VIDEO,
      handler: () => changeCurrentVideoOpacity(1),
    },
    {
      id: 'video.toggleView',
      label: 'Toggle View',
      scope: APP_MODES.VIDEO,
      handler: cycleFullscreenPanelState,
    },
    {
      id: 'video.toggleVolume',
      label: 'Toggle Vol',
      scope: APP_MODES.VIDEO,
      handler: toggleVolumeLevel,
    },
    {
      id: 'video.pickSub',
      label: 'Pick Sub',
      scope: APP_MODES.VIDEO,
      handler: requestPickRollingSubtitle,
    },
    {
      id: 'video.toggleLeftTab',
      label: 'Toggle Left Tab',
      scope: APP_MODES.VIDEO,
      handler: () => setLeftTab((tab) => (tab === 'notes' ? 'files' : 'notes')),
    },
    {
      id: 'video.updateContent',
      label: 'Update Content',
      scope: APP_MODES.VIDEO,
      handler: confirmUpdateSelectedContent,
    },
    {
      id: 'video.appendQuickMark',
      label: 'Append Quick Mark',
      scope: APP_MODES.VIDEO,
      handler: addQuickNote,
    },
    {
      id: 'video.insertQuickBefore',
      label: 'Insert Quick Before',
      scope: APP_MODES.VIDEO,
      handler: () => insertQuickNoteNearSelected('before'),
    },
    {
      id: 'video.insertQuickAfter',
      label: 'Insert Quick After',
      scope: APP_MODES.VIDEO,
      handler: () => insertQuickNoteNearSelected('after'),
    },
    {
      id: 'video.quickUpdateRange',
      label: 'Quick Update Range',
      scope: APP_MODES.VIDEO,
      handler: quickUpdateSelectedRange,
    },
    {
      id: 'video.writeCurrentRange',
      label: 'Write Current Range',
      scope: APP_MODES.VIDEO,
      handler: writeCurrentRangeToSelected,
    },
  ]), [
    addQuickNote,
    appendCurrentMark,
    changeCurrentVideoOpacity,
    changeRollingSubtitleFontSize,
    confirmUpdateSelectedContent,
    cycleFullscreenPanelState,
    insertQuickNoteNearSelected,
    seekToCurrentStart,
    seekByScaledSeconds,
    saveVideoNotes,
    setCurEnd,
    setCurStart,
    speedByStep,
    togglePlayPause,
    toggleFocusBetweenNotesListAndTextInput,
    toggleCurrentHvLayout,
    toggleCurrentSubtitleHidden,
    toggleCurrentVideoHidden,
    toggleVolumeLevel,
    requestPickRollingSubtitle,
    quickUpdateSelectedRange,
    volumeByStep,
    writeCurrentRangeToSelected,
  ])

  const handlePlayerPlaybackRateChange = (nextRate) => {
    const normalizedRate = normalizePlayingView({
      ...playingViewRef.current,
      playbackRate: nextRate,
    }).playbackRate
    playingViewRef.current = { ...playingViewRef.current, playbackRate: normalizedRate }
    setPlaybackRate(normalizedRate)
  }

  const handlePlayerVolumeChange = (nextVolume) => {
    const normalizedVolume = normalizePlayingView({
      ...playingViewRef.current,
      volume: nextVolume,
    }).volume
    playingViewRef.current = { ...playingViewRef.current, volume: normalizedVolume }
    setVolume(normalizedVolume)
  }

  const onPlayerReady = (player) => {
    playerRef.current = player
    applyPlayingView()
    refreshVideoDurationText()
    player.on('loadedmetadata', refreshVideoDurationText)
    player.on('durationchange', refreshVideoDurationText)
    player.on('play', () => {
      if (subtitleInteractionModeRef.current !== 'reading' || speakSubtitlePreviewRef.current) return
      player.pause?.()
      showAutoMessage('Exit Sub Reading before playback.', 'Subtitle Reading', 1400)
    })
  }

  const onTimeUpdate = (currentTime) => {
    setCurrentPlaybackTime(currentTime)
    setPlayingTime(formatTime(currentTime))
    refreshVideoDurationText()
  }

  const jumpToSubtitleCue = (cue) => {
    if (!cue || !Number.isFinite(cue.start)) return
    playerRef.current?.currentTime?.(cue.start)
  }

  const handleSubtitleReadingScrollStart = () => {
    if (subtitleInteractionModeRef.current !== 'reading') return
    stopSpeakSubtitlePreview()
    playerRef.current?.pause?.()
  }

  const handleSubtitleReadingAnchorChange = ({ cue, cueIndex } = {}) => {
    if (subtitleInteractionModeRef.current !== 'reading' || !readingSessionRef.current) return
    const cueStart = Number(cue?.start)
    if (!Number.isFinite(cueStart)) return
    readingSessionRef.current = {
      ...readingSessionRef.current,
      cueIndex: Number.isInteger(Number(cueIndex)) ? Number(cueIndex) : -1,
      cueStart,
    }
  }

  const handleSubtitleReadingViewportChange = (status) => {
    if (!status) {
      setSubtitleReadingStatus(null)
      return
    }
    if (subtitleInteractionModeRef.current !== 'reading') return

    setSubtitleReadingStatus({
      total: Number(status.total) || 0,
      startIndex: Number(status.startIndex) || 0,
      endIndex: Number(status.endIndex) || 0,
    })
    const focusTime = Number(status.focusCue?.start)
    if (!Number.isFinite(focusTime)) return
    playerRef.current?.pause?.()
    playerRef.current?.currentTime?.(focusTime)
    setCurrentPlaybackTime(focusTime)
    setPlayingTime(formatTime(focusTime))
  }

  const buildSelectedSubtitlePlainText = (cues = []) => {
    const sortedCues = [...cues].sort((left, right) => left.start - right.start)
    return sortedCues.map((cue) => String(cue.text || '').trim()).filter(Boolean).join('\n')
  }

  const buildSelectedSubtitleNoteContent = (cues = []) => {
    const plainText = buildSelectedSubtitlePlainText(cues)
    return plainText ? `AUTO:\n${plainText}` : ''
  }

  const previewSelectedSubtitleNote = (cues = []) => {
    if (!Array.isArray(cues) || cues.length === 0) {
      setSubtitleNotePreviewContent(null)
      return
    }
    const content = buildSelectedSubtitleNoteContent(cues)
    setSubtitleNotePreviewContent(content)
  }

  const addSelectedSubtitleNote = async (cues = [], contentOverride = null) => {
    if (!videoFile?.filePath) return false
    if (!Array.isArray(cues) || cues.length === 0) return false

    const sortedCues = [...cues].sort((left, right) => left.start - right.start)
    const firstCue = sortedCues[0]
    const lastCue = sortedCues[sortedCues.length - 1]
    const content = contentOverride ?? subtitleNotePreviewContent ?? buildSelectedSubtitleNoteContent(sortedCues)
    const range = normalizeRange({
      start: formatTime(firstCue.start),
      end: formatTime(lastCue.end),
    })
    if (!range) return false

    const note = {
      id: `${videoFile.filePath}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sourceVideoPath: videoFile.filePath,
      sourceVideoName: videoFile.fileName || '',
      start: range.start,
      end: range.end,
      content,
      raw: {
        createdBy: 'rolling-subtitles',
      },
    }

    changeVideoOpenSource('default')
    addNote(note)
    setSubtitleNotePreviewContent(null)
    setNotesFilterOn(false)
    setCurStart(range.start)
    setCurEnd(range.end)
    setDirty(APP_MODES.VIDEO, true)
    showAutoMessage('Action message.', 'Message', 900)
    return true
  }


  const showSubtitlePickDialog = (initialText, options = {}) => new Promise((resolve) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current)
      toastTimerRef.current = null
    }
    clearSubtitlePickChord()

    const shortcutPrefix = String(options.shortcutPrefix || '').trim()
    const shortcutChordActive = Boolean(shortcutPrefix)
    const readingMode = options.readingMode === true
    const chordActions = readingMode ? SUBTITLE_READING_CHORD_ACTIONS : SUBTITLE_PICK_CHORD_ACTIONS

    dialogResolveRef.current = resolve
    setDialog({
      kind: 'subtitlePick',
      title: readingMode ? 'Pick Subtitles Reading' : 'Pick Subtitles',
      subtitleText: initialText,
      defaultValue: 'save',
      cancelValue: 'cancel',
      shortcutChordActive,
      shortcutPrefix,
      actions: [
        { label: readingMode ? 'Copy&Save' : 'Copy&Save&Exit', value: 'copySave', shortcut: shortcutChordActive ? 'Z' : '', primary: true },
        { label: readingMode ? 'Copy' : 'Copy&Exit', value: 'copy', shortcut: shortcutChordActive ? 'X' : '' },
        { label: readingMode ? 'Save' : 'Save&Exit', value: 'save', shortcut: shortcutChordActive ? 'C' : '' },
        { label: 'Cancel', value: 'cancel', shortcut: shortcutChordActive ? 'V' : '' },
        { label: 'Go Back', value: 'goBack', shortcut: '' },
      ],
    })

    if (shortcutChordActive) {
      window.dispatchEvent(new CustomEvent('shortcut-chord-change', {
        detail: {
          shortcut: shortcutPrefix,
          options: chordActions.map(({ actionId, key, label }) => ({ actionId, key, label })),
        },
      }))
      subtitlePickChordTimerRef.current = setTimeout(() => {
        subtitlePickChordTimerRef.current = null
        window.dispatchEvent(new CustomEvent('shortcut-chord-change', { detail: null }))
        setDialog((current) => current?.kind === 'subtitlePick'
          ? { ...current, shortcutChordActive: false }
          : current)
      }, segmentedShortcutWaitMs)
    }
  })

  const showSubtitleEditDialog = (initialText) => new Promise((resolve) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current)
      toastTimerRef.current = null
    }

    dialogResolveRef.current = resolve
    setDialog({
      kind: 'subtitleEdit',
      title: 'Edit Subtitle',
      subtitleText: initialText,
      cancelValue: 'cancel',
      actions: [
        { label: 'Save', value: 'save', primary: true },
        { label: 'Cancel', value: 'cancel' },
      ],
    })
  })

  const editSubtitleCue = async (cue) => {
    const subtitlePath = String(selectedSubtitle?.filePath || '')
    if (!subtitlePath.toLowerCase().endsWith('.vtt')) {
      showAutoMessage('Only VTT subtitles can be edited.', 'Edit Subtitle', 1800)
      return
    }
    if (!window.videoApi?.updateVttCueText) {
      showAutoMessage('Subtitle editing is unavailable.', 'Edit Subtitle', 1800)
      return
    }

    const dialogResult = await showSubtitleEditDialog(cue?.text || '')
    if (dialogResult?.decision !== 'save') return

    const nextText = String(dialogResult.text || '').replace(/[\r\n]+/g, ' ').trim()
    if (!nextText) {
      showAutoMessage('Subtitle text cannot be empty.', 'Edit Subtitle', 1800)
      return
    }

    const result = await window.videoApi.updateVttCueText({
      filePath: subtitlePath,
      sourceRefs: cue?.sourceRefs || [],
      text: nextText,
    })
    if (!result?.ok) {
      const errorMessage = result?.reason === 'vtt-only'
        ? 'Only VTT subtitles can be edited.'
        : result?.reason === 'subtitle-file-changed'
          ? 'Subtitle file changed. Reload it before editing.'
          : result?.reason === 'invalid-subtitle-text'
            ? 'Subtitle text is invalid.'
            : 'Subtitle update failed.'
      showAutoMessage(errorMessage, 'Edit Subtitle', 2200)
      return
    }

    const updatedLineIndexes = new Set((result.sourceRefs || []).map((sourceRef) => sourceRef.lineIndex))
    setRollingSubtitleCues((current) => current.map((currentCue) => (
      currentCue.id === cue.id
        ? {
          ...currentCue,
          text: result.text,
          sourceRefs: (currentCue.sourceRefs || []).map((sourceRef) => (
            updatedLineIndexes.has(sourceRef.lineIndex)
              ? { ...sourceRef, sourceText: result.text }
              : sourceRef
          )),
        }
        : currentCue
    )))
    showAutoMessage('Subtitle updated.', 'Edit Subtitle', 1000)
  }

  const stopSpeakSubtitlePreview = () => {
    stopSpeakSubtitleRef.current?.()
  }

  const speakSubtitleCue = (cue) => {
    const player = playerRef.current
    if (!player || player.paused?.() === false || !subtitleCapabilities.canSpeakSubtitle) return
    if (!Number.isFinite(cue?.start) || !Number.isFinite(cue?.end)) return

    stopSpeakSubtitlePreview()
    const duration = getDuration()
    const startTime = Math.max(0, cue.start - SUBTITLE_SPEAK_PADDING_SECONDS)
    const endTime = Math.min(duration, Math.max(startTime, cue.end + SUBTITLE_SPEAK_PADDING_SECONDS))
    let timeoutId = 0

    const finishPreview = () => {
      if (stopSpeakSubtitleRef.current !== finishPreview) return
      stopSpeakSubtitleRef.current = null
      window.clearTimeout(timeoutId)
      player.off?.('timeupdate', handlePreviewTimeUpdate)
      player.off?.('ended', finishPreview)
      player.pause?.()
      if (Number.isFinite(endTime)) player.currentTime?.(endTime)
      speakSubtitlePreviewRef.current = false
    }
    const handlePreviewTimeUpdate = () => {
      if (Number(player.currentTime?.()) >= endTime) finishPreview()
    }

    stopSpeakSubtitleRef.current = finishPreview
    speakSubtitlePreviewRef.current = true
    player.currentTime?.(startTime)
    player.on?.('timeupdate', handlePreviewTimeUpdate)
    player.on?.('ended', finishPreview)

    const playbackRate = Math.max(0.1, Number(player.playbackRate?.()) || 1)
    timeoutId = window.setTimeout(
      finishPreview,
      Math.max(1200, (((endTime - startTime) / playbackRate) * 1000) + 1500),
    )
    if (!requestVideoPlay({ source: 'speak-sub' })) finishPreview()
  }

  const confirmPickedSubtitleNote = async (cues = [], options = {}) => {
    if (!Array.isArray(cues) || cues.length === 0) return 'done'

    const sortedCues = [...cues].sort((left, right) => left.start - right.start)
    const initialText = buildSelectedSubtitlePlainText(sortedCues)
    if (!initialText) return 'done'

    const pickSubShortcut = settings.shortcuts?.[APP_MODES.VIDEO]?.['video.pickSub'] || ''
    const result = await showSubtitlePickDialog(initialText, {
      shortcutPrefix: options.fromShortcut ? pickSubShortcut : '',
      readingMode: options.readingMode === true,
    })
    const decision = result?.decision || result || 'cancel'
    const text = String(result?.text ?? initialText).trim()

    if (decision === 'goBack') return 'goBack'

    if (decision === 'copy' || decision === 'copySave') {
      if (text) await writeVideoClipboardText(text, 'Pick Sub')
      if (decision === 'copy') {
        setSubtitleNotePreviewContent(null)
        return options.readingMode ? 'reading-clear' : 'done'
      }
    }

    if (decision === 'save' || decision === 'copySave') {
      if (!text) return 'goBack'
      const saved = await addSelectedSubtitleNote(sortedCues, `AUTO:\n${text}`)
      return saved === false ? 'goBack' : options.readingMode ? 'reading-clear' : 'done'
    }

    setSubtitleNotePreviewContent(null)
    return options.readingMode ? 'reading-clear' : 'done'
  }

  const changeSubtitleDisplayMode = async (event) => {
    const nextMode = event.target.value === 'rolling' ? 'rolling' : 'native'
    try {
      await saveSettings({
        ...settings,
        general: {
          ...settings.general,
          subtitleDisplayMode: nextMode,
        },
      })
    } catch (error) {
      showAutoMessage('Action message.', 'Message', 1800)
      window.debugApi?.log(`Subtitle display mode save failed: ${error.message || String(error)}`)
    }
  }

  const changeNoteItemFontSize = async (settingKey, currentFontSize, step) => {
    const nextFontSize = Math.max(
      MIN_NOTE_ITEM_FONT_SIZE,
      Math.min(MAX_NOTE_ITEM_FONT_SIZE, Math.round(Number(currentFontSize) || 11) + step)
    )
    if (nextFontSize === currentFontSize) return

    try {
      await saveSettings({
        ...settings,
        general: {
          ...settings.general,
          [settingKey]: nextFontSize,
        },
      })
    } catch (error) {
      showAutoMessage('Action message.', 'Message', 1400)
      window.debugApi?.log(`Note item font size save failed: ${error.message || String(error)}`)
    }
  }

  const requestRollingSubtitleLayout = () => {
    setRollingSubtitleCenterLayoutRequest((value) => value + 1)
  }


  const startVideoLayoutResize = (event, type) => {
    event.preventDefault()
    event.stopPropagation()

    const startX = event.clientX
    const startY = event.clientY
    const startLeftWidth = videoLeftWidth
    const startRightWidth = videoRightWidth
    const startStageRatio = videoStageRatio
    const startSubtitleCenterSideRatio = subtitleCenterSideRatio
    const bodyBounds = event.currentTarget.closest('.video-body')?.getBoundingClientRect()
    const centerBounds = event.currentTarget.closest('.video-center')?.getBoundingClientRect()

    const handlePointerMove = (moveEvent) => {
      if (type === 'left') {
        const availablePanelWidth = Math.max(
          0,
          (bodyBounds?.width || 0) - (VIDEO_VERTICAL_SPLITTER_WIDTH * 2)
        )
        const maximumLeftWidth = Math.max(0, availablePanelWidth - startRightWidth)
        const nextWidth = Math.max(
          0,
          Math.min(maximumLeftWidth, startLeftWidth + moveEvent.clientX - startX)
        )
        setVideoLeftWidth(nextWidth)
        return
      }

      if (type === 'right') {
        const availablePanelWidth = Math.max(
          0,
          (bodyBounds?.width || 0) - (VIDEO_VERTICAL_SPLITTER_WIDTH * 2)
        )
        const maximumRightWidth = Math.max(0, availablePanelWidth - startLeftWidth)
        const nextWidth = Math.max(
          0,
          Math.min(maximumRightWidth, startRightWidth - (moveEvent.clientX - startX))
        )
        setVideoRightWidth(nextWidth)
        return
      }

      if (type === 'center' && fullscreenViewState.hvLayout === 1 && centerBounds?.width) {
        const startRightWidthPx = centerBounds.width * startSubtitleCenterSideRatio
        const nextRightWidth = startRightWidthPx - (moveEvent.clientX - startX)
        const nextRatio = nextRightWidth / centerBounds.width
        setSubtitleCenterSideRatio(Math.max(1 / 6, Math.min(0.5, nextRatio)))
        window.requestAnimationFrame(requestRollingSubtitleLayout)
        return
      }

      if (type === 'center' && centerBounds?.height) {
        const nextStageHeight = (centerBounds.height * startStageRatio) + moveEvent.clientY - startY
        const nextRatio = nextStageHeight / centerBounds.height
        setVideoStageRatio(Math.max(0.45, Math.min(0.88, nextRatio)))
      }
    }

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }

  const startVideoBottomResize = (event) => {
    event.preventDefault()
    event.stopPropagation()

    const startX = event.clientX
    const startY = event.clientY
    const startSideWidth = videoBottomSideWidth
    const startInfoHeight = subtitleCenterInfoHeight

    const handlePointerMove = (moveEvent) => {
      if (fullscreenViewState.hvLayout === 1) {
        const nextHeight = startInfoHeight - (moveEvent.clientY - startY)
        setSubtitleCenterInfoHeight(Math.max(132, Math.min(320, nextHeight)))
        return
      }

      const nextWidth = startSideWidth - (moveEvent.clientX - startX)
      setVideoBottomSideWidth(Math.max(260, Math.min(560, nextWidth)))
    }

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }

  const startMp4FilesResize = (event) => {
    event.preventDefault()
    event.stopPropagation()

    const recentSection = event.currentTarget.previousElementSibling
    const directorySection = event.currentTarget.nextElementSibling
    const startRecentHeight = recentSection?.getBoundingClientRect().height || 0
    const startDirectoryHeight = directorySection?.getBoundingClientRect().height || 0
    const availableHeight = startRecentHeight + startDirectoryHeight
    const startY = event.clientY
    if (availableHeight <= 0) return

    const minimumRecentHeight = Math.min(48, availableHeight)
    const minimumDirectoryHeight = Math.min(80, Math.max(0, availableHeight - minimumRecentHeight))

    const handlePointerMove = (moveEvent) => {
      const maximumRecentHeight = Math.max(minimumRecentHeight, availableHeight - minimumDirectoryHeight)
      const nextRecentHeight = Math.max(
        minimumRecentHeight,
        Math.min(maximumRecentHeight, startRecentHeight + moveEvent.clientY - startY)
      )
      setMp4RecentSectionRatio(nextRecentHeight / availableHeight)
    }

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }

  const fullscreenClass = `fullscreen-state-${fullscreenCycleState}`
  const controlModeClass = videoControlMode ? 'video-control-mode' : ''
  const videoViewHiddenClass = fullscreenViewState.hideView ? 'video-view-hidden' : 'video-view-visible'
  const subtitleCenterLayoutClass = `subtitle-center-layout-${fullscreenViewState.hvLayout}`
  const subtitleReadingClass = subtitleInteractionMode === 'reading' ? 'subtitle-reading-mode' : ''
  const rollingSubtitleFontSizeKey = fullscreenCycleState === 4
    ? 'subtitleCenter'
    : fullscreenCycleState === 3
      ? 'overlay'
      : 'normal'
  const nativeSubtitle = titleOn && subtitleDisplayMode === 'native' ? selectedSubtitle : null

  return (
    <section
      className={`video-mode ${fullscreenClass} ${controlModeClass} ${videoViewHiddenClass} ${subtitleCenterLayoutClass} ${subtitleReadingClass}`}
      style={{
        '--video-left-panel-width': `${videoLeftWidth}px`,
        '--video-right-panel-width': `${videoRightWidth}px`,
        '--video-stage-height': `${Math.round(videoStageRatio * 1000) / 10}%`,
        '--video-subtitle-center-blur': `${subtitleCenterViewBlurPx}px`,
        '--video-subtitle-center-dim': videoViewDim,
        '--video-view-opacity': fullscreenViewState.videoOpacity,
        '--video-subtitle-center-layout-right-width': `${Math.round(subtitleCenterSideRatio * 1000) / 10}%`,
        '--video-bottom-side-width': `${videoBottomSideWidth}px`,
        '--video-subtitle-center-layout-info-height': `${subtitleCenterInfoHeight}px`,
      }}
    >
      <div className="video-body">
        <aside className="video-left-panel">
        <div className="left-tabs">
          <button
            className={leftTab === 'notes' ? 'left-tab active' : 'left-tab'}
            onClick={() => setLeftTab('notes')}
            type="button"
          >
            Notes
          </button>
          <button
            className={leftTab === 'files' ? 'left-tab active' : 'left-tab'}
            onClick={() => setLeftTab('files')}
            type="button"
          >
            MP4 Files
          </button>
        </div>
        {leftTab === 'notes' ? (
          <div className="notes-panel">
            <div className="notes-tools">
              <div className="notes-actions-row">
                <div className="notes-action-group">
                  <button
                    className="notes-replace-button"
                    data-tooltip="Replace"
                    onClick={() => openReplaceDialog('notes')}
                    title="Replace"
                    type="button"
                  >
                    <i className="fa-solid fa-arrows-rotate" aria-hidden="true" />
                  </button>
                </div>
                <div className="notes-action-group notes-action-group-spaced">
                  <button
                    className="notes-icon-button"
                    data-tooltip="Save filter"
                    disabled={!notesFilterText.trim()}
                    onClick={() => saveFilterCondition('notes')}
                    type="button"
                  >
                    <i className="fa-solid fa-floppy-disk" aria-hidden="true" />
                  </button>
                  <button
                    className="notes-icon-button"
                    data-tooltip="Clear filter"
                    disabled={!notesFilterText}
                    onClick={() => setNotesFilterText('')}
                    type="button"
                  >
                    <i className="fa-solid fa-eraser" aria-hidden="true" />
                  </button>
                </div>
                <div className="notes-action-group notes-move-action-group">
                  <button
                    className="notes-icon-button"
                    data-tooltip="Move note up"
                    disabled={selectedNoteIndex <= 0}
                    onClick={() => moveSelectedNote('up')}
                    type="button"
                  >
                    <i className="fa-solid fa-arrow-up" aria-hidden="true" />
                  </button>
                  <button
                    className="notes-icon-button"
                    data-tooltip="Move note down"
                    disabled={selectedNoteIndex < 0 || selectedNoteIndex >= notes.length - 1}
                    onClick={() => moveSelectedNote('down')}
                    type="button"
                  >
                    <i className="fa-solid fa-arrow-down" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="notes-options-row">
                <div className="note-font-tools" aria-label="Note item font size">
                  <button
                    data-tooltip="Smaller note item font"
                    onClick={() => changeNoteItemFontSize('videoNotesFontSize', videoNotesFontSize, -1)}
                    type="button"
                  >
                    -
                  </button>
                  <span>{videoNotesFontSize}px</span>
                  <button
                    data-tooltip="Larger note item font"
                    onClick={() => changeNoteItemFontSize('videoNotesFontSize', videoNotesFontSize, 1)}
                    type="button"
                  >
                    +
                  </button>
                </div>
                <div className="notes-pool-checks">
                  <label className="notes-compact-check">
                    <input
                      checked={notesFilterOn}
                      onChange={(event) => setNotesFilterOn(event.target.checked)}
                      type="checkbox"
                    />
                    <span>ON</span>
                  </label>
                  <label className="notes-compact-check">
                    <input
                      checked={notesReverse}
                      onChange={(event) => setNotesReverse(event.target.checked)}
                      type="checkbox"
                    />
                    <span>Rev</span>
                  </label>
                </div>
              </div>
              <FilterHistoryInput
                error={notesFilterOn ? notesFilterExpression.error : ''}
                history={notesFilterHistory}
                onChange={setNotesFilterText}
                onDelete={(value) => deleteFilterCondition('notes', value)}
                title={notesFilterExpression.error || 'Supports &&, ||, !, ()'}
                value={notesFilterText}
              />
            </div>
            <div
              className="notes-list"
              style={{ '--video-note-item-font-size': `${videoNotesFontSize}px` }}
              onContextMenu={(event) => openContextMenu(event, 'notes')}
              onKeyDown={handleNotesListKeyDown}
              ref={notesListRef}
              tabIndex={0}
            >
              {notes.length === 0 ? (
                <div className="empty-list">No video notes</div>
              ) : visibleNotes.length === 0 ? (
                <div className="empty-list">No visible notes</div>
              ) : (
                visibleNotes.map(({ note, index }) => {
                  const startSeconds = parseTime(note.start)
                  const endSeconds = parseTime(note.end)
                  const duration = Number.isFinite(startSeconds) && Number.isFinite(endSeconds)
                    ? endSeconds - startSeconds
                    : Number.NaN
                  return (
                    <button
                      className={note.id === selectedNoteId ? 'note-row active' : 'note-row'}
                      key={note.id}
                      onClick={() => selectNote(note)}
                      onContextMenu={(event) => openContextMenu(event, 'notes', note)}
                      onDoubleClick={() => jumpToNote(note)}
                      type="button"
                    >
                      <span className="note-row-index">{index + 1}</span>
                      <span>{note.start}</span>
                      <span className="note-row-duration">{formatDuration(duration)}</span>
                      <span className="note-row-content">{note.content}</span>
                    </button>
                  )
                })
              )}
            </div>
            <div className="notes-statusbar">
              <span>Total {notes.length}</span>
              <span>Visible {visibleNotes.length}</span>
              <span>At {selectedNoteIndex >= 0 ? selectedNoteIndex + 1 : '-'}</span>
            </div>
          </div>
        ) : (
          <div
            className="files-list"
            style={{
              gridTemplateRows: `auto minmax(48px, ${mp4RecentSectionRatio}fr) 6px minmax(80px, ${1 - mp4RecentSectionRatio}fr)`,
            }}
          >
            <label className="recent-folder-picker">
              <span>Recent folders</span>
              <select defaultValue="" onChange={(event) => loadVideoFolderPath(event.target.value)}>
                <option value="" disabled>Choose folder</option>
                {recentVideoFolders.map((folderPath) => (
                  <option key={folderPath} value={folderPath}>{folderPath}</option>
                ))}
              </select>
            </label>
            <div className="list-section recent-section">
              <div className="list-title">recent MP4 files</div>
              <div className="list-scroll-body">
                {recentVideoFiles.length === 0 ? (
                  <div className="empty-list">No recent MP4 files</div>
                ) : (
                  recentVideoFiles.map((filePath) => {
                    const { fileName } = splitPath(filePath)
                    return (
                      <button
                        className={filePath === videoFile?.filePath ? 'mp4-list-row recent active' : 'mp4-list-row recent'}
                        key={filePath}
                        onContextMenu={(event) => openMp4FileContextMenu(event, filePath, 'recent')}
                        onDoubleClick={() => openRecentVideoFile(filePath)}
                        title={filePath}
                        type="button"
                      >
                        {fileName}
                      </button>
                    )
                  })
                )}
              </div>
            </div>
            <div
              aria-label="Resize recent and folder MP4 file lists"
              className="mp4-files-splitter"
              onPointerDown={startMp4FilesResize}
              role="separator"
            />
            <div className="list-section directory-section">
              <label className="folder-title-field">
                <span>folder:</span>
                <input readOnly title={directoryFolderPath} value={directoryFolderPath} />
              </label>
              <div className="mp4-sort-bar" aria-label="MP4 file sorting">
                <label>
                  <span>Sort</span>
                  <select
                    onChange={(event) => setMp4SortKey(event.target.value)}
                    value={mp4SortKey}
                  >
                    {MP4_SORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <button
                  aria-label={mp4SortDirection === 'asc' ? 'Ascending' : 'Descending'}
                  className="mp4-sort-direction"
                  data-tooltip={mp4SortDirection === 'asc' ? 'Ascending' : 'Descending'}
                  onClick={() => setMp4SortDirection((value) => (value === 'asc' ? 'desc' : 'asc'))}
                  type="button"
                >
                  <i
                    className={mp4SortDirection === 'asc'
                      ? 'fa-solid fa-arrow-up-a-z'
                      : 'fa-solid fa-arrow-down-z-a'}
                    aria-hidden="true"
                  />
                </button>
              </div>
              <div className="mp4-directory-status" aria-label="Current folder file counts">
                <span>MP4: {directoryMp4Files.length}</span>
                <span>JSON: {directoryJsonFileCount}</span>
              </div>
              <div
                className="list-scroll-body"
                onKeyDown={handleDirectoryMp4KeyDown}
                ref={directoryListRef}
                tabIndex={0}
              >
                {sortedDirectoryMp4Files.length === 0 ? (
                  <div className="empty-list">No MP4 files loaded</div>
                ) : (
                  sortedDirectoryMp4Files.map((entry) => (
                    <button
                      className={entry.fileName === selectedDirectoryMp4Name ? 'mp4-list-row active' : 'mp4-list-row'}
                      key={entry.fileName}
                      onClick={() => setSelectedDirectoryMp4Name(entry.fileName)}
                      onContextMenu={(event) => {
                        setSelectedDirectoryMp4Name(entry.fileName)
                        openMp4FileContextMenu(
                          event,
                          joinPath(directoryFolderPath, entry.fileName),
                          'directory',
                        )
                      }}
                      onDoubleClick={() => openVideoFilePath(entry.fileName)}
                      title={entry.fileName}
                      type="button"
                    >
                      {entry.fileName}
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
        </aside>

        <div
          className="video-vertical-splitter"
          onPointerDown={(event) => startVideoLayoutResize(event, 'left')}
          role="separator"
          aria-label="Resize left video panel"
        />

        <section className="video-center">
        <div
          className="video-stage"
          onContextMenu={(event) => openContextMenu(event, 'video')}
          ref={videoStageRef}
        >
          <VideoPlayer
            onEnded={playNextDirectoryVideo}
            onPlaybackRateChange={handlePlayerPlaybackRateChange}
            onReady={onPlayerReady}
            onTimeUpdate={onTimeUpdate}
            onVolumeChange={handlePlayerVolumeChange}
            playbackRate={playbackRate}
            subtitle={nativeSubtitle}
            subtitleEnabled={Boolean(nativeSubtitle)}
            src={videoFile?.fileUrl}
            volume={volume}
          />
          {!videoFile?.filePath ? (
            <div className="video-nothing-loaded">Nothing loaded</div>
          ) : null}
          {videoFile?.filePath && fullscreenViewState.hideView && fullscreenCycleState !== 4 ? (
            <div className="video-hidden-seek">
              <input
                aria-label="Seek video"
                disabled={videoDurationSeconds <= 0}
                max={Math.max(videoDurationSeconds, 0.1)}
                min="0"
                onChange={handleHiddenVideoSeek}
                onPointerDown={(event) => event.stopPropagation()}
                step="0.01"
                title={`${formatTime(currentPlaybackTime)} / ${videoDurationText}`}
                type="range"
                value={Math.min(currentPlaybackTime, Math.max(videoDurationSeconds, 0))}
              />
            </div>
          ) : null}
          {videoFile?.filePath && titleOn && subtitleDisplayMode === 'rolling' ? (
            <RollingSubtitlePanel
              bottomPanelRef={videoBottomPanelRef}
              containerRef={videoStageRef}
              cues={rollingSubtitleCues}
              currentTime={currentPlaybackTime}
              subtitleCenterModeActive={fullscreenCycleState === 4}
              subtitleCenterLayout={fullscreenViewState.hvLayout}
              subtitleCenterLayoutRequest={rollingSubtitleCenterLayoutRequest}
              subtitleCenterViewDim={videoViewDim}
              enableSubtitleCenterLayout
              hvLayout={fullscreenViewState.hvLayout}
              subtitleHidden={fullscreenViewState.hideSub}
              videoViewHidden={fullscreenViewState.hideView}
              enableSubtitleNoteAdding
              pickSubAutoSelectCurrent={pickSubAutoSelectCurrent}
              subtitleInteractionMode={subtitleInteractionMode}
              readingStartCueIndex={readingSessionRef.current?.cueIndex ?? -1}
              panelViewKey={rollingPanelViewKey}
              panelViewState={currentRollingPanelView}
              defaultFontSize={rollingSubtitleFontSize}
              fontSizeKey={rollingSubtitleFontSizeKey}
              getCurrentTime={() => playerRef.current?.currentTime?.()}
              onAddSelectedSubtitles={addSelectedSubtitleNote}
              onPickSelectedSubtitles={confirmPickedSubtitleNote}
              pickSubRequest={rollingSubtitlePickRequest}
              onToggleHvLayout={() => runAction('video.toggleHvLayout')}
              onToggleSubtitleHidden={() => runAction('video.toggleSubtitleHidden')}
              onToggleVideoViewHidden={() => runAction('video.toggleVideoViewHidden')}
              onSelectedSubtitlesChange={previewSelectedSubtitleNote}
              onCueClick={jumpToSubtitleCue}
              onCueContextMenu={openSubtitleCueContextMenu}
              onInteractionModeChange={changeSubtitleInteractionMode}
              onPanelViewStateChange={updateCurrentRollingPanelView}
              onReadingAnchorChange={handleSubtitleReadingAnchorChange}
              onReadingScrollStart={handleSubtitleReadingScrollStart}
              onReadingViewportChange={handleSubtitleReadingViewportChange}
              fontSizeStepRequest={rollingSubtitleFontStepRequest}
            />
          ) : null}
          {titleOn && subtitleDisplayMode === 'rolling' && rollingSubtitleError ? (
            <div className="rolling-subtitle-error">Rolling subtitle: {rollingSubtitleError}</div>
          ) : null}
        </div>

        <div
          className="video-horizontal-splitter"
          onPointerDown={(event) => startVideoLayoutResize(event, 'center')}
          role="separator"
          aria-label="Resize video bottom panel"
        />

        <div className="video-bottom-panel" ref={videoBottomPanelRef}>
          {fullscreenCycleState === 4 && fullscreenViewState.hvLayout !== 1 ? (
            <div className="video-hidden-seek video-fullscreen-seek video-stacked-seek">
              <input
                aria-label="Seek video"
                disabled={videoDurationSeconds <= 0}
                max={Math.max(videoDurationSeconds, 0.1)}
                min="0"
                onChange={handleHiddenVideoSeek}
                onPointerDown={(event) => event.stopPropagation()}
                step="0.01"
                title={`${formatTime(currentPlaybackTime)} / ${videoDurationText}`}
                type="range"
                value={Math.min(currentPlaybackTime, Math.max(videoDurationSeconds, 0))}
              />
            </div>
          ) : null}
          <textarea
            className="note-editor"
            onContextMenu={handleNoteEditorContextMenu}
            onChange={(event) => updateSelectedContent(event.target.value)}
            onFocus={handleNoteEditorFocus}
            onKeyDown={handleNoteEditorKeyDown}
            placeholder="Note content"
            ref={noteEditorRef}
            value={activeNoteDraft}
          />
          <div
            className="video-bottom-inner-splitter"
            onPointerDown={startVideoBottomResize}
            role="separator"
            aria-label="Resize note content and video info"
          />
          <div className="video-side-panel">
            <div className="video-info">
              <div className="info-pair">
                <div>
                  <span>start</span>
                  <strong>{activeNoteStart || '--:--:--.-'}</strong>
                </div>
                <div>
                  <span>end</span>
                  <strong>{activeNoteEnd || '--:--:--.-'}</strong>
                </div>
              </div>
              <div className="info-pair">
                <div>
                  <span>curStart</span>
                  <strong>{curStart || '--:--:--.-'}</strong>
                </div>
                <div>
                  <span>curEnd</span>
                  <strong>{curEnd || '--:--:--.-'}</strong>
                </div>
              </div>
              <div>
                <span>playing</span>
                <strong className="playing-time">{playingTime}</strong>
              </div>
              <div>
                <span>Length</span>
                <strong>{videoDurationText}</strong>
              </div>
              <div>
                <span>speed</span>
                <strong>{playbackRate}x</strong>
              </div>
              <div>
                <span>Vol</span>
                <strong>{Math.round(volume * 100)}%</strong>
              </div>
              <div>
                <span>Opacity</span>
                <strong>{Number(fullscreenViewState.videoOpacity).toFixed(1)}</strong>
              </div>
              <div className="rolling-font-info">
                <span>Rolling Font</span>
                <strong>{currentRollingFontSize}px</strong>
              </div>
              <div className="info-file video-source-file">
                <strong title={videoFile?.filePath || videoFile?.fileName || ''}>
                  <em className={videoOpenSource === 'pool' ? 'video-file-source pool' : 'video-file-source default'}>
                    {videoOpenSource === 'pool' ? '[Pool]' : '[Default]'}
                  </em>
                  <b className="video-file-name">{videoFile?.fileName || '--'}</b>
                </strong>
              </div>
            </div>
            <div className="video-mini-controls" aria-label="Video controls">
              <button
                data-tooltip={!videoFile?.filePath
                  ? 'No video loaded'
                  : subtitleCapabilities.canManualPlay ? 'Play / Pause' : 'Exit Sub Reading before playback'}
                disabled={!subtitleCapabilities.canManualPlay && playerRef.current?.paused?.() !== false}
                onClick={() => runAction('video.togglePlay')}
                type="button"
              >
                <i className={`fa-solid ${playerRef.current?.paused?.() === false ? 'fa-pause' : 'fa-play'}`} aria-hidden="true" />
              </button>
              <button data-tooltip="Long Back" onClick={() => runAction('video.jumpBackLong')} type="button">
                <i className="fa-solid fa-backward-fast" aria-hidden="true" />
              </button>
              <button data-tooltip="Short Back" onClick={() => runAction('video.jumpBackShort')} type="button">
                <i className="fa-solid fa-backward-step" aria-hidden="true" />
              </button>
              <button data-tooltip="Short Forward" onClick={() => runAction('video.jumpForwardShort')} type="button">
                <i className="fa-solid fa-forward-step" aria-hidden="true" />
              </button>
              <button data-tooltip="Long Forward" onClick={() => runAction('video.jumpForwardLong')} type="button">
                <i className="fa-solid fa-forward-fast" aria-hidden="true" />
              </button>
              <button data-tooltip="Speed Down" onClick={() => runAction('video.speedDown')} type="button">
                <i className="fa-solid fa-minus" aria-hidden="true" />
              </button>
              <button data-tooltip="Speed Up" onClick={() => runAction('video.speedUp')} type="button">
                <i className="fa-solid fa-plus" aria-hidden="true" />
              </button>
              <button data-tooltip="Volume Down" onClick={() => runAction('video.volumeDown')} type="button">
                <i className="fa-solid fa-volume-low" aria-hidden="true" />
              </button>
              <button data-tooltip="Volume Up" onClick={() => runAction('video.volumeUp')} type="button">
                <i className="fa-solid fa-volume-high" aria-hidden="true" />
              </button>
              <button data-tooltip="Toggle Vol" onClick={() => runAction('video.toggleVolume')} type="button">
                <i className="fa-solid fa-volume-xmark" aria-hidden="true" />
              </button>
              <button data-tooltip="Toggle View" onClick={() => runAction('video.toggleView')} type="button">
                <i className="fa-solid fa-table-columns" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
        </section>

        <div
          className="video-vertical-splitter"
          onPointerDown={(event) => startVideoLayoutResize(event, 'right')}
          role="separator"
          aria-label="Resize right video panel"
        />

        <aside className="video-toolbar">
          <div className="video-toolbar-tabs">
            <button
              className={rightToolTab === 'main' ? 'active' : ''}
              onClick={() => setRightToolTab('main')}
              type="button"
            >
              Main
            </button>
            <button
              className={rightToolTab === 'notesPool' ? 'active' : ''}
              onClick={() => setRightToolTab('notesPool')}
              type="button"
            >
              Notes Pool
            </button>
          </div>

          {rightToolTab === 'main' ? (
            <div className="video-toolbar-page main-page">
              <button type="button" onClick={openVideoFile}>Open</button>
              <button disabled={!videoFile?.filePath} type="button" onClick={closeCurrentVideo}>Close</button>
              <button type="button" onClick={saveVideoNotes}>Save</button>
              <button type="button" onClick={addQuickNote}>QuickNote</button>
              <button type="button" onClick={() => setRepeat(!repeat)}>Repeat</button>
              <button type="button" onClick={() => runAction('video.quickUpdateRange')}>QuickUpdate</button>
              <button type="button" onClick={openFromClipboard}>GetClip</button>
              <label className={videoControlMode ? 'toolbar-check video-toolbar-check control-on-check' : 'toolbar-check video-toolbar-check'}>
                <input
                  checked={videoControlMode}
                  onChange={() => runAction('video.toggleControlMode')}
                  type="checkbox"
                />
                <span>ControlOn</span>
              </label>
              <label className="toolbar-check video-toolbar-check">
                <input
                  checked={playAll}
                  onChange={(event) => setPlayAll(event.target.checked)}
                  type="checkbox"
                />
                <span>PlayAll</span>
              </label>
              <label className="toolbar-check video-toolbar-check">
                <input
                  checked={titleOn}
                  onChange={handleSubtitleToggle}
                  type="checkbox"
                />
                <span>Subtitle</span>
              </label>
            </div>
          ) : (
            <div className="video-toolbar-page notes-pool-page">
              <div className="notes-pool-source-actions">
                <div className="notes-action-group">
                  <button data-tooltip="From Folder" type="button" onClick={loadExternalNotesFromFolder}>
                    <i className="fa-solid fa-folder-open" aria-hidden="true" />
                  </button>
                  <button data-tooltip="From File" type="button" onClick={loadExternalNotesFromFiles}>
                    <i className="fa-solid fa-file-import" aria-hidden="true" />
                  </button>
                  <button
                    data-tooltip="Clear notes"
                    disabled={externalNotes.length === 0 && externalNoteLoadedSources.length === 0 && selectedExternalNoteSources.length === 0}
                    onClick={clearExternalNotes}
                    type="button"
                  >
                    <i className="fa-solid fa-trash" aria-hidden="true" />
                  </button>
                  <button
                    data-tooltip="Reload selected sources"
                    disabled={selectedExternalNoteSources.length === 0 || externalNotesReloading}
                    onClick={reloadExternalNoteSources}
                    type="button"
                  >
                    <i className="fa-solid fa-rotate-right" aria-hidden="true" />
                  </button>
                </div>
                <div className="notes-action-group notes-action-group-spaced">
                  <button
                    className="notes-replace-button"
                    data-tooltip="Replace"
                    onClick={() => openReplaceDialog('pool')}
                    title="Replace"
                    type="button"
                  >
                    <i className="fa-solid fa-arrows-rotate" aria-hidden="true" />
                  </button>
                </div>
                <div className="notes-action-group notes-action-group-spaced">
                  <button
                    className="notes-icon-button"
                    data-tooltip="Save filter"
                    disabled={!externalNotesFilterText.trim()}
                    onClick={() => saveFilterCondition('pool')}
                    type="button"
                  >
                    <i className="fa-solid fa-floppy-disk" aria-hidden="true" />
                  </button>
                  <button
                    className="notes-icon-button"
                    data-tooltip="Clear filter"
                    disabled={!externalNotesFilterText}
                    onClick={() => setExternalNotesFilterText('')}
                    type="button"
                  >
                    <i className="fa-solid fa-eraser" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="notes-pool-options-row">
                <label
                  data-tooltip="JSON subfolder search depth (0 = selected folder only)"
                  title="JSON subfolder search depth (0 = selected folder only)"
                >
                  <span>Depth</span>
                  <select
                    aria-label="Notes Pool subfolder search depth"
                    onChange={(event) => setExternalNotesFolderDepth(Number(event.target.value))}
                    value={externalNotesFolderDepth}
                  >
                    {Array.from({ length: MAX_NOTES_POOL_FOLDER_DEPTH + 1 }, (_, depth) => (
                      <option key={depth} value={depth}>{depth}</option>
                    ))}
                  </select>
                </label>
                <span className="notes-pool-source-state">
                  {externalNoteSourceLoadFailures.length > 0
                    ? `Reload failed (${externalNoteSourceLoadFailures.length})`
                    : externalNoteSourcesNeedReload ? 'Reload required' : ''}
                </span>
                <button
                  aria-expanded={externalNoteSourcesOpen}
                  aria-label="Show Notes Pool sources"
                  className="notes-pool-source-list-button"
                  data-tooltip="Current and recent sources"
                  onClick={toggleExternalNoteSourcesMenu}
                  ref={notesPoolSourceButtonRef}
                  type="button"
                >
                  <i className="fa-solid fa-list-check" aria-hidden="true" />
                </button>
              </div>
              <div className="notes-pool-tools">
                <div className="note-font-tools" aria-label="Notes Pool item font size">
                  <button
                    data-tooltip="Smaller note item font"
                    onClick={() => changeNoteItemFontSize('videoNotesPoolFontSize', videoNotesPoolFontSize, -1)}
                    type="button"
                  >
                    -
                  </button>
                  <span>{videoNotesPoolFontSize}px</span>
                  <button
                    data-tooltip="Larger note item font"
                    onClick={() => changeNoteItemFontSize('videoNotesPoolFontSize', videoNotesPoolFontSize, 1)}
                    type="button"
                  >
                    +
                  </button>
                </div>
                <div className="notes-pool-checks">
                  <label className="notes-compact-check">
                    <input
                      checked={externalNotesFilterOn}
                      onChange={(event) => setExternalNotesFilterOn(event.target.checked)}
                      type="checkbox"
                    />
                    <span>ON</span>
                  </label>
                  <label className="notes-compact-check">
                    <input
                      checked={externalNotesReverse}
                      onChange={(event) => setExternalNotesReverse(event.target.checked)}
                      type="checkbox"
                    />
                    <span>Rev</span>
                  </label>
                  <label className="notes-compact-check">
                    <input
                      checked={externalNotesShowFileName}
                      onChange={(event) => setExternalNotesShowFileName(event.target.checked)}
                      type="checkbox"
                    />
                    <span>FileName</span>
                  </label>
                </div>
                <FilterHistoryInput
                  className="notes-pool-filter-history"
                  error={externalNotesFilterOn ? externalNotesFilterExpression.error : ''}
                  history={externalNotesFilterHistory}
                  onChange={setExternalNotesFilterText}
                  onDelete={(value) => deleteFilterCondition('pool', value)}
                  title={externalNotesFilterExpression.error || 'Supports &&, ||, !, ()'}
                  value={externalNotesFilterText}
                />
                <div
                  className="notes-pool-selected-file"
                  title={selectedExternalNote?.sourceJsonPath || ''}
                >
                  {selectedExternalNote?.sourceJsonName || '-'}
                </div>
              </div>
              <div
                className="notes-pool-list"
                ref={notesPoolListRef}
                style={{ '--video-note-item-font-size': `${videoNotesPoolFontSize}px` }}
              >
                {externalNotes.length === 0 ? (
                  <div className="empty-list">No notes loaded</div>
                ) : visibleExternalNotes.length === 0 ? (
                  <div className="empty-list">No visible notes</div>
                ) : (
                  visibleExternalNotes.map(({ note, index }) => (
                    <div
                      className={note.id === selectedExternalNoteId ? 'notes-pool-row active' : 'notes-pool-row'}
                      key={note.id}
                      onClick={() => { selectExternalNote(note) }}
                      onContextMenu={(event) => openExternalNoteContextMenu(event, note)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          selectExternalNote(note)
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      title={note.sourceJsonPath}
                    >
                      <span className="notes-pool-row-main">
                        <span className="note-row-index">{index + 1}</span>
                        <span>{note.start}</span>
                        <span className="note-row-duration">{formatDuration(getNoteDuration(note))}</span>
                        {expandedExternalNoteId === note.id ? (
                          <span
                            className="notes-pool-row-main-actions"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {dirtyExternalNoteIds.has(note.id) ? (
                              <span className="notes-pool-row-dirty">Unsaved</span>
                            ) : null}
                            <button
                              aria-label={dirtyExternalNoteIds.has(note.id) ? 'Save content' : 'Saved'}
                              className="notes-pool-editor-icon-button"
                              data-tooltip={dirtyExternalNoteIds.has(note.id) ? 'Save content' : 'Saved'}
                              disabled={!dirtyExternalNoteIds.has(note.id)}
                              onClick={() => saveExternalNoteContent(note, externalNoteDraftContent)}
                              type="button"
                            >
                              <i className="fa-solid fa-floppy-disk" aria-hidden="true" />
                            </button>
                            <button
                              aria-label="Cancel changes"
                              className="notes-pool-editor-icon-button"
                              data-tooltip="Cancel changes"
                              onClick={() => cancelExternalNoteEdit(note)}
                              type="button"
                            >
                              <i className="fa-solid fa-xmark" aria-hidden="true" />
                            </button>
                          </span>
                        ) : (
                          <span className="note-row-content-inline">{note.content}</span>
                        )}
                      </span>
                      {externalNotesShowFileName ? (
                        <span className="notes-pool-row-file">{note.sourceVideoName}</span>
                      ) : null}
                      {expandedExternalNoteId === note.id ? (
                        <div className="notes-pool-row-editor" onClick={(event) => event.stopPropagation()}>
                          <textarea
                            onChange={(event) => {
                              updateExternalNoteDraftContent(note.id, event.target.value)
                              window.requestAnimationFrame(resizeExternalNoteEditor)
                            }}
                            onKeyDown={(event) => event.stopPropagation()}
                            ref={externalNoteEditorRef}
                            value={note.id === selectedExternalNoteId ? externalNoteDraftContent : note.content || ''}
                          />
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
              <div className="notes-pool-statusbar">
                <span>Files {externalNoteFileCount}</span>
                <span>Total {externalNotes.length}</span>
                <span>Visible {visibleExternalNotes.length}</span>
                <span>At {selectedExternalNoteIndex >= 0 ? selectedExternalNoteIndex + 1 : '-'}</span>
              </div>
            </div>
          )}
        </aside>
      </div>

      {fullscreenCycleState === 4 && fullscreenViewState.hvLayout === 1 ? (
        <div className="video-hidden-seek video-fullscreen-seek video-side-by-side-seek">
          <input
            aria-label="Seek video"
            disabled={videoDurationSeconds <= 0}
            max={Math.max(videoDurationSeconds, 0.1)}
            min="0"
            onChange={handleHiddenVideoSeek}
            onPointerDown={(event) => event.stopPropagation()}
            step="0.01"
            title={`${formatTime(currentPlaybackTime)} / ${videoDurationText}`}
            type="range"
            value={Math.min(currentPlaybackTime, Math.max(videoDurationSeconds, 0))}
          />
        </div>
      ) : null}

      <footer className="video-statusbar">
        <span>Status: <strong className={dirty ? 'status-unsaved' : ''}>{dirty ? 'Unsaved' : 'Saved'}</strong></span>
        <span>Control: <strong className={videoControlMode ? 'control-on' : ''}>{videoControlMode ? 'ON' : 'OFF'}</strong></span>
        <span>Mode: <strong className={repeat ? 'repeat-mode' : ''}>{repeat ? 'repeat' : 'normal'}</strong></span>
        <div
          className="video-subtitle-language subtitle-language-picker"
          onClick={(event) => event.stopPropagation()}
        >
          <span>Subtitle:</span>
          <button
            className="subtitle-language-trigger"
            disabled={subtitleLanguages.length === 0}
            onClick={() => setSubtitleMenuOpen((open) => !open)}
            type="button"
          >
            <span>{subtitleLanguages.length === 0 ? 'None' : selectedSubtitleLabel}</span>
            <i className="fa-solid fa-caret-up" aria-hidden="true" />
          </button>
          {subtitleMenuOpen && subtitleLanguages.length > 0 ? (
            <div className="subtitle-language-menu">
              {subtitleLanguages.map((entry) => {
                const languageKey = getSubtitleLanguageKey(entry.language)
                const subtitlePath = entry.subtitle?.filePath || entry.srtSubtitle?.filePath || ''
                return (
                  <div
                    className={languageKey === selectedSubtitleLanguageKey ? 'subtitle-language-row active' : 'subtitle-language-row'}
                    key={languageKey}
                  >
                    <button
                      className="subtitle-language-option"
                      onClick={() => selectSubtitleLanguage(languageKey)}
                      title={subtitlePath}
                      type="button"
                    >
                      {entry.label || entry.language || 'Default'}
                    </button>
                    <button
                      className="subtitle-language-open"
                      data-tooltip="Open subtitle file"
                      disabled={!subtitlePath}
                      onClick={() => openSubtitleExternal(entry)}
                      title={subtitlePath || 'No subtitle file'}
                      type="button"
                    >
                      <i className="fa-solid fa-pen-to-square" aria-hidden="true" />
                    </button>
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
        <label className="video-subtitle-language">
          <span>View:</span>
          <select
            onChange={changeSubtitleDisplayMode}
            value={subtitleDisplayMode}
          >
            <option value="native">Native</option>
            <option value="rolling">Rolling</option>
          </select>
        </label>
        {subtitleInteractionMode === 'reading' ? (
          <span>
            Sub-Mode: <strong className="subtitle-reading-status">Reading</strong>
            {' | '}Total: {subtitleReadingStatus?.total || rollingSubtitleCues.length}
            {' | '}Showing: {subtitleReadingStatus?.startIndex || '-'}–{subtitleReadingStatus?.endIndex || '-'}
          </span>
        ) : null}
      </footer>

      {dialog && !dialog.autoClose ? (
        <div className={dialog.nonModal ? 'inline-dialog-layer non-modal' : 'inline-dialog-mask'}>
          <div className={[
            'inline-dialog',
            ['subtitlePick', 'subtitleEdit'].includes(dialog.kind) ? 'subtitle-pick-dialog' : '',
            dialog.kind === 'videoRename' ? 'video-rename-dialog video-rename-editor-dialog' : '',
            dialog.kind === 'videoRenameConfirm' ? 'video-rename-dialog video-rename-confirm-dialog' : '',
          ].filter(Boolean).join(' ')}>
            <div className="inline-dialog-title">{dialog.title}</div>
            {dialog.kind === 'videoRename' ? (
              <div className="video-rename-fields">
                <label className="replace-field">
                  <span>Old filename</span>
                  <textarea
                    className="video-rename-filename"
                    readOnly
                    rows="2"
                    spellCheck="false"
                    value={dialog.originalFileName || ''}
                    wrap="soft"
                  />
                </label>
                <label className="replace-field">
                  <span>New filename</span>
                  <textarea
                    autoFocus
                    className="video-rename-filename"
                    onChange={(event) => setDialog((current) => {
                      const fileName = event.target.value.replace(/[\r\n]+/g, '')
                      const suffixState = getRenameSuffixState(fileName)
                      return {
                        ...current,
                        fileName,
                        jidChecked: suffixState.hasJid,
                        jomChecked: suffixState.hasJom,
                        jidGenerated: false,
                      }
                    })}
                    onKeyDown={(event) => event.stopPropagation()}
                    rows="2"
                    spellCheck="false"
                    value={dialog.fileName || ''}
                    wrap="soft"
                  />
                </label>
              </div>
            ) : dialog.kind === 'videoRenameConfirm' ? (
              <div className="video-rename-confirm">
                <p>Rename this file and its related files?</p>
                <div>
                  <span>Old</span>
                  <strong title={dialog.originalFileName || ''}>{dialog.originalFileName || ''}</strong>
                </div>
                <div>
                  <span>New</span>
                  <strong title={dialog.fileName || ''}>{dialog.fileName || ''}</strong>
                </div>
              </div>
            ) : ['subtitlePick', 'subtitleEdit'].includes(dialog.kind) ? (
              <label className="subtitle-pick-editor">
                <span>{dialog.kind === 'subtitleEdit' ? 'Subtitle text' : 'Selected subtitles'}</span>
                <textarea
                  autoFocus
                  onChange={(event) => setDialog((current) => ({ ...current, subtitleText: event.target.value }))}
                  onKeyDown={(event) => event.stopPropagation()}
                  value={dialog.subtitleText || ''}
                />
              </label>
            ) : dialog.subtitleCandidates ? (
              <div className="subtitle-choice-list">
                {dialog.subtitleCandidates.map((subtitle) => (
                  <button
                    key={subtitle.filePath}
                    onClick={() => closeDialog(subtitle.filePath)}
                    title={subtitle.filePath}
                    type="button"
                  >
                    <span>{subtitle.label}</span>
                    <strong>{subtitle.fileName}</strong>
                  </button>
                ))}
              </div>
            ) : (
              <div className="inline-dialog-message">{dialog.message}</div>
            )}
            <div className={dialog.kind === 'videoRename'
              ? 'inline-dialog-actions video-rename-footer'
              : 'inline-dialog-actions'}>
              {dialog.kind === 'videoRename' ? (
                <span className="video-rename-options">
                  <label>
                    <input
                      checked={dialog.jidChecked === true}
                      onChange={(event) => {
                        const checked = event.target.checked
                        setDialog((current) => {
                          const fileName = setNumericJidSuffix(current.fileName, checked)
                          return {
                            ...current,
                            fileName,
                            jidChecked: checked,
                            jomChecked: getRenameSuffixState(fileName).hasJom,
                            jidGenerated: checked
                              ? fileName !== current.fileName || current.jidGenerated === true
                              : false,
                          }
                        })
                      }}
                      type="checkbox"
                    />
                    <span>Jid</span>
                  </label>
                  <label>
                    <input
                      checked={dialog.jomChecked === true}
                      onChange={(event) => {
                        const checked = event.target.checked
                        setDialog((current) => {
                          const fileName = setJomSuffix(current.fileName, checked)
                          return {
                            ...current,
                            fileName,
                            jidChecked: getRenameSuffixState(fileName).hasJid,
                            jomChecked: checked,
                          }
                        })
                      }}
                      type="checkbox"
                    />
                    <span>_JOM</span>
                  </label>
                </span>
              ) : null}
              {dialog.actions.map((action, index) => (
                <button
                  className={[
                    action.primary ? 'primary' : '',
                    action.danger ? 'danger' : '',
                  ].filter(Boolean).join(' ')}
                  key={action.value}
                  onClick={() => closeDialog(
                    dialog.kind === 'videoRename'
                      ? {
                        decision: action.value,
                        text: dialog.fileName || '',
                        jidGenerated: dialog.jidGenerated === true,
                      }
                      : ['subtitlePick', 'subtitleEdit'].includes(dialog.kind)
                        ? { decision: action.value, text: dialog.subtitleText || '' }
                        : action.value
                  )}
                  autoFocus={dialog.kind !== 'videoRename' && index === 0}
                  type="button"
                >
                  {action.label}
                  {dialog.shortcutChordActive && action.shortcut ? (
                    <span className="subtitle-pick-shortcut">{action.shortcut}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {dialog?.autoClose ? (
        <div className="inline-toast-layer">
          <div className="inline-dialog toast">
            <div className="inline-dialog-title">{dialog.title}</div>
            <div className="inline-dialog-message">{dialog.message}</div>
          </div>
        </div>
      ) : null}

      {replaceDialog && !dialog ? (
        <div className="inline-dialog-mask">
          <div className="inline-dialog replace-dialog">
            <div className="inline-dialog-title">Replace</div>
            <div className="replace-scope">
              {replaceDialog.scope === 'pool' ? 'Notes Pool visible list' : 'Video Notes visible list'}
            </div>
            <label className="replace-field">
              <span>Find</span>
              <input
                autoFocus
                disabled={replaceDialog.busy}
                onChange={(event) => updateReplaceDialog({ findText: event.target.value })}
                onKeyDown={(event) => event.stopPropagation()}
                type="text"
                value={replaceDialog.findText}
              />
            </label>
            <label className="replace-field">
              <span>Replace To</span>
              <input
                disabled={replaceDialog.busy}
                onChange={(event) => updateReplaceDialog({ replaceText: event.target.value })}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder="Empty means delete"
                type="text"
                value={replaceDialog.replaceText}
              />
            </label>
            <div className="inline-dialog-actions">
              <button
                className="primary"
                disabled={replaceDialog.busy}
                onClick={executeReplaceDialog}
                type="button"
              >
                Replace
              </button>
              <button
                disabled={replaceDialog.busy}
                onClick={() => setReplaceDialog(null)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {externalNoteSourcesOpen ? (
        <div
          className="notes-pool-source-menu"
          onClick={(event) => event.stopPropagation()}
          ref={notesPoolSourceMenuRef}
          style={externalNoteSourcesPosition}
        >
          <div className="notes-pool-source-menu-header">
            <strong>Sources</strong>
            <button
              data-tooltip="Remove sources that are not currently loaded"
              disabled={cleanableExternalNoteSourceCount === 0}
              onClick={cleanRecentExternalNoteSources}
              type="button"
            >
              Clean
            </button>
          </div>
          <div className="notes-pool-source-items">
            {sortedExternalNoteSources.length === 0 ? (
              <div className="notes-pool-source-empty">No recent sources</div>
            ) : sortedExternalNoteSources.map((source) => {
              const tooltip = source.error
                ? `${source.path}\nLoad failed: ${source.error}`
                : source.path
              const sourceIsLoaded = externalNoteLoadedSources.some((loadedSource) => loadedSource.id === source.id)
              const sourceCanBeRemoved = !source.selected && !sourceIsLoaded
              return (
                <div
                  className={source.error ? 'notes-pool-source-item failed' : 'notes-pool-source-item'}
                  key={source.id}
                  title={tooltip}
                >
                  <input
                    aria-label={`Use source ${getNotesPoolSourceLabel(source)}`}
                    checked={source.selected}
                    onChange={() => toggleExternalNoteSource(source.id)}
                    type="checkbox"
                  />
                  <span className="notes-pool-source-name">{getNotesPoolSourceLabel(source)}</span>
                  {source.type === 'folder' ? (
                    <span className="notes-pool-source-depth">D{source.depth}</span>
                  ) : null}
                  {source.error ? (
                    <span className="notes-pool-source-error" title={`Load failed: ${source.error}`}>
                      <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
                    </span>
                  ) : null}
                  <button
                    aria-label="Remove source"
                    className="notes-pool-source-remove"
                    data-tooltip={sourceCanBeRemoved ? 'Remove source' : 'Uncheck and reload before removing'}
                    disabled={!sourceCanBeRemoved}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      removeRecentExternalNoteSource(source)
                    }}
                    type="button"
                  >
                    <i className="fa-solid fa-xmark" aria-hidden="true" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {contextMenu ? (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {getContextMenuItems().map((item, index) => (
            <button
              className={item.separator ? 'context-menu-item separator' : 'context-menu-item'}
              disabled={item.disabled}
              key={`${item.label}-${index}`}
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                if (item.disabled) return
                runContextMenuAction(item.action)
              }}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {keywordMenu ? (
        <SimpleContextMenu
          items={[
            { label: 'Keywords...', action: () => keywordInsertion.openPicker('noteEditor') },
            { label: 'Quick Update Range', action: () => runAction('video.quickUpdateRange') },
            { label: 'Update Content', action: () => runAction('video.updateContent') },
            { label: 'Write Current Range', action: () => runAction('video.writeCurrentRange') },
          ]}
          onClose={() => setKeywordMenu(null)}
          position={keywordMenu}
        />
      ) : null}
    </section>
  )
}











import { useEffect, useRef, useState } from 'react'
import { APP_MODES, useAppStore } from '../../stores/appStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useVideoStore } from '../../stores/videoStore'
import { registerActions, runAction } from '../actions/actionRegistry'
import SimpleContextMenu from '../components/SimpleContextMenu'
import useKeywordInsertion from '../hooks/useKeywordInsertion'
import VideoPlayer from '../video/VideoPlayer'

const PLAYBACK_RATES = [0.1, 0.3, 0.5, 0.8, 0.9, 1, 1.2, 1.4, 1.6, 1.8, 2.0]
const SHORT_JUMP_SECONDS = 2
const LONG_JUMP_SECONDS = 8
const QUICK_NOTE_FORWARD_SECONDS = 5
const QUICK_NOTE_BACKWARD_SECONDS = 2
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
  const notesListRef = useRef(null)
  const directoryListRef = useRef(null)
  const noteEditorRef = useRef(null)
  const leaveGuardHandlerRef = useRef(null)
  const dialogResolveRef = useRef(null)
  const toastTimerRef = useRef(null)
  const [leftTab, setLeftTab] = useState('notes')
  const [dialog, setDialog] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [keywordMenu, setKeywordMenu] = useState(null)
  const [fullscreenCycleState, setFullscreenCycleState] = useState(0)
  const [panelsHidden, setPanelsHidden] = useState(false)
  const [selectedDirectoryMp4Name, setSelectedDirectoryMp4Name] = useState('')
  const [playAll, setPlayAll] = useState(true)
  const [titleOn, setTitleOn] = useState(true)
  const [subtitleLanguages, setSubtitleLanguages] = useState([])
  const [selectedSubtitleLanguageKey, setSelectedSubtitleLanguageKey] = useState('')
  const [selectedSubtitle, setSelectedSubtitle] = useState(null)
  const [videoControlMode, setVideoControlMode] = useState(false)
  const [volume, setVolume] = useState(1)

  const extraSubtitleFolder = useSettingsStore((state) => state.settings.general.extraSubtitleFolder)
  const playAllSubtitleSuffix = useSettingsStore((state) => state.settings.general.playAllSubtitleSuffix)
  const subtitleConvertPromptTimeoutSec = useSettingsStore((state) => state.settings.general.subtitleConvertPromptTimeoutSec)
  const mode = useAppStore((state) => state.mode)
  const dirty = useAppStore((state) => state.dirtyByMode.video)
  const recentVideoFiles = useAppStore((state) => state.recentFiles.video || [])
  const recentVideoFolders = useAppStore((state) => state.recentFolders.video || [])
  const setDirty = useAppStore((state) => state.setDirty)
  const setCurrentFile = useAppStore((state) => state.setCurrentFile)
  const addRecentFile = useAppStore((state) => state.addRecentFile)
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

  const closeDialog = (decision) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current)
      toastTimerRef.current = null
    }

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
      title: options.title || '选择字幕文件',
      subtitleCandidates,
      defaultValue: subtitleCandidates[0]?.filePath || 'none',
      cancelValue: 'none',
      actions: [{ label: options.noneLabel || '不加载字幕', value: 'none' }],
    })
  })

  const showAutoMessage = (message, title = '提示', timeout = 1200) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current)
    }

    setDialog({
      title,
      message,
      actions: [{ label: '确定', value: 'ok', primary: true }],
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
  }, [])

  useEffect(() => {
    if (!dialog) return undefined

    const onKeyDown = (event) => {
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

  const getPlayerTime = () => playerRef.current?.currentTime() ?? 0

  const getDuration = () => {
    const duration = playerRef.current?.duration?.()
    return Number.isFinite(duration) ? duration : Number.POSITIVE_INFINITY
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
      showAutoMessage('当前 start 时间无效。', '提示', 900)
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

    const applySeek = () => {
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
      showAutoMessage('当前 start 时间无效，无法生成视频笔记。', '时间无效', 1800)
      return null
    }

    if (!Number.isFinite(endSeconds) || endSeconds <= startSeconds) {
      showAutoMessage('结束时间小于或等于开始时间，已自动调整为 start + 1秒。', '时间已调整', 1600)
      return {
        start: range.start,
        end: formatTime(startSeconds + 1),
      }
    }

    return range
  }

  const playFromCurrentPosition = () => {
    const player = playerRef.current
    if (!player?.play) return

    const tryPlay = () => {
      const result = player.play()
      if (result?.catch) {
        result.catch(() => {
          showAutoMessage('浏览器阻止了自动播放，请手动点击播放。', '播放提示', 1800)
        })
      }
    }

    tryPlay()
    player.one?.('seeked', tryPlay)
    setTimeout(tryPlay, 80)
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

  const selectNote = (note) => {
    setSelectedNoteId(note.id)
    setNoteDraft(note.content)
    setSelectedStart(note.start)
    setSelectedEnd(note.end)
  }

  const selectNoteByIndex = (index) => {
    if (notes.length === 0) return null

    const safeIndex = Math.max(0, Math.min(index, notes.length - 1))
    const note = notes[safeIndex]
    selectNote(note)
    return note
  }

  const jumpToNote = (note) => {
    selectNote(note)

    const startSeconds = parseTime(note.start)
    if (!Number.isFinite(startSeconds) || !playerRef.current) return

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
    setPlaybackRate(nextRate)
  }

  const playAfterVideoSourceLoaded = (options = {}) => {
    const player = playerRef.current
    if (!player?.play) return

    const tryPlay = () => {
      if (options.playbackRate) {
        applyPlaybackRate(options.playbackRate)
      }

      const result = player.play()
      if (result?.catch) {
        result.catch(() => {
          showAutoMessage('浏览器阻止了自动播放，请手动点击播放。', '播放提示', 1800)
        })
      }
    }

    player.one?.('loadedmetadata', tryPlay)
    player.one?.('canplay', tryPlay)
    setTimeout(tryPlay, 180)
  }

  const saveVideoNotes = async ({ silent = false } = {}) => {
    if (!videoFile?.filePath || !window.videoApi?.saveNotes) {
      showAutoMessage('没有可保存的视频文件。')
      return false
    }

    const payload = notes.map((note) => ({
      ...(note.raw || {}),
      Start: note.start,
      End: note.end,
      Content: note.content,
    }))

    const result = await window.videoApi.saveNotes(videoFile.filePath, payload)
    if (!result?.ok) {
      showAutoMessage('保存失败。')
      return false
    }

    setDirty(APP_MODES.VIDEO, false)
    if (!silent) {
      showAutoMessage('文件已经保存。', '保存完成', 900)
    }
    return true
  }

  const confirmBeforeSwitchVideo = async () => {
    if (!dirty) return true

    const decision = await showActionDialog({
      title: '视频笔记已修改',
      message: '当前视频笔记已经修改，切换MP4文件前需要处理这些修改。',
      defaultValue: 'save',
      cancelValue: 'cancel',
      actions: [
        { label: '保存并切换', value: 'save', primary: true },
        { label: '放弃修改', value: 'discard', danger: true },
        { label: '取消', value: 'cancel' },
      ],
    })

    if (decision === 'save') {
      return saveVideoNotes({ silent: true })
    }

    if (decision === 'discard') {
      setDirty(APP_MODES.VIDEO, false)
      return true
    }

    return false
  }

  leaveGuardHandlerRef.current = confirmBeforeSwitchVideo

  useEffect(() => {
    setLeaveGuard(APP_MODES.VIDEO, () => leaveGuardHandlerRef.current?.() ?? true)
    return () => setLeaveGuard(APP_MODES.VIDEO, null)
  }, [setLeaveGuard])

  useEffect(() => {
    registerSessionProvider(APP_MODES.VIDEO, () => ({
      currentFilePath: videoFile?.filePath || '',
      folderPath: videoFile?.folderPath || '',
      leftTab,
      selectedNoteIndex: notes.findIndex((note) => note.id === selectedNoteId),
      playbackTime: getPlayerTime(),
      playbackRate: getPlaybackRate(),
      fullscreenCycleState,
      panelsHidden,
    }))
    return () => registerSessionProvider(APP_MODES.VIDEO, null)
  }, [
    fullscreenCycleState,
    leftTab,
    notes,
    panelsHidden,
    registerSessionProvider,
    selectedNoteId,
    videoFile?.filePath,
    videoFile?.folderPath,
  ])

  useEffect(() => {
    const snapshot = restoreSessionState?.modes?.video
    if (!snapshot) return

    if (snapshot.leftTab === 'notes' || snapshot.leftTab === 'files') setLeftTab(snapshot.leftTab)
    setFullscreenCycleState(Number(snapshot.fullscreenCycleState) || 0)
    setPanelsHidden(snapshot.panelsHidden === true)
    if (snapshot.currentFilePath) {
      openVideoFileFullPath(snapshot.currentFilePath, {
        autoplay: false,
        playbackRate: Number(snapshot.playbackRate) || 1,
        selectedNoteIndex: snapshot.selectedNoteIndex,
        seekTime: snapshot.playbackTime,
      })
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
      return languageOptions.find((entry) => (
        matchesSubtitleSuffix(entry.subtitle, playAllSubtitleSuffix)
        || matchesSubtitleSuffix(entry.srtSubtitle, playAllSubtitleSuffix)
      )) || null
    }

    const selectedLanguage = await showSubtitleChoiceDialog(languageOptions.map((entry) => ({
      ...entry,
      filePath: getSubtitleLanguageKey(entry.language),
      fileName: entry.subtitle?.fileName || entry.srtSubtitle?.fileName || '',
    })))
    if (!selectedLanguage || selectedLanguage === 'none') {
      return null
    }

    return languageOptions.find((entry) => getSubtitleLanguageKey(entry.language) === selectedLanguage) || null
  }

  const chooseSrtSubtitleForConversion = async (srtSubtitle, options = {}) => {
    if (!srtSubtitle) {
      return null
    }

    const decision = await showActionDialog({
      title: '转换SRT字幕',
      message: `未找到VTT字幕，发现SRT字幕：${srtSubtitle.fileName}。是否转换为VTT？`,
      defaultValue: 'convert',
      cancelValue: 'cancel',
      timeoutMs: subtitleConvertPromptTimeoutSec * 1000,
      timeoutValue: 'cancel',
      actions: [
        { label: '转换', value: 'convert', primary: true },
        { label: '取消', value: 'cancel' },
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
        showAutoMessage('字幕转换完成。', '字幕', 900)
        return
      }

      showAutoMessage('字幕转换失败。', '字幕', 1500)
    } catch {
      showAutoMessage('字幕转换失败。', '字幕', 1500)
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

  const handleSubtitleLanguageChange = (event) => {
    const nextLanguageKey = event.target.value
    setSelectedSubtitleLanguageKey(nextLanguageKey)
    if (titleOn) {
      applySubtitleLanguage(nextLanguageKey)
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
      showAutoMessage('没有合法的MP4文件。')
      return
    }

    const nextSubtitleLanguages = normalizeSubtitleLanguages(info)
    const subtitleLanguage = await chooseSubtitleLanguage(nextSubtitleLanguages, options)
    const selectedLanguageKey = subtitleLanguage ? getSubtitleLanguageKey(subtitleLanguage.language) : ''
    const subtitle = subtitleLanguage?.subtitle || null
    const srtSubtitle = subtitle ? null : await chooseSrtSubtitleForConversion(subtitleLanguage?.srtSubtitle, options)

    setVideoFile(info)
    setSubtitleLanguages(nextSubtitleLanguages)
    setSelectedSubtitleLanguageKey(selectedLanguageKey)
    setSelectedSubtitle(subtitle)
    setCurrentFile(info.filePath)
    addRecentFile(APP_MODES.VIDEO, info.filePath)
    if (info.folderPath) {
      addRecentFolder(APP_MODES.VIDEO, info.folderPath)
    }
    const loadedNotes = info.notes.map((note, index) => ({
      id: `${info.filePath}-${index}`,
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
    setDirectoryMp4Files(info.mp4Files || [])
    setSelectedDirectoryMp4Name(info.fileName || '')
    setSelectedNoteId(restoredNote?.id || null)
    setNoteDraft(restoredNote?.content || '')
    setSelectedStart(restoredNote?.start || '')
    setSelectedEnd(restoredNote?.end || '')
    setCurStart('')
    setCurEnd('')
    setDirty(APP_MODES.VIDEO, false)

    if (options.playbackRate) {
      applyPlaybackRate(options.playbackRate)
    }

    if (Number.isFinite(Number(options.seekTime))) {
      seekWhenReady(Number(options.seekTime))
    }

    if (options.autoplay) {
      playAfterVideoSourceLoaded({ playbackRate: options.playbackRate })
    }

    if (srtSubtitle) {
      convertSrtSubtitleInBackground(info, srtSubtitle)
    }
  }

  const openVideoFileFullPath = async (fullPath, options = {}) => {
    if (!fullPath || !window.videoApi?.getVideoFileInfo) return

    if (!options.skipSwitchConfirm) {
      const canSwitch = await confirmBeforeSwitchVideo()
      if (!canSwitch) return
    }

    const info = await window.videoApi.getVideoFileInfo(fullPath, { extraSubtitleFolder })
    await loadVideoInfo(info, options)
  }

  const openVideoFilePath = async (fileName) => {
    if (!videoFile?.folderPath) return
    openVideoFileFullPath(joinPath(videoFile.folderPath, fileName), { autoplay: true })
  }

  const confirmBeforePlayNextVideo = async () => {
    if (!dirty) return true

    const decision = await showActionDialog({
      title: '自动播放下一视频',
      message: '当前视频笔记有未保存修改，如何处理？',
      defaultValue: 'save-next',
      cancelValue: 'stay',
      actions: [
        { label: '保存并播放下一视频', value: 'save-next', primary: true },
        { label: '放弃修改并播放下一视频', value: 'discard-next' },
        { label: '停留当前视频', value: 'stay' },
      ],
    })

    if (decision === 'save-next') {
      return saveVideoNotes({ silent: true })
    }

    if (decision === 'discard-next') {
      setDirty(APP_MODES.VIDEO, false)
      return true
    }

    playerRef.current?.pause?.()
    return false
  }

  const playNextDirectoryVideo = async () => {
    if (!playAll || repeat || !videoFile?.folderPath || directoryMp4Files.length === 0) return

    const currentIndex = directoryMp4Files.findIndex((fileName) => fileName === videoFile.fileName)
    if (currentIndex < 0 || currentIndex >= directoryMp4Files.length - 1) return

    const canPlayNext = await confirmBeforePlayNextVideo()
    if (!canPlayNext) return

    const nextFileName = directoryMp4Files[currentIndex + 1]
    openVideoFileFullPath(joinPath(videoFile.folderPath, nextFileName), {
      autoplay: true,
      playbackRate: getPlaybackRate(),
      playAllAuto: true,
      skipSwitchConfirm: true,
    })
  }

  const selectDirectoryMp4ByIndex = (index) => {
    if (directoryMp4Files.length === 0) return ''

    const safeIndex = Math.max(0, Math.min(index, directoryMp4Files.length - 1))
    const fileName = directoryMp4Files[safeIndex]
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

    const currentIndex = directoryMp4Files.findIndex((fileName) => fileName === selectedDirectoryMp4Name)
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
    const mp4Files = result.mp4Files || []
    setDirectoryMp4Files(mp4Files)
    setSelectedDirectoryMp4Name(mp4Files[0] || '')

    if (mp4Files[0] && window.videoApi?.getVideoFileInfo) {
      const info = await window.videoApi.getVideoFileInfo(joinPath(folderPath, mp4Files[0]), { extraSubtitleFolder })
      await loadVideoInfo({
        ...info,
        mp4Files,
      })
    }
  }

  const openVideoFile = async () => {
    if (!window.videoApi?.openVideoFile) {
      showAutoMessage('videoApi.openVideoFile 不可用。')
      return
    }

    const canSwitch = await confirmBeforeSwitchVideo()
    if (!canSwitch) return

    const info = await window.videoApi.openVideoFile({ extraSubtitleFolder })
    if (info?.canceled) return
    await loadVideoInfo(info, { autoplay: true })
  }

  const openFromClipboard = async () => {
    if (!window.videoApi?.readClipboardText || !window.videoApi?.validateMp4Path) {
      showAutoMessage('剪贴板读取接口不可用。')
      return
    }

    let clipboardText = ''
    try {
      clipboardText = await window.videoApi.readClipboardText()
    } catch {
      showAutoMessage('剪贴板读取失败。', 'GetClip', 1200)
      return
    }

    const result = await window.videoApi.validateMp4Path(clipboardText)
    if (!result?.ok) {
      showAutoMessage('没有合法的MP4文件。', 'GetClip', 1200)
      return
    }

    openVideoFileFullPath(result.filePath, {
      autoplay: true,
      playbackRate: getPlaybackRate(),
    })
  }

  const addQuickNote = async () => {
    if (!videoFile?.filePath) return

    const range = normalizeRange(buildCaptureRange())
    if (!range) return

    addNote(createQuickNote(range))
    setCurStart(range.start)
    setCurEnd(range.end)
    setDirty(APP_MODES.VIDEO, true)
    showAutoMessage('已追加视频笔记。', '操作完成', 900)
  }

  const appendCurrentMark = () => {
    if (!videoFile?.filePath) return

    const startSeconds = parseTime(curStart)
    const endSeconds = parseTime(curEnd)
    if (!Number.isFinite(startSeconds)) {
      showAutoMessage('当前 start 时间无效。', '提示', 1200)
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
      start: formatTime(safeStart),
      end: formatTime(safeEnd),
      content: noteDraft || '',
      raw: {},
    }
    addNote(note)
    setDirty(APP_MODES.VIDEO, true)
    showAutoMessage('已追加标记。', '操作完成', 900)
  }

  const createQuickNote = (range) => ({
    id: `${videoFile?.filePath || 'video'}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    start: range.start,
    end: range.end,
    content: 'None',
    raw: {},
  })

  const insertQuickNoteNearSelected = (position) => {
    if (!selectedNoteId || !videoFile?.filePath) {
      showAutoMessage('没有选中的视频笔记。', '提示', 900)
      return
    }

    const selectedIndex = notes.findIndex((note) => note.id === selectedNoteId)
    if (selectedIndex < 0) {
      showAutoMessage('没有选中的视频笔记。', '提示', 900)
      return
    }

    const range = normalizeRange(buildCaptureRange())
    if (!range) return

    const insertIndex = position === 'before' ? selectedIndex : selectedIndex + 1
    insertNoteAt(insertIndex, createQuickNote(range))
    setDirty(APP_MODES.VIDEO, true)
    showAutoMessage('已插入视频笔记。', '操作完成', 900)
  }

  const deleteSelectedNote = async () => {
    if (!selectedNoteId) {
      showAutoMessage('没有选中的视频笔记。', '提示', 900)
      return
    }

    const decision = await showActionDialog({
      title: '删除视频笔记',
      message: '确认删除当前选中的视频笔记？',
      defaultValue: 'delete',
      cancelValue: 'cancel',
      actions: [
        { label: '删除', value: 'delete', danger: true },
        { label: '取消', value: 'cancel' },
      ],
    })
    if (decision !== 'delete') return

    deleteNote(selectedNoteId)
    setDirty(APP_MODES.VIDEO, true)
  }

  const clearNotesList = async () => {
    const decision = await showActionDialog({
      title: '清空笔记列表',
      message: '确认清空当前视频的全部笔记数据？',
      defaultValue: 'clear',
      cancelValue: 'cancel',
      actions: [
        { label: '清空', value: 'clear', danger: true },
        { label: '取消', value: 'cancel' },
      ],
    })
    if (decision !== 'clear') return

    clearNotes()
    setCurStart('')
    setCurEnd('')
    setDirty(APP_MODES.VIDEO, true)
  }
  const quickUpdateSelectedRange = async () => {
    if (!selectedNoteId) {
      showAutoMessage('没有选中的视频笔记。', '提示', 900)
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
    showAutoMessage('已更新时间段。', '操作完成', 900)
  }
  const writeCurrentRangeToSelected = async () => {
    if (!selectedNoteId || !curStart || !curEnd) return

    const decision = await showActionDialog({
      title: '更新时间段',
      message: '确认将 curStart / curEnd 写回当前选中视频笔记？',
      defaultValue: 'update',
      cancelValue: 'cancel',
      actions: [
        { label: '更新', value: 'update', primary: true },
        { label: '取消', value: 'cancel' },
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
    setNoteDraft(content)
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
    if (!selectedNoteId) {
      showAutoMessage('没有选中的视频笔记。', '提示', 900)
      return
    }

    const decision = await showActionDialog({
      title: '更新视频笔记',
      message: '确认更新当前选中视频笔记内容？',
      defaultValue: 'update',
      cancelValue: 'cancel',
      actions: [
        { label: '更新', value: 'update', primary: true },
        { label: '取消', value: 'cancel' },
      ],
    })
    if (decision !== 'update') return

    updateNote(selectedNoteId, { content: noteDraft })
    setDirty(APP_MODES.VIDEO, true)
    showAutoMessage('已更新视频笔记内容。', '操作完成', 900)
  }

  const speedByStep = (step) => {
    const currentRate = getPlaybackRate()
    const currentIndex = PLAYBACK_RATES.reduce((bestIndex, rate, index) => (
      Math.abs(rate - currentRate) < Math.abs(PLAYBACK_RATES[bestIndex] - currentRate)
        ? index
        : bestIndex
    ), 0)
    const nextIndex = Math.min(PLAYBACK_RATES.length - 1, Math.max(0, currentIndex + step))
    const nextRate = PLAYBACK_RATES[nextIndex]

    playerRef.current?.playbackRate?.(nextRate)
    setPlaybackRate(nextRate)
  }

  const volumeByStep = (step) => {
    const player = playerRef.current
    if (!player?.volume) return

    const currentVolume = Number(player.volume())
    const baseVolume = Number.isFinite(currentVolume) ? currentVolume : volume
    const nextVolume = Math.max(0, Math.min(1, baseVolume + step))
    player.volume(nextVolume)
    setVolume(nextVolume)
  }

  const cycleFullscreenPanelState = () => {
    setFullscreenCycleState((state) => {
      if (state === 0) return 2
      if (state === 2) return 3
      return 0
    })
  }

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

  const handleNotesListKeyDown = (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Enter') {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    if (event.key === 'Enter') {
      const note = selectedNote || selectNoteByIndex(0)
      if (note) {
        jumpToNote(note)
      }
      return
    }

    const currentIndex = notes.findIndex((note) => note.id === selectedNoteId)
    const baseIndex = currentIndex >= 0 ? currentIndex : 0
    const nextIndex = event.key === 'ArrowUp' ? baseIndex - 1 : baseIndex + 1
    selectNoteByIndex(currentIndex >= 0 ? nextIndex : 0)
  }

  const toggleCustomFullscreen = () => {
    setFullscreenCycleState((state) => (state === 1 || state === 2 ? 0 : 1))
  }

  const togglePanelsVisibility = () => {
    setPanelsHidden((value) => !value)
  }

  const getContextMenuItemCount = (type) => (type === 'video' ? 11 : 10)

  const openContextMenu = (event, type, note = null) => {
    event.preventDefault()
    event.stopPropagation()

    if (note) {
      selectNote(note)
    }

    const position = getContextMenuPosition(event, getContextMenuItemCount(type))
    setContextMenu({
      type,
      x: position.x,
      y: position.y,
    })
  }

  const moveSelectedNote = (direction) => {
    if (!selectedNoteId) {
      showAutoMessage('没有选中的视频笔记。', '提示', 900)
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

  const runContextMenuAction = (handler) => {
    setContextMenu(null)
    setTimeout(() => {
      handler()
    }, 0)
  }

  const getContextMenuItems = () => {
    const noteItems = [
      { label: '追加快捷标记', action: () => runAction('video.appendQuickMark') },
      { label: '追加标记', action: () => runAction('video.appendMark') },
      { label: '前插入快捷标记', action: () => insertQuickNoteNearSelected('before') },
      { label: '后插入快捷标记', action: () => insertQuickNoteNearSelected('after') },
      { label: 'Quick Update Range', action: quickUpdateSelectedRange, separator: true },
      { label: '向上移动', action: () => moveSelectedNote('up') },
      { label: '向下移动', action: () => moveSelectedNote('down') },
      { label: '删除当前选中', action: deleteSelectedNote, separator: true },
    ]

    if (contextMenu?.type === 'video') {
      return [
        ...noteItems,
        { label: '切换全屏模式', action: toggleCustomFullscreen, separator: true },
        { label: '显示/隐藏控制区', action: togglePanelsVisibility },
        { label: '关闭菜单', action: () => {}, separator: true },
      ]
    }

    return [
      ...noteItems,
      { label: '清空笔记列表', action: clearNotesList },
      { label: '关闭菜单', action: () => {}, separator: true },
    ]
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
      handler: () => volumeByStep(0.1),
    },
    {
      id: 'video.volumeDown',
      label: 'Volume Down',
      scope: APP_MODES.VIDEO,
      handler: () => volumeByStep(-0.1),
    },
    {
      id: 'video.toggleView',
      label: 'Toggle View',
      scope: APP_MODES.VIDEO,
      handler: cycleFullscreenPanelState,
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
    confirmUpdateSelectedContent,
    cycleFullscreenPanelState,
    seekToCurrentStart,
    seekByScaledSeconds,
    saveVideoNotes,
    setCurEnd,
    setCurStart,
    speedByStep,
    togglePlayPause,
    toggleFocusBetweenNotesListAndTextInput,
    quickUpdateSelectedRange,
    volumeByStep,
    writeCurrentRangeToSelected,
  ])

  const onPlayerReady = (player) => {
    playerRef.current = player
    setPlaybackRate(player.playbackRate?.() || 1)
    setVolume(player.volume?.() ?? 1)
    player.on('ratechange', () => {
      setPlaybackRate(player.playbackRate?.() || 1)
    })
    player.on('volumechange', () => {
      setVolume(player.volume?.() ?? 1)
    })
  }

  const onTimeUpdate = (currentTime) => {
    setPlayingTime(formatTime(currentTime))
  }

  const fullscreenClass = `fullscreen-state-${fullscreenCycleState}`
  const panelsClass = panelsHidden ? 'panels-hidden' : ''
  const controlModeClass = videoControlMode ? 'video-control-mode' : ''

  return (
    <section className={`video-mode ${fullscreenClass} ${panelsClass} ${controlModeClass}`}>
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
            <div className="list-title">Video notes</div>
            <div
              className="notes-list"
              onContextMenu={(event) => openContextMenu(event, 'notes')}
              onKeyDown={handleNotesListKeyDown}
              ref={notesListRef}
              tabIndex={0}
            >
              {notes.length === 0 ? (
                <div className="empty-list">No video notes</div>
              ) : (
                notes.map((note) => (
                  <button
                    className={note.id === selectedNoteId ? 'note-row active' : 'note-row'}
                    key={note.id}
                    onClick={() => selectNote(note)}
                    onContextMenu={(event) => openContextMenu(event, 'notes', note)}
                    onDoubleClick={() => jumpToNote(note)}
                    type="button"
                  >
                    <span>{note.start}</span>
                    <span>{note.end}</span>
                    <span>{note.content}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="files-list">
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
                        onDoubleClick={() => openVideoFileFullPath(filePath, { autoplay: true })}
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
            <div className="list-section directory-section">
              <label className="folder-title-field">
                <span>folder:</span>
                <input readOnly title={videoFile?.folderPath || ''} value={videoFile?.folderPath || ''} />
              </label>
              <div
                className="list-scroll-body"
                onKeyDown={handleDirectoryMp4KeyDown}
                ref={directoryListRef}
                tabIndex={0}
              >
                {directoryMp4Files.length === 0 ? (
                  <div className="empty-list">No MP4 files loaded</div>
                ) : (
                  directoryMp4Files.map((fileName) => (
                    <button
                      className={fileName === selectedDirectoryMp4Name ? 'mp4-list-row active' : 'mp4-list-row'}
                      key={fileName}
                      onClick={() => setSelectedDirectoryMp4Name(fileName)}
                      onDoubleClick={() => openVideoFilePath(fileName)}
                      title={fileName}
                      type="button"
                    >
                      {fileName}
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
        </aside>

        <section className="video-center">
        <div className="video-stage" onContextMenu={(event) => openContextMenu(event, 'video')}>
          <VideoPlayer
            onEnded={playNextDirectoryVideo}
            onReady={onPlayerReady}
            onTimeUpdate={onTimeUpdate}
            subtitle={selectedSubtitle}
            subtitleEnabled={titleOn}
            src={videoFile?.fileUrl}
          />
        </div>

        <div className="video-bottom-panel">
          <textarea
            className="note-editor"
            onContextMenu={handleNoteEditorContextMenu}
            onChange={(event) => updateSelectedContent(event.target.value)}
            onKeyDown={handleNoteEditorKeyDown}
            placeholder="Note content"
            ref={noteEditorRef}
            value={noteDraft}
          />
          <div className="video-side-panel">
            <div className="video-info">
              <div className="info-pair">
                <div>
                  <span>start</span>
                  <strong>{selectedStart || selectedNote?.start || '--:--:--.-'}</strong>
                </div>
                <div>
                  <span>end</span>
                  <strong>{selectedEnd || selectedNote?.end || '--:--:--.-'}</strong>
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
                <span>Mode</span>
                <strong className={repeat ? 'repeat-mode' : ''}>{repeat ? 'repeat' : 'normal'}</strong>
              </div>
              <div>
                <span>speed</span>
                <strong>{playbackRate}x</strong>
              </div>
              <div>
                <span>Vol</span>
                <strong>{Math.round(volume * 100)}%</strong>
              </div>
              <div className="info-file">
                <span>file</span>
                <strong title={videoFile?.fileName || ''}>{videoFile?.fileName || '--'}</strong>
              </div>
            </div>
            <div className="video-mini-controls" aria-label="Video controls">
              <button data-tooltip="Play / Pause" onClick={() => runAction('video.togglePlay')} type="button">
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
            </div>
          </div>
        </div>
        </section>

        <aside className="video-toolbar">
        <button type="button" onClick={openVideoFile}>Open</button>
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
        </aside>
      </div>

      <footer className="video-statusbar">
        <span>Status: <strong className={dirty ? 'status-unsaved' : ''}>{dirty ? 'Unsaved' : 'Saved'}</strong></span>
        <span>Control: <strong className={videoControlMode ? 'control-on' : ''}>{videoControlMode ? 'ON' : 'OFF'}</strong></span>
        <label className="video-subtitle-language">
          <span>Subtitle:</span>
          <select
            disabled={subtitleLanguages.length === 0}
            onChange={handleSubtitleLanguageChange}
            value={selectedSubtitleLanguageKey}
          >
            {subtitleLanguages.length === 0 ? (
              <option value="">None</option>
            ) : (
              subtitleLanguages.map((entry) => (
                <option key={getSubtitleLanguageKey(entry.language)} value={getSubtitleLanguageKey(entry.language)}>
                  {entry.label || entry.language || 'Default'}
                </option>
              ))
            )}
          </select>
        </label>
      </footer>

      {dialog && !dialog.autoClose ? (
        <div className="inline-dialog-mask">
          <div className="inline-dialog">
            <div className="inline-dialog-title">{dialog.title}</div>
            {dialog.subtitleCandidates ? (
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
            <div className="inline-dialog-actions">
              {dialog.actions.map((action, index) => (
                <button
                  className={[
                    action.primary ? 'primary' : '',
                    action.danger ? 'danger' : '',
                  ].filter(Boolean).join(' ')}
                  key={action.value}
                  onClick={() => closeDialog(action.value)}
                  autoFocus={index === 0}
                  type="button"
                >
                  {action.label}
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
              key={`${item.label}-${index}`}
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
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



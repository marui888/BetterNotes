import { useEffect, useMemo, useRef, useState } from 'react'
import { APP_MODES, useAppStore } from '../../stores/appStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { registerActions, runAction } from '../actions/actionRegistry'
import { getAutoPlaySkipReason } from './textWordValidator'

const TEXT_TABS = {
  WORDS: 'words',
  FILES: 'files',
}

const WORDS_TAB_VIEW_MODES = {
  INPUT: 'input',
  REVIEW: 'review',
}

function splitPath(filePath) {
  const value = filePath || ''
  const lastSlash = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'))
  return {
    folderPath: lastSlash >= 0 ? value.slice(0, lastSlash) : '',
    fileName: lastSlash >= 0 ? value.slice(lastSlash + 1) : value,
  }
}

function joinPath(folderPath, fileName) {
  if (!folderPath || !fileName) return ''
  const separator = folderPath.endsWith('\\') || folderPath.endsWith('/') ? '' : '\\'
  return `${folderPath}${separator}${fileName}`
}

function createEmptyRecord() {
  return {
    id: `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    word: '',
    markers: ['', '', '', '', '', ''],
    annotation: '',
  }
}

function getDictionaryErrorMessage(reason, dictionaryName) {
  const messages = {
    'empty-word': 'No word to lookup.',
    'windows-only': 'Dictionary lookup is only available on Windows.',
    'mdict-not-found': 'MDict window was not found.',
    'mdict-input-not-found': 'MDict input box was not found.',
    'webster-not-found': 'Merriam-Webster 11th window was not found.',
    'webster-output-not-found': 'Merriam-Webster output area was not found.',
    'webster-search-controls-not-found': 'Merriam-Webster search controls were not found.',
  }

  return messages[reason] || `${dictionaryName} lookup failed.`
}

function formatDictionaryWindowCandidates(windows) {
  if (!Array.isArray(windows) || windows.length === 0) {
    return 'No dictionary-like windows were found.'
  }

  return windows.slice(0, 6).map((item, index) => (
    `${index + 1}. ${item.title || '(no title)'} [${item.className || 'no class'}]`
  )).join('\n')
}

function recordToLine(record) {
  const markers = Array.isArray(record?.markers) ? record.markers.slice(0, 6) : []
  while (markers.length < 6) markers.push('')

  return [
    record?.word || '',
    ...markers.map((item) => item || ''),
    record?.annotation || '',
  ].join('|')
}

function lineToRecord(line, oldRecord) {
  const parts = String(line ?? '').split('|')
  const markers = parts.slice(1, 7)
  while (markers.length < 6) markers.push('')

  return {
    ...(oldRecord || createEmptyRecord()),
    word: parts[0] || '',
    markers,
    annotation: parts.length > 7 ? parts.slice(7).join('|') : '',
    raw: line,
  }
}

function normalizeInlineText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

function hasCjkText(text) {
  return /[\u3400-\u9fff]/.test(text)
}

function splitNumberedDefinitionItems(text) {
  const source = String(text ?? '')
  const matches = [...source.matchAll(/\b([1-9]|[12]\d|30)\.\s/g)]
  if (matches.length === 0) return []

  return matches.map((match, index) => ({
    start: match.index,
    end: index + 1 < matches.length ? matches[index + 1].index : source.length,
  })).map(({ start, end }) => source.slice(start, end))
}

function formatDefinitionItem(item) {
  const match = String(item ?? '').match(/^(([1-9]|[12]\d|30)\.\s*)([\s\S]*)$/)
  if (!match) return normalizeInlineText(item)

  const prefix = match[1]
  const body = match[3]
  if (hasCjkText(body)) {
    const cjkIndex = body.search(/[\u3400-\u9fff]/)
    const englishPart = normalizeInlineText(body.slice(0, cjkIndex))
    const rest = normalizeInlineText(body.slice(cjkIndex))
    if (englishPart) return `${prefix}(${englishPart}) ${rest}`.trim()
  }

  const colonIndex = body.indexOf(':')
  if (colonIndex >= 0) {
    const meaning = normalizeInlineText(body.slice(0, colonIndex + 1))
    const rest = normalizeInlineText(body.slice(colonIndex + 1))
    if (meaning) return `${prefix}(${meaning}) ${rest}`.trim()
  }

  return `${prefix}${normalizeInlineText(body)}`.trim()
}

function formatWordAnnotationText(text, cursorPosition) {
  const source = String(text ?? '')
  const head = source.slice(0, cursorPosition).trim()
  const tail = source.slice(cursorPosition)
  const headText = head ? `[${head}]` : ''
  const items = splitNumberedDefinitionItems(tail)
  if (items.length === 0) {
    const tailText = normalizeInlineText(tail)
    return headText && tailText ? `${headText} ${tailText}` : `${headText}${tailText}`
  }

  const firstItemIndex = tail.indexOf(items[0])
  const beforeItems = normalizeInlineText(tail.slice(0, firstItemIndex))
  const formattedItems = items.map(formatDefinitionItem).join(' ')
  return [headText, beforeItems, formattedItems].filter(Boolean).join(' ')
}

export default function TextMode() {
  const wordListRef = useRef(null)
  const currentTxtListRef = useRef(null)
  const recentTxtListRef = useRef(null)
  const wordListLowerRef = useRef(null)
  const wordCommandToolbarRef = useRef(null)
  const dialogLayerRef = useRef(null)
  const dialogResolveRef = useRef(null)
  const dirtyRef = useRef(false)
  const lineDraftRef = useRef('')
  const recordsRef = useRef([])
  const selectedRecordIdRef = useRef(null)
  const independentInputRef = useRef(null)
  const lineDraftInputRef = useRef(null)
  const toastTimerRef = useRef(null)
  const leaveGuardHandlerRef = useRef(null)
  const autoLookupTimerRef = useRef(null)
  const autoLookupRunningRef = useRef(false)
  const autoLookupContextRef = useRef({ fileIndex: -1, wordIndex: -1 })

  const [activeTab, setActiveTab] = useState(TEXT_TABS.WORDS)
  const [textFile, setTextFile] = useState(null)
  const [currentFolderPath, setCurrentFolderPath] = useState('')
  const [txtFiles, setTxtFiles] = useState([])
  const [specialFolderPath, setSpecialFolderPath] = useState('')
  const [specialTxtFiles, setSpecialTxtFiles] = useState([])
  const [specialTextFile, setSpecialTextFile] = useState(null)
  const [records, setRecords] = useState([])
  const [selectedRecordId, setSelectedRecordId] = useState(null)
  const [independentInput, setIndependentInput] = useState('')
  const [lineDraft, setLineDraft] = useState('')
  const [selectedRecentPath, setSelectedRecentPath] = useState('')
  const [dialog, setDialog] = useState(null)
  const [inputContextMenu, setInputContextMenu] = useState(null)
  const [wordsTabViewMode, setWordsTabViewMode] = useState(WORDS_TAB_VIEW_MODES.INPUT)
  const [wordToolbarLayout, setWordToolbarLayout] = useState({ columns: 2, width: 62 })
  const [autoLookupRunning, setAutoLookupRunning] = useState(false)
  const [autoLookupError, setAutoLookupError] = useState(false)

  const dirty = useAppStore((state) => state.dirtyByMode.text)
  const textAutoPlayAll = useSettingsStore((state) => state.settings.general.textAutoPlayAll)
  const textAutoLookupDelayMs = useSettingsStore((state) => state.settings.general.textAutoLookupDelayMs)
  const textAutoPlayDicts = useSettingsStore((state) => state.settings.general.textAutoPlayDicts)
  const monthlyNotesFolder = useSettingsStore((state) => state.settings.general.monthlyNotesFolder)
  const specialTextFolder = useSettingsStore((state) => state.settings.general.specialTextFolder)
  const wordsReviewFontSize = useSettingsStore((state) => state.settings.general.wordsReviewFontSize)
  const websterSpellOut = useSettingsStore((state) => state.settings.general.websterSpellOut)
  const recentTextFiles = useAppStore((state) => state.recentFiles.text || [])
  const recentTextFolders = useAppStore((state) => state.recentFolders.text || [])
  const currentMode = useAppStore((state) => state.mode)
  const currentModeRef = useRef(currentMode)
  const setDirty = useAppStore((state) => state.setDirty)
  const setTextAutoPlayRunning = useAppStore((state) => state.setTextAutoPlayRunning)
  const setCurrentFile = useAppStore((state) => state.setCurrentFile)
  const addRecentFile = useAppStore((state) => state.addRecentFile)
  const addRecentFolder = useAppStore((state) => state.addRecentFolder)
  const setLeaveGuard = useAppStore((state) => state.setLeaveGuard)
  const registerSessionProvider = useAppStore((state) => state.registerSessionProvider)
  const restoreSessionState = useAppStore((state) => state.restoreSessionState)

  const selectedRecord = useMemo(
    () => records.find((record) => record.id === selectedRecordId) || null,
    [records, selectedRecordId]
  )

  recordsRef.current = records
  selectedRecordIdRef.current = selectedRecordId
  lineDraftRef.current = lineDraft
  dirtyRef.current = dirty
  currentModeRef.current = currentMode

  const currentTxtFilePath = textFile?.filePath || ''

  const closeDialog = (decision) => {
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
  })

  const showAutoMessage = (message, title = 'Info', timeout = 1200) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)

    setDialog({
      title,
      message,
      actions: [{ label: 'OK', value: 'ok', primary: true }],
      autoClose: true,
    })

    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null
      closeDialog('ok')
    }, timeout)
  }

  const markRecordsChanged = (nextRecords, nextSelectionId) => {
    const selectedId = nextSelectionId ?? selectedRecordIdRef.current
    const nextSelectedRecord = nextRecords.find((record) => record.id === selectedId) || null
    const nextLineDraft = nextSelectedRecord ? recordToLine(nextSelectedRecord) : ''

    recordsRef.current = nextRecords
    selectedRecordIdRef.current = selectedId
    lineDraftRef.current = nextLineDraft
    dirtyRef.current = true
    setRecords(nextRecords)
    setSelectedRecordId(selectedId)
    setIndependentInput(nextSelectedRecord?.word || '')
    setLineDraft(nextLineDraft)
    setDirty(APP_MODES.TEXT, true)
  }

  const buildRecordFromInput = () => {
    const word = independentInput.trim()
    if (!word) {
      showAutoMessage('No word input.')
      return null
    }

    return {
      ...createEmptyRecord(),
      word,
    }
  }

  const parseLineForReplace = (line) => {
    const text = String(line ?? '').trim()
    if (!text) {
      return { ok: false, reason: 'Line is empty.' }
    }

    const separatorCount = (text.match(/\|/g) || []).length
    if (separatorCount > 0 && separatorCount !== 7) {
      return {
        ok: false,
        reason: 'Invalid line format.\nNeed 7 "|" separators when marks are used.',
      }
    }

    const record = lineToRecord(text, selectedRecord || createEmptyRecord())
    if (!record.word.trim()) {
      return { ok: false, reason: 'Word cannot be empty.' }
    }

    return {
      ok: true,
      record: {
        ...record,
        word: record.word.trim(),
      },
    }
  }

  const scrollSelectedWordIntoView = () => {
    window.requestAnimationFrame(() => {
      const row = wordListRef.current?.querySelector('.text-word-row.active')
      row?.scrollIntoView({ block: 'nearest' })
    })
  }

  useEffect(() => {
    scrollSelectedWordIntoView()
  }, [selectedRecordId])

  useEffect(() => {
    const input = independentInputRef.current
    if (!input) return

    const maxHeight = wordsTabViewMode === WORDS_TAB_VIEW_MODES.REVIEW ? 220 : 120
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, maxHeight)}px`
    input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [independentInput, wordsTabViewMode])

  useEffect(() => {
    const lowerPanel = wordListLowerRef.current
    const toolbar = wordCommandToolbarRef.current
    if (!lowerPanel || !toolbar) return undefined
    let animationFrameId = 0

    const updateToolbarLayout = () => {
      if (activeTab !== TEXT_TABS.WORDS || !lowerPanel.isConnected || !toolbar.isConnected) return

      const buttonCount = toolbar.querySelectorAll('.text-tool-button').length
      const buttonWidth = 28
      const buttonHeight = 25
      const gap = 5
      const horizontalPadding = 0
      const availableHeight = Math.floor(lowerPanel.getBoundingClientRect().height)
      if (availableHeight < 60) return

      const rowsPerColumn = Math.max(1, Math.floor((availableHeight + gap) / (buttonHeight + gap)))
      const columns = Math.max(2, Math.ceil(buttonCount / rowsPerColumn))
      const width = (columns * buttonWidth) + ((columns - 1) * gap) + horizontalPadding
      setWordToolbarLayout((current) => (
        current.columns === columns && current.width === width
          ? current
          : { columns, width }
      ))
    }

    const scheduleToolbarLayoutUpdate = () => {
      if (animationFrameId) window.cancelAnimationFrame(animationFrameId)
      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = 0
        updateToolbarLayout()
      })
    }

    scheduleToolbarLayoutUpdate()

    if (!window.ResizeObserver) {
      window.addEventListener('resize', scheduleToolbarLayoutUpdate)
      return () => {
        if (animationFrameId) window.cancelAnimationFrame(animationFrameId)
        window.removeEventListener('resize', scheduleToolbarLayoutUpdate)
      }
    }

    const resizeObserver = new ResizeObserver(scheduleToolbarLayoutUpdate)
    resizeObserver.observe(lowerPanel)
    return () => {
      if (animationFrameId) window.cancelAnimationFrame(animationFrameId)
      resizeObserver.disconnect()
    }
  }, [activeTab, wordsTabViewMode])

  useEffect(() => {
    const nextLineDraft = selectedRecord ? recordToLine(selectedRecord) : ''
    setIndependentInput(selectedRecord?.word || '')
    lineDraftRef.current = nextLineDraft
    setLineDraft(nextLineDraft)
  }, [selectedRecordId])

  useEffect(() => {
    if (!specialTextFolder) {
      setSpecialFolderPath('')
      setSpecialTxtFiles([])
      setSpecialTextFile(null)
      return undefined
    }
    if (!window.textApi?.listTxtFiles) {
      window.debugApi?.log('Special Text Folder: list TXT API is not available.')
      return undefined
    }

    let canceled = false
    window.textApi.listTxtFiles(specialTextFolder).then((result) => {
      if (canceled) return
      if (!result?.ok) {
        window.debugApi?.log(`Special Text Folder load failed: ${specialTextFolder}`)
        return
      }

      const nextFiles = Array.isArray(result.txtFiles) ? result.txtFiles : []
      setSpecialFolderPath(result.folderPath || specialTextFolder)
      setSpecialTxtFiles(nextFiles)
      const firstFile = nextFiles[0] || null
      setSpecialTextFile(firstFile ? {
        filePath: firstFile.filePath,
        fileName: firstFile.fileName,
        folderPath: result.folderPath || specialTextFolder,
        encoding: firstFile.encoding,
      } : null)
      if (nextFiles.length === 0) {
        window.debugApi?.log(`Special Text Folder has no TXT files: ${result.folderPath || specialTextFolder}`)
      }
    })

    return () => {
      canceled = true
    }
  }, [specialTextFolder])

  useEffect(() => {
    window.requestAnimationFrame(() => {
      const currentRow = currentTxtListRef.current?.querySelector('.text-file-row.active')
      const recentRow = recentTxtListRef.current?.querySelector('.text-file-row.active')
      currentRow?.scrollIntoView({ block: 'nearest' })
      recentRow?.scrollIntoView({ block: 'nearest' })
    })
  }, [currentTxtFilePath, selectedRecentPath])

  useEffect(() => {
    if (dialog && !dialog.autoClose) {
      window.requestAnimationFrame(() => dialogLayerRef.current?.focus())
    }
  }, [dialog])

  useEffect(() => {
    if (!inputContextMenu) return undefined

    const closeInputContextMenu = () => setInputContextMenu(null)
    window.addEventListener('mousedown', closeInputContextMenu)
    window.addEventListener('resize', closeInputContextMenu)
    window.addEventListener('scroll', closeInputContextMenu, true)
    return () => {
      window.removeEventListener('mousedown', closeInputContextMenu)
      window.removeEventListener('resize', closeInputContextMenu)
      window.removeEventListener('scroll', closeInputContextMenu, true)
    }
  }, [inputContextMenu])

  const replaceIndependentInput = (nextText, selectionStart = null, selectionEnd = null) => {
    setIndependentInput(nextText)
    window.requestAnimationFrame(() => {
      const input = independentInputRef.current
      if (!input) return
      input.focus()
      if (selectionStart !== null && selectionEnd !== null) {
        input.setSelectionRange(selectionStart, selectionEnd)
      }
    })
  }

  const showIndependentInputMenu = (x, y) => {
    setInputContextMenu({
      x: Math.max(6, Math.min(x, window.innerWidth - 174)),
      y: Math.max(6, Math.min(y, window.innerHeight - 150)),
    })
  }

  const handleIndependentInputContextMenu = (event) => {
    event.preventDefault()
    event.stopPropagation()
    showIndependentInputMenu(event.clientX, event.clientY)
  }

  const handleIndependentInputKeyDown = (event) => {
    if (event.key === 'Escape' && inputContextMenu) {
      event.preventDefault()
      setInputContextMenu(null)
      return
    }

    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    event.preventDefault()
    event.stopPropagation()
    const rect = independentInputRef.current?.getBoundingClientRect()
    showIndependentInputMenu((rect?.left || 0) + 16, (rect?.top || 0) + 16)
  }

  const wrapIndependentSelectionWithParentheses = () => {
    const input = independentInputRef.current
    if (!input) return

    const start = input.selectionStart
    const end = input.selectionEnd
    if (start === end) {
      showAutoMessage('No selected text.')
      setInputContextMenu(null)
      return
    }

    const nextText = `${independentInput.slice(0, start)}(${independentInput.slice(start, end)})${independentInput.slice(end)}`
    replaceIndependentInput(nextText, start, end + 2)
    setInputContextMenu(null)
  }

  const removeIndependentInputLineBreaks = () => {
    const input = independentInputRef.current
    const start = input?.selectionStart ?? independentInput.length
    const beforeCursor = independentInput.slice(0, start)
    const nextText = independentInput.replace(/[\r\n]+/g, '')
    const nextCursor = beforeCursor.replace(/[\r\n]+/g, '').length
    replaceIndependentInput(nextText, nextCursor, nextCursor)
    setInputContextMenu(null)
  }

  const getIndependentInputWithoutLineBreaks = () => {
    const cursor = independentInputRef.current?.selectionStart ?? independentInput.length
    const beforeCursor = independentInput.slice(0, cursor)
    return {
      text: independentInput.replace(/[\r\n]+/g, ''),
      cursor: beforeCursor.replace(/[\r\n]+/g, '').length,
    }
  }

  const formatIndependentInputNote = () => {
    const normalized = getIndependentInputWithoutLineBreaks()
    const nextText = formatWordAnnotationText(normalized.text, normalized.cursor)
    replaceIndependentInput(nextText, nextText.length, nextText.length)
    setInputContextMenu(null)
  }

  const formatIndependentInputPattern = () => {
    const normalized = getIndependentInputWithoutLineBreaks()
    const head = normalized.text.slice(0, normalized.cursor).trim()
    const tail = normalized.text.slice(normalized.cursor)
    const nextText = `${head ? `[${head}]` : ''}${tail}`
    replaceIndependentInput(nextText, nextText.length, nextText.length)
    setInputContextMenu(null)
  }

  const toggleWordsTabView = () => {
    setWordsTabViewMode((current) => {
      const nextMode = current === WORDS_TAB_VIEW_MODES.REVIEW
        ? WORDS_TAB_VIEW_MODES.INPUT
        : WORDS_TAB_VIEW_MODES.REVIEW
      window.appApi?.dockTextModeWindow?.({
        scale: nextMode === WORDS_TAB_VIEW_MODES.REVIEW ? 1.5 : 1,
      })
      return nextMode
    })
  }

  const applyTextFileInfo = (info) => {
    if (!info?.ok) {
      showAutoMessage('Could not open TXT file.')
      return []
    }

    const nextRecords = Array.isArray(info.records) ? info.records : []
    setTextFile({
      filePath: info.filePath,
      fileName: info.fileName,
      folderPath: info.folderPath,
      encoding: info.encoding,
    })
    setCurrentFolderPath(info.folderPath || '')
    setTxtFiles(Array.isArray(info.txtFiles) ? info.txtFiles : [])
    recordsRef.current = nextRecords
    selectedRecordIdRef.current = nextRecords[0]?.id || null
    setRecords(nextRecords)
    setSelectedRecordId(nextRecords[0]?.id || null)
    setIndependentInput(nextRecords[0]?.word || '')
    const nextLineDraft = nextRecords[0] ? recordToLine(nextRecords[0]) : ''
    lineDraftRef.current = nextLineDraft
    setLineDraft(nextLineDraft)
    setCurrentFile(info.filePath || null)
    dirtyRef.current = false
    setDirty(APP_MODES.TEXT, false)

    if (info.filePath) {
      addRecentFile(APP_MODES.TEXT, info.filePath)
      setSelectedRecentPath(info.filePath)
    }
    if (info.folderPath) {
      addRecentFolder(APP_MODES.TEXT, info.folderPath)
    }

    return nextRecords
  }

  const saveTextFile = async ({ silent = false } = {}) => {
    if (!currentTxtFilePath || !window.textApi?.saveTextFile) {
      showAutoMessage('No TXT file opened.')
      return false
    }

    const result = await window.textApi.saveTextFile(currentTxtFilePath, recordsRef.current)
    if (!result?.ok) {
      showAutoMessage('Save failed.')
      return false
    }

    setDirty(APP_MODES.TEXT, false)
    dirtyRef.current = false
    if (!silent) showAutoMessage('TXT file saved.')
    return true
  }

  const confirmBeforeLeave = async () => {
    if (!dirtyRef.current) return true

    const decision = await showActionDialog({
      title: 'Unsaved text changes',
      message: 'The current word file has unsaved changes.',
      defaultValue: 'save',
      cancelValue: 'cancel',
      actions: [
        { label: 'Save', value: 'save', primary: true },
        { label: 'Discard', value: 'discard', danger: true },
        { label: 'Cancel', value: 'cancel' },
      ],
    })

    if (decision === 'save') return saveTextFile({ silent: true })
    if (decision === 'discard') {
      dirtyRef.current = false
      setDirty(APP_MODES.TEXT, false)
      return true
    }
    return false
  }

  leaveGuardHandlerRef.current = confirmBeforeLeave

  useEffect(() => {
    setLeaveGuard(APP_MODES.TEXT, () => leaveGuardHandlerRef.current?.() ?? true)
    return () => setLeaveGuard(APP_MODES.TEXT, null)
  }, [setLeaveGuard])

  useEffect(() => {
    registerSessionProvider(APP_MODES.TEXT, () => ({
      activeTab,
      wordsTabViewMode,
      currentTxtFilePath,
      currentFolderPath,
      selectedRecordIndex: recordsRef.current.findIndex((record) => record.id === selectedRecordIdRef.current),
      specialTextFilePath: specialTextFile?.filePath || '',
      specialFolderPath,
    }))
    return () => registerSessionProvider(APP_MODES.TEXT, null)
  }, [
    activeTab,
    currentFolderPath,
    currentTxtFilePath,
    registerSessionProvider,
    specialFolderPath,
    specialTextFile?.filePath,
    wordsTabViewMode,
  ])

  useEffect(() => {
    const snapshot = restoreSessionState?.modes?.text
    if (!snapshot) return

    if (Object.values(TEXT_TABS).includes(snapshot.activeTab)) {
      setActiveTab(snapshot.activeTab)
    }
    if (Object.values(WORDS_TAB_VIEW_MODES).includes(snapshot.wordsTabViewMode)) {
      setWordsTabViewMode(snapshot.wordsTabViewMode)
      if (currentModeRef.current === APP_MODES.TEXT) {
        window.appApi?.dockTextModeWindow?.({
          scale: snapshot.wordsTabViewMode === WORDS_TAB_VIEW_MODES.REVIEW ? 1.5 : 1,
        })
      }
    }

    if (snapshot.specialFolderPath) {
      setSpecialFolderPath(snapshot.specialFolderPath)
    }

    if (snapshot.specialTextFilePath && window.textApi?.readTextFile) {
      window.textApi.readTextFile(snapshot.specialTextFilePath).then((info) => {
        if (info?.ok) applySpecialTextFileInfo(info)
      })
    }

    if (snapshot.currentTxtFilePath && window.textApi?.readTextFile) {
      window.textApi.readTextFile(snapshot.currentTxtFilePath).then((info) => {
        if (!info?.ok) return
        const nextRecords = Array.isArray(info.records) ? info.records : []
        applyTextFileInfo(info)
        const nextIndex = Math.max(0, Math.min(Number(snapshot.selectedRecordIndex) || 0, nextRecords.length - 1))
        const nextRecord = nextRecords[nextIndex] || null
        selectedRecordIdRef.current = nextRecord?.id || null
        setSelectedRecordId(nextRecord?.id || null)
      })
    }
  }, [restoreSessionState])

  const openTextFile = async () => {
    if (!window.textApi?.openTextFile) return
    if (!(await confirmBeforeLeave())) return

    const info = await window.textApi.openTextFile()
    if (!info?.canceled) applyTextFileInfo(info)
  }

  const openCurrentTextFileExternal = async () => {
    if (!currentTxtFilePath || !window.textApi?.openTextFileExternal) {
      showAutoMessage('No TXT file opened.')
      return
    }

    const result = await window.textApi.openTextFileExternal(currentTxtFilePath)
    if (!result?.ok) showAutoMessage('Could not open TXT file with default app.')
  }

  const loadTextFilePath = async (filePath) => {
    if (!filePath || !window.textApi?.readTextFile) return
    if (!(await confirmBeforeLeave())) return

    const info = await window.textApi.readTextFile(filePath)
    applyTextFileInfo(info)
  }

  const loadTextFilePathForAutoLookup = async (filePath) => {
    if (!filePath || !window.textApi?.readTextFile) {
      return { ok: false, reason: 'text-read-api-not-available', records: [] }
    }

    const info = await window.textApi.readTextFile(filePath)
    if (!info?.ok) {
      return { ok: false, reason: info?.reason || 'read-text-file-failed', records: [] }
    }

    const nextRecords = applyTextFileInfo(info)
    return { ok: true, records: nextRecords }
  }

  const reloadCurrentTextFile = async () => {
    if (!currentTxtFilePath || !window.textApi?.readTextFile) {
      showAutoMessage('No TXT file opened.')
      return
    }

    const currentIndex = recordsRef.current.findIndex((record) => record.id === selectedRecordIdRef.current)
    const currentWord = currentIndex >= 0 ? recordsRef.current[currentIndex]?.word : ''

    if (!(await confirmBeforeLeave())) return

    const info = await window.textApi.readTextFile(currentTxtFilePath)
    if (!info?.ok) {
      showAutoMessage('Reload failed.')
      return
    }

    const nextRecords = Array.isArray(info.records) ? info.records : []
    let nextIndex = currentWord
      ? nextRecords.findIndex((record) => record.word === currentWord)
      : -1
    if (nextIndex < 0) {
      nextIndex = Math.max(0, Math.min(currentIndex, nextRecords.length - 1))
    }
    const nextSelectionId = nextRecords[nextIndex]?.id || null

    setTextFile({
      filePath: info.filePath,
      fileName: info.fileName,
      folderPath: info.folderPath,
      encoding: info.encoding,
    })
    setCurrentFolderPath(info.folderPath || '')
    setTxtFiles(Array.isArray(info.txtFiles) ? info.txtFiles : [])
    recordsRef.current = nextRecords
    selectedRecordIdRef.current = nextSelectionId
    setRecords(nextRecords)
    setSelectedRecordId(nextSelectionId)
    setIndependentInput(nextRecords[nextIndex]?.word || '')
    const nextLineDraft = nextRecords[nextIndex] ? recordToLine(nextRecords[nextIndex]) : ''
    lineDraftRef.current = nextLineDraft
    setLineDraft(nextLineDraft)
    dirtyRef.current = false
    setDirty(APP_MODES.TEXT, false)
    showAutoMessage('TXT file reloaded.')
  }

  const applySpecialTextFileInfo = (info) => {
    if (!info?.ok) {
      showAutoMessage('Could not open special TXT file.')
      return
    }

    setSpecialTextFile({
      filePath: info.filePath,
      fileName: info.fileName,
      folderPath: info.folderPath,
      encoding: info.encoding,
    })
    setSpecialFolderPath(info.folderPath || '')
    setSpecialTxtFiles(Array.isArray(info.txtFiles) ? info.txtFiles : [])
  }

  const openSpecialTextFile = async () => {
    if (!window.textApi?.openTextFile) {
      showAutoMessage('Open TXT API is not available.')
      return
    }

    const info = await window.textApi.openTextFile()
    if (!info?.canceled) applySpecialTextFileInfo(info)
  }

  const loadSpecialTextFilePath = async (filePath) => {
    if (!filePath || !window.textApi?.readTextFile) return

    const info = await window.textApi.readTextFile(filePath)
    applySpecialTextFileInfo(info)
  }

  const openSpecialTextFileExternal = async () => {
    if (!specialTextFile?.filePath || !window.textApi?.openTextFileExternal) {
      showAutoMessage('No special TXT file selected.')
      return
    }

    const result = await window.textApi.openTextFileExternal(specialTextFile.filePath)
    if (!result?.ok) showAutoMessage('Could not open special TXT file with default app.')
  }

  const buildIndependentInputLine = () => {
    const line = independentInput.replace(/[\r\n]+/g, '').trim()
    if (!line) {
      showAutoMessage('No content.')
      return ''
    }
    return line
  }

  const saveToSpecificFile = async () => {
    const line = buildIndependentInputLine()
    if (!line) return
    if (!specialTextFile?.filePath) {
      showAutoMessage('No special TXT file selected.')
      return
    }
    if (!window.textApi?.appendTextLine) {
      showAutoMessage('Append TXT API is not available.')
      return
    }

    const result = await window.textApi.appendTextLine(specialTextFile.filePath, line)
    if (!result?.ok) {
      showAutoMessage(`SaveToSpecificFile failed: ${result?.reason || 'unknown error'}`)
      return
    }

    setIndependentInput('')
    window.debugApi?.log(`SaveToSpecificFile: ${result.filePath || specialTextFile.filePath}`)
    showAutoMessage('Saved.')
  }

  const saveToMonthlyNoteFile = async (kind) => {
    const line = buildIndependentInputLine()
    if (!line) return
    if (!monthlyNotesFolder) {
      showAutoMessage('Monthly Text Folder is not set.')
      return
    }
    if (!window.textApi?.appendMonthlyNoteLine) {
      showAutoMessage('Monthly append API is not available.')
      return
    }

    const result = await window.textApi.appendMonthlyNoteLine({
      kind,
      folderPath: monthlyNotesFolder,
      line,
    })
    if (!result?.ok) {
      showAutoMessage(`SaveTo${kind === 'zh' ? 'Zh' : 'En'} failed: ${result?.reason || 'unknown error'}`)
      return
    }

    setIndependentInput('')
    window.debugApi?.log(`SaveTo${kind === 'zh' ? 'Zh' : 'En'}: ${result.targetPath || result.filePath}`)
    showAutoMessage('Saved.')
  }

  const saveToEn = () => saveToMonthlyNoteFile('en')

  const saveToZh = () => saveToMonthlyNoteFile('zh')

  const getLookupWord = (explicitWord) => {
    const directWord = String(explicitWord || '').trim()
    if (directWord) return directWord
    const inputWord = independentInput.trim()
    if (inputWord) return inputWord
    return (selectedRecord?.word || '').trim()
  }

  const showDictionaryLookupError = async (reason, dictionaryName) => {
    const baseMessage = getDictionaryErrorMessage(reason, dictionaryName)
    if (!window.textApi?.findDictionaryWindows) {
      showAutoMessage(baseMessage, 'Dictionary not found', 3500)
      return
    }

    const result = await window.textApi.findDictionaryWindows()
    const candidates = formatDictionaryWindowCandidates(result?.windows)
    showAutoMessage(`${baseMessage}\n\nCandidates:\n${candidates}`, 'Dictionary not found', 6000)
  }

  const lookupMDictWord = async (explicitWord) => {
    const word = getLookupWord(explicitWord)
    if (!word) {
      showAutoMessage('No word to lookup.')
      return { ok: false, reason: 'empty-word' }
    }
    const mdictApi = window.textApi?.lookupMDictRestore || window.textApi?.lookupMDict
    if (!mdictApi) {
      showAutoMessage('MDict lookup API is not available.')
      return { ok: false, reason: 'api-not-available' }
    }
    if (!window.textApi?.lookupMDictRestore) {
      window.debugApi?.log('MDict restore API is not available, fallback to normal MDict lookup.')
    }

    const result = await mdictApi(word)
    if (!result?.ok) {
      showDictionaryLookupError(result?.reason, 'MDict')
    }
    return result
  }

  const cycleMDictDictionary = async () => {
    if (!window.textApi?.cycleMDictDictionary) {
      showAutoMessage('MDict cycle API is not available.')
      return
    }

    const result = await window.textApi.cycleMDictDictionary()
    window.setTimeout(() => {
      window.appApi?.focusMainWindow?.()
    }, 120)
    if (!result?.ok) {
      showDictionaryLookupError(result?.reason, 'MDict')
      return
    }

    window.debugApi?.log(`Rotate Dict: ${result.commandIdHex || ''}`)
  }

  const lookupWebsterWord = async (explicitWord) => {
    const word = getLookupWord(explicitWord)
    if (!word) {
      showAutoMessage('No word to lookup.')
      return { ok: false, reason: 'empty-word' }
    }
    if (!window.textApi?.lookupWebsterAndRead) {
      showAutoMessage('Webster lookup API is not available.')
      return { ok: false, reason: 'api-not-available' }
    }

    const result = await window.textApi.lookupWebsterAndRead(word)
    if (!result?.ok) {
      showDictionaryLookupError(result?.reason, 'Webster')
    }
    return result
  }

  const captureWebsterOutput = async () => {
    if (!window.textApi?.captureWebsterOutput) {
      showAutoMessage('Webster capture API is not available.')
      return
    }

    const result = await window.textApi.captureWebsterOutput()
    if (!result?.ok) {
      const detail = result?.detail ? `\n${result.detail}` : ''
      const ahkReason = result?.ahkResult?.reason ? `\nAHK: ${result.ahkResult.reason}` : ''
      showAutoMessage(`Webster capture failed: ${result?.reason || 'unknown error'}${ahkReason}${detail}`, 'Capture', 6000)
      return
    }

    showAutoMessage(`Captured: ${result.imagePath}`, 'Capture', 2500)
  }

  const detectWebsterBlueText = async () => {
    if (!window.textApi?.detectWebsterBlueText) {
      showAutoMessage('Webster blue detector API is not available.')
      return
    }

    const result = await window.textApi.detectWebsterBlueText()
    if (!result?.ok) {
      const detail = result?.detail ? `\n${result.detail}` : ''
      showAutoMessage(`Blue detection failed: ${result?.reason || 'unknown error'}${detail}`, 'Blue', 6000)
      return
    }

    const areaLines = (result.areas || []).map((area, index) => (
      `${index + 1}: client ${area.clientX},${area.clientY} screen ${area.screenX},${area.screenY}`
    ))
    window.debugApi?.log(`Blue areas: ${result.areas?.length || 0}${areaLines.length ? `\n${areaLines.join('\n')}` : ''}`)
  }

  const clickWebsterBlueText = async () => {
    if (!window.textApi?.clickWebsterBlueText) {
      showAutoMessage('Webster blue click API is not available.')
      return
    }

    const result = await window.textApi.clickWebsterBlueText('last')
    if (!result?.ok) {
      const detail = result?.detail ? `\n${result.detail}` : ''
      showAutoMessage(`Blue click failed: ${result?.reason || 'unknown error'}${detail}`, 'Blue', 6000)
      return
    }

    window.debugApi?.log(`Blue clicked: client ${result.clientX},${result.clientY}`)
  }

  const clearAutoLookupTimer = () => {
    if (autoLookupTimerRef.current) {
      clearTimeout(autoLookupTimerRef.current)
      autoLookupTimerRef.current = null
    }
  }

  const stopAutoLookup = (showMessage = true) => {
    clearAutoLookupTimer()
    autoLookupRunningRef.current = false
    setAutoLookupRunning(false)
    setTextAutoPlayRunning(false)
    if (showMessage) window.debugApi?.log('Auto lookup stopped.')
  }

  const markAutoLookupError = (message) => {
    setAutoLookupError(true)
    window.debugApi?.log(message)
  }

  const selectRecordForAutoLookup = (record) => {
    const nextLineDraft = record ? recordToLine(record) : ''
    selectedRecordIdRef.current = record?.id || null
    lineDraftRef.current = nextLineDraft
    setSelectedRecordId(record?.id || null)
    setIndependentInput(record?.word || '')
    setLineDraft(nextLineDraft)
  }

  const sendWordToConfiguredDicts = (word, sourceLabel, positionText = '', options = {}) => {
    const tasks = []
    const useMDict = !options.skipMDict && textAutoPlayDicts?.mdict !== false
    const useWebster = textAutoPlayDicts?.webster !== false
    const prefix = `${sourceLabel} error`

    if (useMDict) {
      const mdictApi = options.restoreMDict
        ? window.textApi?.lookupMDictRestore
        : window.textApi?.lookupMDict
      if (mdictApi) {
        tasks.push({ name: 'MDict', promise: mdictApi(word) })
      } else {
        markAutoLookupError(`${prefix}: MDict API is not available for "${word}".`)
      }
    }

    if (useWebster) {
      const websterApi = websterSpellOut ? window.textApi?.lookupWebsterAndRead : window.textApi?.lookupWebster
      if (websterApi) {
        tasks.push({ name: 'Webster', promise: websterApi(word) })
      } else {
        markAutoLookupError(`${prefix}: Webster API is not available for "${word}".`)
      }
    }

    if (!useMDict && !useWebster) {
      const message = `${prefix}: no target dictionary selected for "${word}".`
      if (options.silentNoTargets) {
        window.debugApi?.log(message)
      } else {
        markAutoLookupError(message)
      }
      return
    }

    window.debugApi?.log(`${sourceLabel}: ${positionText ? `${positionText} ` : ''}${word}`)
    Promise.allSettled(tasks.map((task) => task.promise)).then((results) => {
      results.forEach((result, index) => {
        const targetName = tasks[index]?.name || 'Dictionary'
        if (result.status === 'rejected') {
          markAutoLookupError(`${prefix}: ${targetName} rejected for "${word}". ${result.reason?.message || result.reason || ''}`)
          return
        }
        if (!result.value?.ok) {
          markAutoLookupError(`${prefix}: ${targetName} failed for "${word}". ${result.value?.reason || 'unknown error'}`)
        }
      })
    })
  }

  const sendWordForAutoLookup = (word, positionText) => {
    sendWordToConfiguredDicts(word, 'Auto lookup', positionText)
  }

  const scheduleNextAutoLookup = (fileIndex, wordIndex) => {
    const delayMs = Number(textAutoLookupDelayMs) || 1500
    autoLookupTimerRef.current = setTimeout(() => sendAutoLookupAt(fileIndex, wordIndex), delayMs)
  }

  const moveToNextTextFileForAutoLookup = async (fileIndex) => {
    if (!textAutoPlayAll || fileIndex < 0) {
      stopAutoLookup(false)
      window.debugApi?.log('Auto lookup finished.')
      return
    }

    if (dirtyRef.current) {
      markAutoLookupError('Auto lookup stopped: current word file has unsaved changes.')
      stopAutoLookup(false)
      return
    }

    for (let nextFileIndex = fileIndex + 1; nextFileIndex < txtFiles.length; nextFileIndex += 1) {
      if (!autoLookupRunningRef.current) return

      const nextFile = txtFiles[nextFileIndex]
      const nextFilePath = nextFile?.filePath || joinPath(currentFolderPath, nextFile?.fileName)
      const result = await loadTextFilePathForAutoLookup(nextFilePath)
      if (!autoLookupRunningRef.current) return

      if (!result.ok) {
        markAutoLookupError(`Auto lookup error: could not load ${nextFilePath}. ${result.reason || ''}`)
        continue
      }
      if (result.records.length === 0) {
        markAutoLookupError(`Auto lookup error: ${nextFilePath} has no words.`)
        continue
      }

      autoLookupContextRef.current = { fileIndex: nextFileIndex, wordIndex: 0 }
      scheduleNextAutoLookup(nextFileIndex, 0)
      return
    }

    stopAutoLookup(false)
    window.debugApi?.log('Auto lookup finished.')
  }

  const sendAutoLookupAt = (fileIndex, wordIndex) => {
    if (!autoLookupRunningRef.current) return

    const items = recordsRef.current
    if (wordIndex >= items.length) {
      moveToNextTextFileForAutoLookup(fileIndex)
      return
    }

    const record = items[wordIndex]
    selectRecordForAutoLookup(record)
    const word = (record?.word || '').trim()

    const skipReason = getAutoPlaySkipReason(word)
    if (skipReason) {
      window.debugApi?.log(`Auto lookup skipped: ${word || '(empty)'} (${skipReason})`)
    } else if (word) {
      sendWordForAutoLookup(word, `${wordIndex + 1}/${items.length}`)
    } else {
      markAutoLookupError(`Auto lookup error: empty word at ${wordIndex + 1}/${items.length}.`)
    }

    autoLookupContextRef.current = { fileIndex, wordIndex: wordIndex + 1 }
    scheduleNextAutoLookup(fileIndex, wordIndex + 1)
  }

  const startAutoLookup = () => {
    const items = recordsRef.current
    if (items.length === 0) {
      showAutoMessage('No words loaded.')
      return
    }

    const selectedIndex = items.findIndex((record) => record.id === selectedRecordIdRef.current)
    if (selectedIndex < 0) {
      showAutoMessage('No selected word.')
      return
    }

    clearAutoLookupTimer()
    autoLookupRunningRef.current = true
    setAutoLookupRunning(true)
    setTextAutoPlayRunning(true)
    setAutoLookupError(false)
    const fileIndex = txtFiles.findIndex((file) => (
      (file.filePath || joinPath(currentFolderPath, file.fileName)) === currentTxtFilePath
    ))
    const startFileIndex = fileIndex >= 0 ? fileIndex : -1
    autoLookupContextRef.current = { fileIndex: startFileIndex, wordIndex: selectedIndex }
    window.debugApi?.log(`Auto lookup started at ${selectedIndex + 1}/${items.length}.`)
    sendAutoLookupAt(startFileIndex, selectedIndex)
  }

  const selectWordByCommandOffset = (offset) => {
    if (autoLookupRunningRef.current) return

    const items = recordsRef.current
    if (items.length === 0) return

    const currentIndex = items.findIndex((record) => record.id === selectedRecordIdRef.current)
    const baseIndex = currentIndex >= 0 ? currentIndex : 0
    const nextIndex = Math.max(0, Math.min(items.length - 1, baseIndex + offset))
    if (nextIndex === currentIndex) return

    selectedRecordIdRef.current = items[nextIndex]?.id || null
    setSelectedRecordId(items[nextIndex]?.id || null)
  }

  const selectPreviousWord = () => {
    selectWordByCommandOffset(-1)
  }

  const selectNextWord = () => {
    selectWordByCommandOffset(1)
  }

  const lookupRecordWord = (record) => {
    const selected = record || recordsRef.current.find((item) => item.id === selectedRecordIdRef.current)
    const word = (selected?.word || '').trim()
    if (!word) {
      showAutoMessage('No selected word.')
      return
    }

    setAutoLookupError(false)
    sendWordToConfiguredDicts(word, 'LookUp', '', { restoreMDict: true })
  }

  const lookupSelectedWord = () => {
    lookupRecordWord()
  }

  const pasteAndLookupWord = async () => {
    if (!window.textApi?.readClipboardText) {
      showAutoMessage('Clipboard API is not available.')
      return
    }

    const word = String(await window.textApi.readClipboardText()).trim()
    if (!word) {
      showAutoMessage('Clipboard is empty.')
      return
    }

    setIndependentInput(word)
    setAutoLookupError(false)
    sendWordToConfiguredDicts(word, 'Paste & LookUp', '', { restoreMDict: true })
  }

  const getMDictThenLookupWord = async () => {
    if (!window.textApi?.getMDictInputText) {
      showAutoMessage('MDict text API is not available.')
      return
    }

    const result = await window.textApi.getMDictInputText()
    if (!result?.ok) {
      showDictionaryLookupError(result?.reason, 'MDict')
      return
    }

    const word = String(result.text || '').trim()
    if (!word) return

    if (/\s/.test(word)) {
      const decision = await showActionDialog({
        title: 'MDict text contains spaces',
        message: `Continue lookup?\n${word}`,
        defaultValue: 'continue',
        cancelValue: 'cancel',
        actions: [
          { label: 'Continue', value: 'continue', primary: true },
          { label: 'Cancel', value: 'cancel' },
        ],
      })
      if (decision !== 'continue') return
    }

    setIndependentInput(word)
    setAutoLookupError(false)
    sendWordToConfiguredDicts(word, 'Get MDict then Lookup', '', {
      skipMDict: true,
      silentNoTargets: true,
    })
  }

  useEffect(() => () => {
    if (autoLookupTimerRef.current) clearTimeout(autoLookupTimerRef.current)
    autoLookupTimerRef.current = null
    autoLookupRunningRef.current = false
    setTextAutoPlayRunning(false)
  }, [setTextAutoPlayRunning])

  const intoEditingFocus = () => {
    const independentInput = independentInputRef.current
    const lineDraftInput = lineDraftInputRef.current
    if (!independentInput) return

    const focusIndependentInput = () => {
      independentInput.focus()
      independentInput.selectionStart = independentInput.selectionEnd = independentInput.value.length
    }

    const focusLineDraftInput = () => {
      if (!lineDraftInput || lineDraftInput.disabled) {
        focusIndependentInput()
        return
      }

      lineDraftInput.focus()
      lineDraftInput.selectionStart = lineDraftInput.selectionEnd = lineDraftInput.value.length
    }

    if (document.activeElement === independentInput) {
      focusLineDraftInput()
      return
    }

    if (document.activeElement === lineDraftInput) {
      focusIndependentInput()
      return
    }

    focusIndependentInput()
  }

  const loadFolderPath = async (folderPath) => {
    if (!folderPath || !window.textApi?.listTxtFiles) return
    if (!(await confirmBeforeLeave())) return

    const result = await window.textApi.listTxtFiles(folderPath)
    if (!result?.ok) {
      showAutoMessage('Could not list TXT files.')
      return
    }

    setCurrentFolderPath(result.folderPath || folderPath)
    setTxtFiles(Array.isArray(result.txtFiles) ? result.txtFiles : [])
    addRecentFolder(APP_MODES.TEXT, result.folderPath || folderPath)
  }

  const insertRecord = async () => {
    const newRecord = buildRecordFromInput()
    if (!newRecord) return

    const selectedIndex = recordsRef.current.findIndex((record) => record.id === selectedRecordIdRef.current)
    if (selectedIndex < 0) {
      const decision = await showActionDialog({
        title: 'No selected word',
        message: 'Append to the end?',
        defaultValue: 'append',
        cancelValue: 'cancel',
        actions: [
          { label: 'Append', value: 'append', primary: true },
          { label: 'Cancel', value: 'cancel' },
        ],
      })

      if (decision !== 'append') return
      markRecordsChanged([...recordsRef.current, newRecord], newRecord.id)
      return
    }

    const nextRecords = [
      ...recordsRef.current.slice(0, selectedIndex + 1),
      newRecord,
      ...recordsRef.current.slice(selectedIndex + 1),
    ]

    markRecordsChanged(nextRecords, newRecord.id)
  }

  const appendRecord = () => {
    const newRecord = buildRecordFromInput()
    if (!newRecord) return

    markRecordsChanged([...recordsRef.current, newRecord], newRecord.id)
  }

  const replaceRecordWord = () => {
    const word = independentInput.trim()
    if (!word) {
      showAutoMessage('No word input.')
      return
    }
    if (!selectedRecordIdRef.current) {
      showAutoMessage('No selected word.')
      return
    }

    const nextRecords = recordsRef.current.map((record) => (
      record.id === selectedRecordIdRef.current
        ? { ...record, word }
        : record
    ))

    markRecordsChanged(nextRecords, selectedRecordIdRef.current)
  }

  const deleteRecord = async () => {
    if (!selectedRecordId) return

    const decision = await showActionDialog({
      title: 'Delete word',
      message: 'Delete the selected word record?',
      defaultValue: 'delete',
      cancelValue: 'cancel',
      actions: [
        { label: 'Delete', value: 'delete', danger: true },
        { label: 'Cancel', value: 'cancel' },
      ],
    })

    if (decision !== 'delete') return

    const selectedIndex = recordsRef.current.findIndex((record) => record.id === selectedRecordIdRef.current)
    const nextItems = recordsRef.current.filter((record) => record.id !== selectedRecordIdRef.current)
    const nextSelection = nextItems[Math.min(selectedIndex, nextItems.length - 1)]?.id || null
    markRecordsChanged(nextItems, nextSelection)
  }

  const replaceCurrentLine = () => {
    if (!selectedRecordIdRef.current) {
      showAutoMessage('No selected word.')
      return
    }

    const parsed = parseLineForReplace(lineDraftRef.current)
    if (!parsed.ok) {
      showAutoMessage(parsed.reason, 'Invalid line', 2600)
      return
    }

    const nextRecords = recordsRef.current.map((record) => (
      record.id === selectedRecordIdRef.current
        ? { ...parsed.record, id: record.id }
        : record
    ))

    markRecordsChanged(nextRecords, selectedRecordIdRef.current)
  }

  useEffect(() => registerActions([
    {
      id: 'text.intoEditingFocus',
      label: 'Into Editing Focus',
      scope: APP_MODES.TEXT,
      handler: intoEditingFocus,
    },
    {
      id: 'text.lookupMDict',
      label: 'MDict',
      scope: APP_MODES.TEXT,
      handler: lookupMDictWord,
    },
    {
      id: 'text.rotateMDict',
      label: 'Rotate Dict',
      scope: APP_MODES.TEXT,
      handler: cycleMDictDictionary,
    },
    {
      id: 'text.lookupWebster',
      label: 'Webster',
      scope: APP_MODES.TEXT,
      handler: lookupWebsterWord,
    },
    {
      id: 'text.lookup',
      label: 'LookUp',
      scope: APP_MODES.TEXT,
      handler: lookupSelectedWord,
    },
    {
      id: 'text.pasteAndLookup',
      label: 'Paste & LookUp',
      scope: APP_MODES.TEXT,
      handler: pasteAndLookupWord,
    },
    {
      id: 'text.getMDictThenLookup',
      label: 'Get MDict then Lookup',
      scope: APP_MODES.TEXT,
      handler: getMDictThenLookupWord,
    },
    {
      id: 'text.toggleView',
      label: 'Toggle View',
      scope: APP_MODES.TEXT,
      handler: toggleWordsTabView,
    },
    {
      id: 'text.replace',
      label: 'Replace',
      scope: APP_MODES.TEXT,
      handler: replaceRecordWord,
    },
    {
      id: 'text.replaceLine',
      label: 'Replace Line',
      scope: APP_MODES.TEXT,
      handler: replaceCurrentLine,
    },
    {
      id: 'text.captureWebster',
      label: 'Capture',
      scope: APP_MODES.TEXT,
      handler: captureWebsterOutput,
    },
    {
      id: 'text.detectBlue',
      label: 'Blue',
      scope: APP_MODES.TEXT,
      handler: detectWebsterBlueText,
    },
    {
      id: 'text.readBlue',
      label: 'ReadBlue',
      scope: APP_MODES.TEXT,
      handler: clickWebsterBlueText,
    },
    {
      id: 'text.startAutoLookup',
      label: 'Start',
      scope: APP_MODES.TEXT,
      handler: startAutoLookup,
    },
    {
      id: 'text.stopAutoLookup',
      label: 'Stop',
      scope: APP_MODES.TEXT,
      handler: stopAutoLookup,
    },
    {
      id: 'text.previousWord',
      label: 'Previous Word',
      scope: APP_MODES.TEXT,
      handler: selectPreviousWord,
    },
    {
      id: 'text.nextWord',
      label: 'Next Word',
      scope: APP_MODES.TEXT,
      handler: selectNextWord,
    },
    {
      id: 'text.saveToSpecificFile',
      label: 'SaveToSpecificFile',
      scope: APP_MODES.TEXT,
      handler: saveToSpecificFile,
    },
    {
      id: 'text.saveToEn',
      label: 'SaveToEn',
      scope: APP_MODES.TEXT,
      handler: saveToEn,
    },
    {
      id: 'text.saveToZh',
      label: 'SaveToZh',
      scope: APP_MODES.TEXT,
      handler: saveToZh,
    },
  ]), [
    lookupMDictWord,
    cycleMDictDictionary,
    lookupWebsterWord,
    captureWebsterOutput,
    detectWebsterBlueText,
    clickWebsterBlueText,
    startAutoLookup,
    stopAutoLookup,
    selectPreviousWord,
    selectNextWord,
    lookupSelectedWord,
    pasteAndLookupWord,
    getMDictThenLookupWord,
    intoEditingFocus,
    replaceCurrentLine,
    replaceRecordWord,
    saveToSpecificFile,
    saveToEn,
    saveToZh,
    toggleWordsTabView,
  ])

  const showMarksDummy = () => {
    showAutoMessage('Marks editor not implemented.')
  }

  const selectWordByOffset = async (offset) => {
    if (records.length === 0) return
    const currentIndex = Math.max(0, records.findIndex((record) => record.id === selectedRecordId))
    const nextIndex = Math.max(0, Math.min(records.length - 1, currentIndex + offset))
    await selectRecord(records[nextIndex]?.id || null)
  }

  const selectRecord = async (recordId) => {
    if (recordId === selectedRecordId) return
    setSelectedRecordId(recordId)
  }

  const handleWordListKeyDown = (event) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      selectWordByOffset(-1)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      selectWordByOffset(1)
    }
  }

  const handleDialogKeyDown = (event) => {
    if (!dialog) return
    if (event.key === 'Escape') {
      event.preventDefault()
      closeDialog(dialog.cancelValue || 'cancel')
    } else if (event.key === 'Enter') {
      event.preventDefault()
      closeDialog(dialog.defaultValue || dialog.actions?.[0]?.value || 'ok')
    }
  }

  return (
    <section className="text-mode">
      <div className="text-mode-tabs" role="tablist" aria-label="Text mode tabs">
        <button
          aria-label="Words"
          aria-selected={activeTab === TEXT_TABS.WORDS}
          className={activeTab === TEXT_TABS.WORDS ? 'text-mode-tab active' : 'text-mode-tab'}
          data-tooltip="Words"
          onClick={() => setActiveTab(TEXT_TABS.WORDS)}
          role="tab"
          type="button"
        >
          <i className="fa-solid fa-list-ul" aria-hidden="true" />
        </button>
        <button
          aria-label="Files"
          aria-selected={activeTab === TEXT_TABS.FILES}
          className={activeTab === TEXT_TABS.FILES ? 'text-mode-tab active' : 'text-mode-tab'}
          data-tooltip="Files"
          onClick={() => setActiveTab(TEXT_TABS.FILES)}
          role="tab"
          type="button"
        >
          <i className="fa-solid fa-folder-open" aria-hidden="true" />
        </button>
      </div>

      {activeTab === TEXT_TABS.WORDS ? (
        <div
          className={wordsTabViewMode === WORDS_TAB_VIEW_MODES.REVIEW
            ? 'text-words-tab review'
            : 'text-words-tab input'}
          role="tabpanel"
          style={{
            '--words-review-font-size': `${wordsReviewFontSize || 13}px`,
            '--text-list-toolbar-width': `${wordToolbarLayout.width}px`,
          }}
        >
          <section className="text-list-panel">
            <div className="text-list-upper">
              <div className="text-file-picker-row">
                <select
                  className="text-file-select"
                  onChange={(event) => loadTextFilePath(event.target.value)}
                  title={currentFolderPath}
                  value={currentTxtFilePath}
                >
                  {txtFiles.length === 0 ? (
                    <option value="">No word file opened</option>
                  ) : null}
                  {txtFiles.map((file) => (
                    <option key={file.filePath} value={file.filePath}>
                      {file.fileName}
                    </option>
                  ))}
                </select>
                <button
                  aria-label="Open with default TXT app"
                  className="text-icon-button"
                  data-tooltip="Open with default TXT app"
                  disabled={!currentTxtFilePath}
                  onClick={openCurrentTextFileExternal}
                  type="button"
                >
                  <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
                </button>
                <button
                  aria-label="Reload current TXT file"
                  className="text-icon-button"
                  data-tooltip="Reload current TXT file"
                  disabled={!currentTxtFilePath}
                  onClick={reloadCurrentTextFile}
                  type="button"
                >
                  <i className="fa-solid fa-rotate-right" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="text-list-lower" ref={wordListLowerRef}>
              <div
                className="text-word-list"
                onKeyDown={handleWordListKeyDown}
                ref={wordListRef}
                tabIndex={0}
              >
                {records.length === 0 ? (
                  <div className="text-empty-row">No words loaded</div>
                ) : records.map((record, index) => (
                  <button
                    className={record.id === selectedRecordId ? 'text-word-row active' : 'text-word-row'}
                    key={record.id}
                    onClick={() => selectRecord(record.id)}
                    onDoubleClick={() => {
                      selectRecord(record.id)
                      lookupRecordWord(record)
                    }}
                    title={record.word}
                    type="button"
                  >
                    <span className="text-word-index">{index + 1}</span>
                    <span className="text-word-name">{record.word || '(empty)'}</span>
                  </button>
                ))}
              </div>

              <div
                className="text-list-toolbar"
                aria-label="Word commands"
                ref={wordCommandToolbarRef}
                style={{ gridTemplateColumns: `repeat(${wordToolbarLayout.columns}, 28px)` }}
              >
                <button
                  aria-label="Open"
                  className="text-tool-button"
                  data-tooltip="Open"
                  onClick={openTextFile}
                  type="button"
                >
                  <i className="fa-solid fa-folder-open" aria-hidden="true" />
                </button>
                <button
                  aria-label="Save"
                  className="text-tool-button"
                  data-tooltip="Save"
                  onClick={() => saveTextFile()}
                  type="button"
                >
                  <i className="fa-solid fa-floppy-disk" aria-hidden="true" />
                </button>
                <button
                  aria-label="Insert"
                  className="text-tool-button"
                  data-tooltip="Insert"
                  onClick={insertRecord}
                  type="button"
                >
                  <i className="fa-solid fa-plus" aria-hidden="true" />
                </button>
                <button
                  aria-label="Append"
                  className="text-tool-button"
                  data-tooltip="Append"
                  onClick={appendRecord}
                  type="button"
                >
                  <i className="fa-solid fa-arrow-down" aria-hidden="true" />
                </button>
                <button
                  aria-label="Replace"
                  className="text-tool-button"
                  data-tooltip="Replace"
                  onClick={() => runAction('text.replace')}
                  type="button"
                >
                  <i className="fa-solid fa-right-left" aria-hidden="true" />
                </button>
                <button
                  aria-label="Delete"
                  className="text-tool-button"
                  data-tooltip="Delete"
                  onClick={deleteRecord}
                  type="button"
                >
                  <i className="fa-solid fa-trash" aria-hidden="true" />
                </button>
                <button
                  aria-label="Marks"
                  className="text-tool-button"
                  data-tooltip="Marks"
                  onClick={showMarksDummy}
                  type="button"
                >
                  <i className="fa-solid fa-tags" aria-hidden="true" />
                </button>
                <button
                  aria-label="Toggle View"
                  className="text-tool-button"
                  data-tooltip="Toggle View"
                  onClick={() => runAction('text.toggleView')}
                  type="button"
                >
                  <i className="fa-solid fa-table-columns" aria-hidden="true" />
                </button>
                <button
                  aria-label="Previous Word"
                  className="text-tool-button"
                  data-tooltip="Previous Word"
                  disabled={autoLookupRunning}
                  onClick={() => runAction('text.previousWord')}
                  type="button"
                >
                  <i className="fa-solid fa-arrow-up" aria-hidden="true" />
                </button>
                <button
                  aria-label="Next Word"
                  className="text-tool-button"
                  data-tooltip="Next Word"
                  disabled={autoLookupRunning}
                  onClick={() => runAction('text.nextWord')}
                  type="button"
                >
                  <i className="fa-solid fa-arrow-down" aria-hidden="true" />
                </button>
                <button
                  aria-label="MDict"
                  className="text-tool-button"
                  data-tooltip="MDict"
                  onClick={() => runAction('text.lookupMDict')}
                  type="button"
                >
                  <i className="fa-solid fa-book" aria-hidden="true" />
                </button>
                <button
                  aria-label="Rotate Dict"
                  className="text-tool-button"
                  data-tooltip="Rotate Dict"
                  onClick={() => runAction('text.rotateMDict')}
                  type="button"
                >
                  <i className="fa-solid fa-layer-group" aria-hidden="true" />
                </button>
                <button
                  aria-label="Start"
                  className="text-tool-button"
                  data-tooltip="Start"
                  disabled={autoLookupRunning}
                  onClick={() => runAction('text.startAutoLookup')}
                  type="button"
                >
                  <i className="fa-solid fa-play" aria-hidden="true" />
                </button>
                <button
                  aria-label="Stop"
                  className="text-tool-button"
                  data-tooltip="Stop"
                  disabled={!autoLookupRunning}
                  onClick={() => runAction('text.stopAutoLookup')}
                  type="button"
                >
                  <i className="fa-solid fa-stop" aria-hidden="true" />
                </button>
                <button
                  aria-label="Webster"
                  className="text-tool-button"
                  data-tooltip="Webster"
                  onClick={() => runAction('text.lookupWebster')}
                  type="button"
                >
                  <i className="fa-solid fa-book-open" aria-hidden="true" />
                </button>
                <button
                  aria-label="Capture"
                  className="text-tool-button"
                  data-tooltip="Capture"
                  onClick={() => runAction('text.captureWebster')}
                  type="button"
                >
                  <i className="fa-solid fa-camera" aria-hidden="true" />
                </button>
                <button
                  aria-label="Blue"
                  className="text-tool-button"
                  data-tooltip="Blue"
                  onClick={() => runAction('text.detectBlue')}
                  type="button"
                >
                  <i className="fa-solid fa-droplet" aria-hidden="true" />
                </button>
                <button
                  aria-label="ReadBlue"
                  className="text-tool-button"
                  data-tooltip="ReadBlue"
                  onClick={() => runAction('text.readBlue')}
                  type="button"
                >
                  <i className="fa-solid fa-volume-high" aria-hidden="true" />
                </button>
              </div>
            </div>
          </section>

          <section className="text-edit-panel">
            <div className="text-special-file-row">
              <select
                className="text-file-select"
                onChange={(event) => loadSpecialTextFilePath(event.target.value)}
                title={specialFolderPath}
                value={specialTextFile?.filePath || ''}
              >
                {specialTxtFiles.length === 0 ? (
                  <option value="">No special TXT selected</option>
                ) : null}
                {specialTxtFiles.map((file) => (
                  <option key={file.filePath} value={file.filePath}>
                    {file.fileName}
                  </option>
                ))}
              </select>
              <button
                aria-label="Open special TXT file"
                className="text-icon-button"
                data-tooltip="Open special TXT file"
                disabled={!specialTextFile?.filePath}
                onClick={openSpecialTextFileExternal}
                type="button"
              >
                <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
              </button>
              <button
                aria-label="Choose special TXT file"
                className="text-icon-button"
                data-tooltip="Choose special TXT file"
                onClick={openSpecialTextFile}
                type="button"
              >
                <i className="fa-solid fa-folder-open" aria-hidden="true" />
              </button>
            </div>

            <div className="text-edit-upper">
              <textarea
                className="text-word-input"
                onContextMenu={handleIndependentInputContextMenu}
                onChange={(event) => setIndependentInput(event.target.value)}
                onKeyDown={handleIndependentInputKeyDown}
                placeholder="independent input"
                ref={independentInputRef}
                rows={1}
                value={independentInput}
              />
              <div className="text-save-toolbar-horizontal" aria-label="Independent input save commands">
                <button
                  aria-label="SaveToSpecificFile"
                  className="text-tool-button"
                  data-tooltip="SaveToSpecificFile"
                  onClick={() => runAction('text.saveToSpecificFile')}
                  type="button"
                >
                  <i className="fa-solid fa-file-export" aria-hidden="true" />
                </button>
                <button
                  aria-label="SaveToEn"
                  className="text-tool-button"
                  data-tooltip="SaveToEn"
                  onClick={() => runAction('text.saveToEn')}
                  type="button"
                >
                  <i className="fa-solid fa-e" aria-hidden="true" />
                </button>
                <button
                  aria-label="SaveToZh"
                  className="text-tool-button"
                  data-tooltip="SaveToZh"
                  onClick={() => runAction('text.saveToZh')}
                  type="button"
                >
                  <i className="fa-solid fa-language" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="text-edit-lower">
              <textarea
                className="text-annotation-input"
                disabled={!selectedRecord}
                onChange={(event) => {
                  lineDraftRef.current = event.target.value
                  setLineDraft(event.target.value)
                }}
                placeholder="full line"
                ref={lineDraftInputRef}
                value={lineDraft}
              />

              <div className="text-edit-toolbar" aria-label="Edit commands">
                <button
                  aria-label="Replace Line"
                  className="text-tool-button"
                  data-tooltip="Replace Line"
                  onClick={() => runAction('text.replaceLine')}
                  type="button"
                >
                  <i className="fa-solid fa-file-pen" aria-hidden="true" />
                </button>
              </div>
            </div>
          </section>

          <div className="text-status-bar">
            <span>Words: {records.length}</span>
            <span>Current: {selectedRecord ? records.findIndex((record) => record.id === selectedRecord.id) + 1 : 0}</span>
            <span>Auto: {autoLookupRunning ? 'Running' : 'Stopped'}</span>
            {autoLookupError ? <span className="text-auto-error">error</span> : null}
            <span className={dirty ? 'text-save-status unsaved' : 'text-save-status saved'}>
              {dirty ? 'Unsaved' : 'Saved'}
            </span>
          </div>
        </div>
      ) : (
        <div className="text-files-tab" role="tabpanel">
          <label className="text-list-label" htmlFor="text-recent-folders">Recent folders</label>
          <select
            id="text-recent-folders"
            className="text-file-select"
            onChange={(event) => loadFolderPath(event.target.value)}
            value=""
          >
            <option value="">Select recent folder</option>
            {recentTextFolders.map((folderPath) => (
              <option key={folderPath} value={folderPath}>
                {folderPath}
              </option>
            ))}
          </select>

          <div className="text-file-section">
            <div className="text-list-title">recent TXT files</div>
            <div className="text-file-list" ref={recentTxtListRef}>
              {recentTextFiles.length === 0 ? (
                <div className="text-empty-row">No recent TXT file</div>
              ) : recentTextFiles.map((filePath) => {
                const { fileName } = splitPath(filePath)
                return (
                  <button
                    className={filePath === selectedRecentPath ? 'text-file-row active' : 'text-file-row'}
                    key={filePath}
                    onClick={() => setSelectedRecentPath(filePath)}
                    onDoubleClick={() => loadTextFilePath(filePath)}
                    title={filePath}
                    type="button"
                  >
                    {fileName}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="text-file-section">
            <div className="text-list-title" title={currentFolderPath}>
              folder TXT
            </div>
            <div className="text-file-list" ref={currentTxtListRef}>
              {txtFiles.length === 0 ? (
                <div className="text-empty-row">Open a TXT file first</div>
              ) : txtFiles.map((file) => {
                const filePath = file.filePath || joinPath(currentFolderPath, file.fileName)
                return (
                  <button
                    className={filePath === currentTxtFilePath ? 'text-file-row active' : 'text-file-row'}
                    key={filePath}
                    onDoubleClick={() => loadTextFilePath(filePath)}
                    title={filePath}
                    type="button"
                  >
                    {file.fileName}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {inputContextMenu ? (
        <div
          className="text-input-context-menu"
          onMouseDown={(event) => event.stopPropagation()}
          style={{
            left: inputContextMenu.x,
            top: inputContextMenu.y,
          }}
        >
          <button onClick={wrapIndependentSelectionWithParentheses} type="button">
            Wrap ()
          </button>
          <button onClick={removeIndependentInputLineBreaks} type="button">
            One Line
          </button>
          <button onClick={formatIndependentInputNote} type="button">
            Format Note
          </button>
          <button onClick={formatIndependentInputPattern} type="button">
            Format Pattern
          </button>
        </div>
      ) : null}

      {dialog ? (
        <div
          className={dialog.autoClose ? 'text-dialog-layer toast' : 'text-dialog-layer'}
          onKeyDown={handleDialogKeyDown}
          ref={dialogLayerRef}
          tabIndex={-1}
        >
          <div className="text-dialog" role="dialog" aria-modal={!dialog.autoClose}>
            <div className="text-dialog-title">{dialog.title}</div>
            <div className="text-dialog-message">{dialog.message}</div>
            {!dialog.autoClose ? (
              <div className="text-dialog-actions">
                {dialog.actions?.map((action) => (
                  <button
                    className={[
                      action.primary ? 'primary' : '',
                      action.danger ? 'danger' : '',
                    ].filter(Boolean).join(' ')}
                    key={action.value}
                    onClick={() => closeDialog(action.value)}
                    type="button"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

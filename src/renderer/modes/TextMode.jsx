import { useEffect, useMemo, useRef, useState } from 'react'
import { APP_MODES, useAppStore } from '../../stores/appStore'

const TEXT_TABS = {
  WORDS: 'words',
  FILES: 'files',
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

export default function TextMode() {
  const wordListRef = useRef(null)
  const currentTxtListRef = useRef(null)
  const recentTxtListRef = useRef(null)
  const dialogLayerRef = useRef(null)
  const dialogResolveRef = useRef(null)
  const dirtyRef = useRef(false)
  const lineDraftRef = useRef('')
  const recordsRef = useRef([])
  const selectedRecordIdRef = useRef(null)
  const toastTimerRef = useRef(null)
  const leaveGuardHandlerRef = useRef(null)

  const [activeTab, setActiveTab] = useState(TEXT_TABS.WORDS)
  const [textFile, setTextFile] = useState(null)
  const [currentFolderPath, setCurrentFolderPath] = useState('')
  const [txtFiles, setTxtFiles] = useState([])
  const [records, setRecords] = useState([])
  const [selectedRecordId, setSelectedRecordId] = useState(null)
  const [independentInput, setIndependentInput] = useState('')
  const [lineDraft, setLineDraft] = useState('')
  const [selectedRecentPath, setSelectedRecentPath] = useState('')
  const [dialog, setDialog] = useState(null)

  const dirty = useAppStore((state) => state.dirty)
  const recentTextFiles = useAppStore((state) => state.recentFiles.text || [])
  const recentTextFolders = useAppStore((state) => state.recentFolders.text || [])
  const setDirty = useAppStore((state) => state.setDirty)
  const setCurrentFile = useAppStore((state) => state.setCurrentFile)
  const addRecentFile = useAppStore((state) => state.addRecentFile)
  const addRecentFolder = useAppStore((state) => state.addRecentFolder)
  const setLeaveGuard = useAppStore((state) => state.setLeaveGuard)

  const selectedRecord = useMemo(
    () => records.find((record) => record.id === selectedRecordId) || null,
    [records, selectedRecordId]
  )

  recordsRef.current = records
  selectedRecordIdRef.current = selectedRecordId
  lineDraftRef.current = lineDraft
  dirtyRef.current = dirty

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
    setDirty(true)
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
    const nextLineDraft = selectedRecord ? recordToLine(selectedRecord) : ''
    setIndependentInput(selectedRecord?.word || '')
    lineDraftRef.current = nextLineDraft
    setLineDraft(nextLineDraft)
  }, [selectedRecordId])

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

  const applyTextFileInfo = (info) => {
    if (!info?.ok) {
      showAutoMessage('Could not open TXT file.')
      return
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
    setDirty(false)

    if (info.filePath) {
      addRecentFile(APP_MODES.TEXT, info.filePath)
      setSelectedRecentPath(info.filePath)
    }
    if (info.folderPath) {
      addRecentFolder(APP_MODES.TEXT, info.folderPath)
    }
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

    setDirty(false)
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
      setDirty(false)
      return true
    }
    return false
  }

  leaveGuardHandlerRef.current = confirmBeforeLeave

  useEffect(() => {
    setLeaveGuard(() => leaveGuardHandlerRef.current?.() ?? true)
    return () => setLeaveGuard(null)
  }, [setLeaveGuard])

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
    setDirty(false)
    showAutoMessage('TXT file reloaded.')
  }

  const getLookupWord = () => {
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

  const lookupMDictWord = async () => {
    const word = getLookupWord()
    if (!word) {
      showAutoMessage('No word to lookup.')
      return
    }
    if (!window.textApi?.lookupMDict) {
      showAutoMessage('MDict lookup API is not available.')
      return
    }

    const result = await window.textApi.lookupMDict(word)
    if (!result?.ok) {
      showDictionaryLookupError(result?.reason, 'MDict')
    }
  }

  const cycleMDictDictionary = async () => {
    if (!window.textApi?.cycleMDictDictionary) {
      showAutoMessage('MDict cycle API is not available.')
      return
    }

    const result = await window.textApi.cycleMDictDictionary()
    if (!result?.ok) {
      showDictionaryLookupError(result?.reason, 'MDict')
      return
    }

    showAutoMessage(`MDict: ${result.commandIdHex || ''}`, 'MDict', 900)
  }

  const lookupWebsterWord = async () => {
    const word = getLookupWord()
    if (!word) {
      showAutoMessage('No word to lookup.')
      return
    }
    if (!window.textApi?.lookupWebsterAndRead) {
      showAutoMessage('Webster lookup API is not available.')
      return
    }

    const result = await window.textApi.lookupWebsterAndRead(word)
    if (!result?.ok) {
      showDictionaryLookupError(result?.reason, 'Webster')
    }
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
        <div className="text-words-tab" role="tabpanel">
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

            <div className="text-list-lower">
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
                    title={record.word}
                    type="button"
                  >
                    <span className="text-word-index">{index + 1}</span>
                    <span className="text-word-name">{record.word || '(empty)'}</span>
                  </button>
                ))}
              </div>

              <div className="text-list-toolbar" aria-label="Word commands">
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
                  onClick={replaceRecordWord}
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
                  aria-label="MDict"
                  className="text-tool-button"
                  data-tooltip="MDict"
                  onClick={lookupMDictWord}
                  type="button"
                >
                  <i className="fa-solid fa-book" aria-hidden="true" />
                </button>
                <button
                  aria-label="Rotate Dict"
                  className="text-tool-button"
                  data-tooltip="Rotate Dict"
                  onClick={cycleMDictDictionary}
                  type="button"
                >
                  <i className="fa-solid fa-layer-group" aria-hidden="true" />
                </button>
                <button
                  aria-label="Webster"
                  className="text-tool-button"
                  data-tooltip="Webster"
                  onClick={lookupWebsterWord}
                  type="button"
                >
                  <i className="fa-solid fa-book-open" aria-hidden="true" />
                </button>
                <button
                  aria-label="Capture"
                  className="text-tool-button"
                  data-tooltip="Capture"
                  onClick={captureWebsterOutput}
                  type="button"
                >
                  <i className="fa-solid fa-camera" aria-hidden="true" />
                </button>
                <button
                  aria-label="Blue"
                  className="text-tool-button"
                  data-tooltip="Blue"
                  onClick={detectWebsterBlueText}
                  type="button"
                >
                  <i className="fa-solid fa-droplet" aria-hidden="true" />
                </button>
                <button
                  aria-label="ReadBlue"
                  className="text-tool-button"
                  data-tooltip="ReadBlue"
                  onClick={clickWebsterBlueText}
                  type="button"
                >
                  <i className="fa-solid fa-volume-high" aria-hidden="true" />
                </button>
              </div>
            </div>
          </section>

          <section className="text-edit-panel">
            <div className="text-edit-upper">
              <input
                className="text-word-input"
                onChange={(event) => setIndependentInput(event.target.value)}
                placeholder="independent input"
                value={independentInput}
              />
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
                value={lineDraft}
              />

              <div className="text-edit-toolbar" aria-label="Edit commands">
                <button
                  aria-label="Replace Line"
                  className="text-tool-button"
                  data-tooltip="Replace Line"
                  onClick={replaceCurrentLine}
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

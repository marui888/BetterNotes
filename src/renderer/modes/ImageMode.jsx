import { useEffect, useMemo, useRef, useState } from 'react'
import { APP_MODES, useAppStore } from '../../stores/appStore'
import { IMAGE_SUFFIX_OPTIONS, useImageStore } from '../../stores/imageStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { registerActions, runAction } from '../actions/actionRegistry'

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '--'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function splitFileName(fileName) {
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex <= 0) return { name: fileName, ext: '' }
  return {
    name: fileName.slice(0, dotIndex),
    ext: fileName.slice(dotIndex),
  }
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

function addSuffixOnce(fileName, suffix) {
  const cleanSuffix = typeof suffix === 'string' ? suffix.trim() : ''
  if (!cleanSuffix) return fileName

  const { name, ext } = splitFileName(fileName)
  const normalizedSuffix = cleanSuffix.startsWith('_') ? cleanSuffix : `_${cleanSuffix}`
  if (name.endsWith(normalizedSuffix)) return fileName
  return `${name}${normalizedSuffix}${ext}`
}

const IMAGE_SORT_OPTIONS = [
  { value: 'name', label: 'name' },
  { value: 'modifiedTime', label: 'modified' },
  { value: 'createdTime', label: 'created' },
  { value: 'type', label: 'type' },
]

function getImageFileType(file) {
  return file?.type || splitFileName(file?.fileName || '').ext.replace('.', '').toUpperCase()
}

function compareText(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

function compareImageFiles(a, b, sortKey) {
  if (sortKey === 'modifiedTime' || sortKey === 'createdTime') {
    const result = (Number(a?.[sortKey]) || 0) - (Number(b?.[sortKey]) || 0)
    return result || compareText(a?.fileName, b?.fileName)
  }

  if (sortKey === 'type') {
    return compareText(getImageFileType(a), getImageFileType(b))
      || compareText(a?.fileName, b?.fileName)
  }

  return compareText(a?.fileName, b?.fileName)
}

export default function ImageMode() {
  const currentListRef = useRef(null)
  const recentListRef = useRef(null)
  const noteEditorRef = useRef(null)
  const contextMenuRef = useRef(null)
  const dialogResolveRef = useRef(null)
  const leaveGuardHandlerRef = useRef(null)
  const pendingFileNameRef = useRef('')
  const pendingFolderPathRef = useRef('')
  const autoLoadTimerRef = useRef(null)
  const imageFilesRef = useRef([])
  const selectedImagePathRef = useRef(null)
  const selectedRecentPathRef = useRef(null)
  const [leftTab, setLeftTab] = useState('current')
  const [contextMenu, setContextMenu] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [pendingFileName, setPendingFileName] = useState('')
  const [pendingFolderPath, setPendingFolderPath] = useState('')
  const [usingPicModeWideMoveFolder, setUsingPicModeWideMoveFolder] = useState(false)
  const [selectedRecentPath, setSelectedRecentPath] = useState(null)
  const [txtNoteEnabled, setTxtNoteEnabled] = useState(false)
  const [currentSortKey, setCurrentSortKey] = useState('name')
  const [currentSortDirection, setCurrentSortDirection] = useState('asc')

  const dirty = useAppStore((state) => state.dirtyByMode.image)
  const imageAutoLoadDelayMs = useSettingsStore((state) => state.settings.general.imageAutoLoadDelayMs)
  const locallyMoveFolder = useSettingsStore((state) => state.settings.general.locallyMoveFolder)
  const picModeWideMoveFolder = useSettingsStore((state) => state.settings.general.picModeWideMoveFolder)
  const recentImageFiles = useAppStore((state) => state.recentFiles.image || [])
  const recentImageFolders = useAppStore((state) => state.recentFolders.image || [])
  const setDirty = useAppStore((state) => state.setDirty)
  const setCurrentFile = useAppStore((state) => state.setCurrentFile)
  const addRecentFile = useAppStore((state) => state.addRecentFile)
  const addRecentFolder = useAppStore((state) => state.addRecentFolder)
  const setLeaveGuard = useAppStore((state) => state.setLeaveGuard)
  const registerSessionProvider = useAppStore((state) => state.registerSessionProvider)
  const restoreSessionState = useAppStore((state) => state.restoreSessionState)

  const imageFile = useImageStore((state) => state.imageFile)
  const imageFiles = useImageStore((state) => state.imageFiles)
  const selectedImagePath = useImageStore((state) => state.selectedImagePath)
  const noteDraft = useImageStore((state) => state.noteDraft)
  const imageInfo = useImageStore((state) => state.imageInfo)
  const suffixOption = useImageStore((state) => state.suffixOption)
  const customSuffix = useImageStore((state) => state.customSuffix)
  const loadImageInfo = useImageStore((state) => state.loadImageInfo)
  const setImageFiles = useImageStore((state) => state.setImageFiles)
  const setSelectedImagePath = useImageStore((state) => state.setSelectedImagePath)
  const setNoteDraft = useImageStore((state) => state.setNoteDraft)
  const setSuffixOption = useImageStore((state) => state.setSuffixOption)
  const setCustomSuffix = useImageStore((state) => state.setCustomSuffix)

  const sortedImageFiles = useMemo(() => {
    const direction = currentSortDirection === 'desc' ? -1 : 1
    return [...imageFiles].sort((a, b) => compareImageFiles(a, b, currentSortKey) * direction)
  }, [currentSortDirection, currentSortKey, imageFiles])

  const selectedIndex = sortedImageFiles.findIndex((item) => item.filePath === selectedImagePath)
  const selectedRecentIndex = recentImageFiles.findIndex((filePath) => filePath === selectedRecentPath)
  imageFilesRef.current = sortedImageFiles
  selectedImagePathRef.current = selectedImagePath
  selectedRecentPathRef.current = selectedRecentPath

  const scrollSelectedRowIntoView = (listRef) => {
    window.requestAnimationFrame(() => {
      const row = listRef.current?.querySelector('.image-list-row.active')
      row?.scrollIntoView({ block: 'nearest' })
    })
  }

  useEffect(() => {
    if (leftTab === 'current') scrollSelectedRowIntoView(currentListRef)
  }, [currentSortDirection, currentSortKey, leftTab, selectedImagePath, sortedImageFiles])

  useEffect(() => {
    if (leftTab === 'recent') scrollSelectedRowIntoView(recentListRef)
  }, [leftTab, selectedRecentPath])

  useEffect(() => () => {
    if (autoLoadTimerRef.current) {
      clearTimeout(autoLoadTimerRef.current)
      autoLoadTimerRef.current = null
    }
  }, [])

  const closeDialog = (decision) => {
    const resolve = dialogResolveRef.current
    dialogResolveRef.current = null
    setDialog(null)
    resolve?.(decision)
  }

  const showActionDialog = (options) => new Promise((resolve) => {
    dialogResolveRef.current = resolve
    setDialog(options)
  })

  const showAutoMessage = (title, message, timeout = 1000) => {
    setDialog({
      title,
      message,
      actions: [{ label: '确定', value: 'ok', primary: true }],
      autoClose: true,
    })
    setTimeout(() => closeDialog('ok'), timeout)
  }

  const saveImageNote = async ({ silent = false } = {}) => {
    if (!imageFile?.filePath || !window.imageApi?.saveNote) return false

    const result = await window.imageApi.saveNote(imageFile.filePath, {
      content: noteDraft,
      updatedAt: new Date().toISOString(),
    })
    if (!result?.ok) return false

    setDirty(APP_MODES.IMAGE, false)
    if (!silent) showAutoMessage('Saved', 'Picture note saved.')
    return true
  }

  const confirmBeforeLeave = async () => {
    if (!dirty) return true

    const decision = await showActionDialog({
      title: 'Picture note changed',
      message: 'The current picture note has unsaved changes.',
      defaultValue: 'save',
      cancelValue: 'cancel',
      actions: [
        { label: 'Save', value: 'save', primary: true },
        { label: '放弃修改', value: 'discard', danger: true },
        { label: '取消', value: 'cancel' },
      ],
    })

    if (decision === 'save') return saveImageNote({ silent: true })
    if (decision === 'discard') {
      setDirty(APP_MODES.IMAGE, false)
      return true
    }
    return false
  }

  leaveGuardHandlerRef.current = confirmBeforeLeave

  useEffect(() => {
    setLeaveGuard(APP_MODES.IMAGE, () => leaveGuardHandlerRef.current?.() ?? true)
    return () => setLeaveGuard(APP_MODES.IMAGE, null)
  }, [setLeaveGuard])

  useEffect(() => {
    registerSessionProvider(APP_MODES.IMAGE, () => ({
      currentFilePath: imageFile?.filePath || '',
      folderPath: imageFile?.folderPath || splitPath(selectedImagePath || '').folderPath,
      leftTab,
      selectedRecentPath,
    }))
    return () => registerSessionProvider(APP_MODES.IMAGE, null)
  }, [
    imageFile?.filePath,
    imageFile?.folderPath,
    leftTab,
    registerSessionProvider,
    selectedImagePath,
    selectedRecentPath,
  ])

  useEffect(() => {
    const snapshot = restoreSessionState?.modes?.image
    if (!snapshot) return

    if (snapshot.leftTab === 'current' || snapshot.leftTab === 'recent') setLeftTab(snapshot.leftTab)
    if (snapshot.selectedRecentPath) setSelectedRecentPath(snapshot.selectedRecentPath)
    if (snapshot.currentFilePath && window.imageApi?.getImageFileInfo) {
      window.imageApi.getImageFileInfo(snapshot.currentFilePath).then((info) => {
        if (info?.ok) applyImageInfo(info)
      })
    } else if (snapshot.folderPath) {
      loadImageFolderPath(snapshot.folderPath)
    }
  }, [restoreSessionState])

  const applyTxtFallbackNote = async (filePath) => {
    if (!filePath || !window.imageApi?.readTxtFallbackNote) return

    const result = await window.imageApi.readTxtFallbackNote(filePath)
    if (!result?.ok) return

    setNoteDraft(result.content || '')
    setDirty(APP_MODES.IMAGE, true)
  }

  const applyImageInfo = (info) => {
    if (!info?.ok) return
    loadImageInfo(info)
    setCurrentFile(info.filePath || null)
    if (info.filePath) {
      addRecentFile(APP_MODES.IMAGE, info.filePath)
      setSelectedRecentPath(info.filePath)
    }
    if (info.folderPath) {
      addRecentFolder(APP_MODES.IMAGE, info.folderPath)
    }
    setDirty(APP_MODES.IMAGE, false)
    if (txtNoteEnabled && info.filePath) {
      applyTxtFallbackNote(info.filePath)
    }
  }

  const openImageFile = async () => {
    if (!window.imageApi?.openImageFile) return
    if (!(await confirmBeforeLeave())) return

    const info = await window.imageApi.openImageFile()
    if (!info?.canceled) applyImageInfo(info)
  }

  const openImageFolder = async () => {
    if (!window.imageApi?.openImageFolder) return
    if (!(await confirmBeforeLeave())) return

    const info = await window.imageApi.openImageFolder()
    if (!info?.canceled) applyImageInfo(info)
  }

  const loadImageFile = async (filePath) => {
    if (!filePath || !window.imageApi?.getImageFileInfo) return false
    if (!(await confirmBeforeLeave())) return false

    const info = await window.imageApi.getImageFileInfo(filePath)
    applyImageInfo(info)
    return true
  }

  const scheduleImageLoad = (filePath, {
    previousImagePath = selectedImagePathRef.current,
    previousRecentPath = selectedRecentPathRef.current,
    restoreEditorFocus = false,
  } = {}) => {
    if (!filePath) return
    if (autoLoadTimerRef.current) {
      clearTimeout(autoLoadTimerRef.current)
      autoLoadTimerRef.current = null
    }

    const delay = Number.isFinite(Number(imageAutoLoadDelayMs))
      ? Math.max(100, Math.min(10000, Math.round(Number(imageAutoLoadDelayMs))))
      : 500

    autoLoadTimerRef.current = setTimeout(async () => {
      autoLoadTimerRef.current = null
      const loaded = await loadImageFile(filePath)
      if (!loaded) {
        if (previousImagePath) {
          selectedImagePathRef.current = previousImagePath
          setSelectedImagePath(previousImagePath)
        }
        if (previousRecentPath) {
          selectedRecentPathRef.current = previousRecentPath
          setSelectedRecentPath(previousRecentPath)
        }
      }
      if (restoreEditorFocus) {
        setTimeout(() => {
          const editor = noteEditorRef.current
          if (!editor) return
          editor.focus()
          editor.selectionStart = editor.selectionEnd = editor.value.length
        }, 0)
      }
    }, delay)
  }

  const loadImageFolderPath = async (folderPath) => {
    if (!folderPath || !window.imageApi?.listImageFiles) return
    if (!(await confirmBeforeLeave())) return

    const result = await window.imageApi.listImageFiles(folderPath)
    if (!result?.ok) return

    addRecentFolder(APP_MODES.IMAGE, folderPath)
    const files = result.imageFiles || []
    if (files[0]?.filePath && window.imageApi?.getImageFileInfo) {
      const info = await window.imageApi.getImageFileInfo(files[0].filePath)
      applyImageInfo({
        ...info,
        imageFiles: files,
      })
      return
    }

    loadImageInfo({
      ok: true,
      folderPath,
      imageFiles: files,
      imageFile: null,
      note: { content: '' },
      info: null,
    })
    setCurrentFile(null)
    setDirty(APP_MODES.IMAGE, false)
  }

  const selectImageByIndex = (index) => {
    const files = imageFilesRef.current || []
    if (files.length === 0) return null
    const safeIndex = Math.max(0, Math.min(index, files.length - 1))
    const item = files[safeIndex]
    selectedImagePathRef.current = item.filePath
    setSelectedImagePath(item.filePath)
    return item
  }

  const selectRecentByIndex = (index) => {
    if (recentImageFiles.length === 0) return null
    const safeIndex = Math.max(0, Math.min(index, recentImageFiles.length - 1))
    const filePath = recentImageFiles[safeIndex]
    selectedRecentPathRef.current = filePath
    setSelectedRecentPath(filePath)
    return filePath
  }

  const handleCurrentListKeyDown = (event) => {
    if (!['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) return

    event.preventDefault()
    event.stopPropagation()

    if (event.key === 'Enter') {
      const item = imageFilesRef.current.find((file) => file.filePath === selectedImagePath) || selectImageByIndex(0)
      if (item) loadImageFile(item.filePath)
      return
    }

    const baseIndex = selectedIndex >= 0 ? selectedIndex : 0
    const previousPath = selectedImagePathRef.current
    const item = selectImageByIndex(selectedIndex >= 0
      ? baseIndex + (event.key === 'ArrowUp' ? -1 : 1)
      : 0)
    if (item) scheduleImageLoad(item.filePath, { previousImagePath: previousPath })
  }

  const handleRecentListKeyDown = (event) => {
    if (!['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) return

    event.preventDefault()
    event.stopPropagation()

    if (event.key === 'Enter') {
      const filePath = selectedRecentPath || selectRecentByIndex(0)
      if (filePath) loadImageFile(filePath)
      return
    }

    const baseIndex = selectedRecentIndex >= 0 ? selectedRecentIndex : 0
    const previousPath = selectedRecentPathRef.current
    const filePath = selectRecentByIndex(selectedRecentIndex >= 0
      ? baseIndex + (event.key === 'ArrowUp' ? -1 : 1)
      : 0)
    if (filePath) scheduleImageLoad(filePath, { previousRecentPath: previousPath })
  }

  const openFileMenu = (event, file) => {
    event.preventDefault()
    event.stopPropagation()
    selectedImagePathRef.current = file.filePath
    setSelectedImagePath(file.filePath)
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
    })
  }

  useEffect(() => {
    if (!contextMenu) return undefined
    const closeMenu = (event) => {
      if (contextMenuRef.current?.contains(event.target)) return
      setContextMenu(null)
    }
    window.addEventListener('click', closeMenu, true)
    return () => window.removeEventListener('click', closeMenu, true)
  }, [contextMenu])

  const getSuffix = () => (suffixOption === '其它' ? customSuffix : suffixOption)

  const buildSuggestedFileName = (operation, fileName) => {
    if (operation === 'move') return fileName
    return addSuffixOnce(fileName, getSuffix())
  }

  const getOperationTitle = (operation) => {
    if (operation === 'rename') return '确认改名'
    if (operation === 'move') return '确认移动'
    return '确认改名并移动'
  }

  const getDefaultMoveFolderPath = (folderPath) => {
    const folderName = typeof locallyMoveFolder === 'string' && locallyMoveFolder.trim()
      ? locallyMoveFolder.trim()
      : 'tempPictures'
    return joinPath(folderPath, folderName)
  }

  const changeUsingPicModeWideMoveFolder = (checked, operation, oldFolderPath) => {
    setUsingPicModeWideMoveFolder(checked)
    const nextFolderPath = checked
      ? (picModeWideMoveFolder || '')
      : operation === 'move' || operation === 'moveRename'
        ? getDefaultMoveFolderPath(oldFolderPath)
        : oldFolderPath
    pendingFolderPathRef.current = nextFolderPath
    setPendingFolderPath(nextFolderPath)
  }

  const choosePendingTargetFolder = async () => {
    if (!window.appApi?.selectFolder) {
      showAutoMessage('Folder API unavailable', 'Cannot choose target folder.')
      return
    }

    const result = await window.appApi.selectFolder()
    if (!result?.ok || result.canceled) return

    pendingFolderPathRef.current = result.folderPath || ''
    setPendingFolderPath(result.folderPath || '')
  }

  const refreshCurrentFolder = async (folderPath, nextSelectedPath = null) => {
    if (!window.imageApi?.listImageFiles || !folderPath) return
    const result = await window.imageApi.listImageFiles(folderPath)
    if (result?.ok) {
      setImageFiles(result.imageFiles || [])
      setSelectedImagePath(nextSelectedPath)
    }
  }

  const operateSelectedFile = async (operation) => {
    const activeImagePath = selectedImagePathRef.current || selectedImagePath
    if (!activeImagePath || !window.imageApi?.operateFile) return

    const selectedFile = imageFiles.find((file) => file.filePath === activeImagePath)
    if (!selectedFile) return

    const oldFolderPath = selectedFile.folderPath || splitPath(selectedFile.filePath).folderPath
    const suggestedFileName = buildSuggestedFileName(operation, selectedFile.fileName)
    const suggestedFolderPath = operation === 'move' || operation === 'moveRename'
      ? getDefaultMoveFolderPath(oldFolderPath)
      : oldFolderPath
    pendingFolderPathRef.current = suggestedFolderPath
    pendingFileNameRef.current = suggestedFileName
    setPendingFolderPath(suggestedFolderPath)
    setPendingFileName(suggestedFileName)
    setUsingPicModeWideMoveFolder(false)
    const decision = await showActionDialog({
      title: getOperationTitle(operation),
      defaultValue: 'ok',
      cancelValue: 'cancel',
      operation,
      oldFolderPath,
      oldFileName: selectedFile.fileName,
      targetPathEditable: true,
      actions: [
        { label: '确认', value: 'ok', primary: true },
        { label: '取消', value: 'cancel' },
      ],
    })
    if (decision !== 'ok') return

    const result = await window.imageApi.operateFile({
      filePath: activeImagePath,
      operation,
      targetFolderPath: pendingFolderPathRef.current || suggestedFolderPath,
      targetFileName: pendingFileNameRef.current || suggestedFileName,
    })
    setContextMenu(null)
    if (!result?.ok) return

    const movedAway = result.targetFolder
      && result.targetFolder.toLowerCase() !== result.folderPath.toLowerCase()
    await refreshCurrentFolder(result.folderPath, movedAway ? null : result.filePath)
    if (!movedAway) {
      const info = await window.imageApi.getImageFileInfo(result.filePath)
      applyImageInfo(info)
    }
  }

  const changeNoteDraft = (value) => {
    setNoteDraft(value)
    setDirty(APP_MODES.IMAGE, true)
  }

  const toggleTxtNote = (checked) => {
    setTxtNoteEnabled(checked)
    if (checked && imageFile?.filePath && !dirty) {
      applyTxtFallbackNote(imageFile.filePath)
    }
  }

  const toggleFocusBetweenCurrentListAndNoteInput = () => {
    const focusEditor = () => {
      const editor = noteEditorRef.current
      if (!editor) return

      editor.focus()
      editor.selectionStart = editor.selectionEnd = editor.value.length
    }

    if (document.activeElement === noteEditorRef.current) {
      const list = currentListRef.current
      if (!list) return
      if (leftTab !== 'current') setLeftTab('current')
      setTimeout(() => {
        list.focus()
      }, 0)
      return
    }

    if (leftTab !== 'current') {
      setLeftTab('current')
      setTimeout(focusEditor, 0)
      return
    }

    focusEditor()
  }

  const moveCurrentImageByStep = (step) => {
    if (imageFilesRef.current.length === 0) return

    const shouldRestoreEditorFocus = document.activeElement === noteEditorRef.current
    const currentIndex = imageFilesRef.current.findIndex((item) => item.filePath === selectedImagePathRef.current)
    const baseIndex = currentIndex >= 0 ? currentIndex : 0
    const previousPath = selectedImagePathRef.current
    const item = selectImageByIndex(baseIndex + step)
    if (item) {
      scheduleImageLoad(item.filePath, {
        previousImagePath: previousPath,
        restoreEditorFocus: shouldRestoreEditorFocus,
      })
    }
  }

  useEffect(() => registerActions([
    {
      id: 'image.intoEditingFocus',
      label: 'Into Editing Focus',
      scope: APP_MODES.IMAGE,
      handler: toggleFocusBetweenCurrentListAndNoteInput,
    },
    {
      id: 'image.previousImage',
      label: 'Previous Image',
      scope: APP_MODES.IMAGE,
      handler: () => moveCurrentImageByStep(-1),
    },
    {
      id: 'image.nextImage',
      label: 'Next Image',
      scope: APP_MODES.IMAGE,
      handler: () => moveCurrentImageByStep(1),
    },
    {
      id: 'image.saveNote',
      label: 'Save',
      scope: APP_MODES.IMAGE,
      handler: saveImageNote,
    },
    {
      id: 'image.renameFile',
      label: 'Rename',
      scope: APP_MODES.IMAGE,
      handler: () => operateSelectedFile('rename'),
    },
    {
      id: 'image.moveFile',
      label: 'Move',
      scope: APP_MODES.IMAGE,
      handler: () => operateSelectedFile('move'),
    },
    {
      id: 'image.moveRenameFile',
      label: 'Move&Re',
      scope: APP_MODES.IMAGE,
      handler: () => operateSelectedFile('moveRename'),
    },
  ]), [
    moveCurrentImageByStep,
    operateSelectedFile,
    saveImageNote,
    toggleFocusBetweenCurrentListAndNoteInput,
  ])

  return (
    <section className="image-mode">
      <div className="image-body">
        <aside className="image-left-panel">
        <div className="left-tabs">
          <button
            className={leftTab === 'current' ? 'left-tab active' : 'left-tab'}
            onClick={() => setLeftTab('current')}
            type="button"
          >
            Current
          </button>
          <button
            className={leftTab === 'recent' ? 'left-tab active' : 'left-tab'}
            onClick={() => setLeftTab('recent')}
            type="button"
          >
            Recent
          </button>
        </div>

        {leftTab === 'current' ? (
          <div className="image-list-panel">
            <div className="list-title">Files:</div>
            <div className="image-sort-bar" aria-label="Image file sorting">
              <label>
                <span>Sort</span>
                <select
                  onChange={(event) => setCurrentSortKey(event.target.value)}
                  value={currentSortKey}
                >
                  {IMAGE_SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <button
                aria-label={currentSortDirection === 'asc' ? 'Ascending' : 'Descending'}
                className="image-sort-direction"
                data-tooltip={currentSortDirection === 'asc' ? 'Ascending' : 'Descending'}
                onClick={() => setCurrentSortDirection((value) => (value === 'asc' ? 'desc' : 'asc'))}
                type="button"
              >
                <i
                  className={currentSortDirection === 'asc'
                    ? 'fa-solid fa-arrow-up-a-z'
                    : 'fa-solid fa-arrow-down-z-a'}
                  aria-hidden="true"
                />
              </button>
            </div>
            <div className="image-file-list" onKeyDown={handleCurrentListKeyDown} ref={currentListRef} tabIndex={0}>
              {sortedImageFiles.length === 0 ? (
                <div className="empty-list">No image files loaded</div>
              ) : (
                sortedImageFiles.map((file) => (
                  <button
                    className={file.filePath === selectedImagePath ? 'image-list-row active' : 'image-list-row'}
                    key={file.filePath}
                    onClick={() => {
                      selectedImagePathRef.current = file.filePath
                      setSelectedImagePath(file.filePath)
                    }}
                    onContextMenu={(event) => openFileMenu(event, file)}
                    onDoubleClick={() => loadImageFile(file.filePath)}
                    title={file.filePath}
                    type="button"
                  >
                    {file.fileName}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="image-recent-panel">
            <label className="recent-folder-picker">
              <span>Recent folders</span>
              <select defaultValue="" onChange={(event) => loadImageFolderPath(event.target.value)}>
                <option value="" disabled>Choose folder</option>
                {recentImageFolders.map((folderPath) => (
                  <option key={folderPath} value={folderPath}>{folderPath}</option>
                ))}
              </select>
            </label>
            <div className="list-title">Recent files</div>
            <div className="image-file-list" onKeyDown={handleRecentListKeyDown} ref={recentListRef} tabIndex={0}>
              {recentImageFiles.length === 0 ? (
                <div className="empty-list">No recent image files</div>
              ) : (
                recentImageFiles.map((filePath) => {
                  const { fileName } = splitPath(filePath)
                  return (
                    <button
                      className={filePath === selectedRecentPath ? 'image-list-row recent active' : 'image-list-row recent'}
                      key={filePath}
                      onClick={() => setSelectedRecentPath(filePath)}
                      onDoubleClick={() => loadImageFile(filePath)}
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
        )}
        </aside>

        <section className="image-center">
        <div className="image-stage">
          {imageFile?.fileUrl ? (
            <img alt={imageFile.fileName} src={imageFile.fileUrl} />
          ) : (
            <div className="image-empty-stage">Open an image file or folder</div>
          )}
        </div>

        <div className="image-bottom-panel">
          <textarea
            className="note-editor"
            onChange={(event) => changeNoteDraft(event.target.value)}
            placeholder="Picture note content"
            ref={noteEditorRef}
            value={noteDraft}
          />
          <div className="image-info">
            <div><span>format</span><strong>{imageInfo?.format || '--'}</strong></div>
            <div><span>size</span><strong>{formatBytes(imageInfo?.fileSize)}</strong></div>
            <div><span>res</span><strong>{imageInfo?.width && imageInfo?.height ? `${imageInfo.width} x ${imageInfo.height}` : '--'}</strong></div>
            <div><span>bit</span><strong>{imageInfo?.bitDepth || '--'}</strong></div>
            <div className="info-file"><span>file</span><strong>{imageInfo?.fileName || '--'}</strong></div>
            <div className="info-file"><span>folder</span><strong title={imageInfo?.folderPath || ''}>{imageInfo?.folderPath || '--'}</strong></div>
          </div>
        </div>
        </section>

        <aside className="image-toolbar">
        <button type="button" onClick={openImageFile}>Open File</button>
        <button type="button" onClick={openImageFolder}>Open Folder</button>
        <button type="button" onClick={() => runAction('image.saveNote')}>Save</button>
        <button type="button" onClick={() => runAction('image.previousImage')}>Pre</button>
        <button type="button" onClick={() => runAction('image.nextImage')}>Next</button>
        <label className="toolbar-field">
          <span>Suffix</span>
          <select value={suffixOption} onChange={(event) => setSuffixOption(event.target.value)}>
            {IMAGE_SUFFIX_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        {suffixOption === '其它' ? (
          <input
            className="toolbar-input"
            onChange={(event) => setCustomSuffix(event.target.value)}
            placeholder="suffix"
            value={customSuffix}
          />
        ) : null}
        <label className="toolbar-check">
          <input
            checked={txtNoteEnabled}
            onChange={(event) => toggleTxtNote(event.target.checked)}
            type="checkbox"
          />
          <span>txtNote</span>
        </label>
        <button type="button" onClick={() => runAction('image.renameFile')}>Rename</button>
        <button type="button" onClick={() => runAction('image.moveFile')}>Move</button>
        <button type="button" onClick={() => runAction('image.moveRenameFile')}>Move&Re</button>
        </aside>
      </div>

      <footer className="image-statusbar">
        <span>Status: <strong className={dirty ? 'status-unsaved' : ''}>{dirty ? 'Unsaved' : 'Saved'}</strong></span>
        <span>File: <strong title={imageInfo?.fileName || ''}>{imageInfo?.fileName || '--'}</strong></span>
        <span>Res: <strong>{imageInfo?.width && imageInfo?.height ? `${imageInfo.width} x ${imageInfo.height}` : '--'}</strong></span>
        <span>Current: <strong>{selectedIndex >= 0 ? selectedIndex + 1 : '--'} / {imageFiles.length}</strong></span>
      </footer>

      {contextMenu ? (
        <div
          className="context-menu image-context-menu"
          ref={contextMenuRef}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <label className="context-field">
            <span>后缀</span>
            <select value={suffixOption} onChange={(event) => setSuffixOption(event.target.value)}>
              {IMAGE_SUFFIX_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          {suffixOption === '其它' ? (
            <input
              className="context-input"
              onChange={(event) => setCustomSuffix(event.target.value)}
              placeholder="输入后缀"
              value={customSuffix}
            />
          ) : null}
          <button className="context-menu-item" onMouseDown={() => runAction('image.renameFile')} type="button">
            改名
          </button>
          <button className="context-menu-item" onMouseDown={() => runAction('image.moveFile')} type="button">
            移动
          </button>
          <button className="context-menu-item" onMouseDown={() => runAction('image.moveRenameFile')} type="button">
            改名并移动
          </button>
        </div>
      ) : null}

      {dialog && !dialog.autoClose ? (
        <div className="inline-dialog-mask">
          <div className="inline-dialog">
            <div className="inline-dialog-title">{dialog.title}</div>
            {dialog.targetPathEditable ? (
              <div className="file-operation-fields">
                <label>
                  <span>旧文件夹</span>
                  <strong className="wrap-value" title={dialog.oldFolderPath}>{dialog.oldFolderPath}</strong>
                </label>
                <label>
                  <span>旧文件名</span>
                  <strong className="wrap-value">{dialog.oldFileName}</strong>
                </label>
                <label className="file-operation-wide-check">
                  <input
                    checked={usingPicModeWideMoveFolder}
                    disabled={!picModeWideMoveFolder}
                    onChange={(event) => {
                      changeUsingPicModeWideMoveFolder(
                        event.target.checked,
                        dialog.operation,
                        dialog.oldFolderPath
                      )
                    }}
                    type="checkbox"
                  />
                  <span>Using PicMode-wide Move Folder</span>
                </label>
                <label>
                  <span>新文件夹</span>
                  <div className="file-operation-folder-row">
                    <input
                      onChange={(event) => {
                        pendingFolderPathRef.current = event.target.value
                        setPendingFolderPath(event.target.value)
                      }}
                      value={pendingFolderPath}
                    />
                    <button
                      data-tooltip="Choose folder"
                      onClick={choosePendingTargetFolder}
                      type="button"
                    >
                      <i className="fa-solid fa-folder-open" aria-hidden="true" />
                    </button>
                  </div>
                </label>
                <label>
                  <span>新文件名</span>
                  <input
                    onChange={(event) => {
                      pendingFileNameRef.current = event.target.value
                      setPendingFileName(event.target.value)
                    }}
                    value={pendingFileName}
                  />
                </label>
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
    </section>
  )
}

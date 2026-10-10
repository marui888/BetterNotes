import { useEffect, useMemo, useRef, useState } from 'react'
import { APP_MODES, useAppStore } from '../../stores/appStore'
import { IMAGE_SUFFIX_OTHER, useImageStore } from '../../stores/imageStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { registerActions, runAction } from '../actions/actionRegistry'
import SimpleContextMenu from '../components/SimpleContextMenu'
import useKeywordInsertion from '../hooks/useKeywordInsertion'

const INVALID_IMAGE_SUFFIX_CHARACTERS = '<>:"/\\|?*'

function getImageSuffixKey(value) {
  return String(value || '').trim().replace(/^_+/, '').toLocaleLowerCase()
}

function getImageSuffixError(value) {
  const suffix = String(value || '').trim()
  if (!suffix || !getImageSuffixKey(suffix)) return 'Enter a suffix.'
  if (suffix === IMAGE_SUFFIX_OTHER) return `"${IMAGE_SUFFIX_OTHER}" is reserved.`
  if (INVALID_IMAGE_SUFFIX_CHARACTERS.split('').some((character) => suffix.includes(character))) {
    return 'The suffix contains an invalid filename character.'
  }
  return ''
}

function ImageSuffixPicker({ className, label, onChange, onDelete, options, value }) {
  const rootRef = useRef(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    const closePicker = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    window.addEventListener('pointerdown', closePicker, true)
    return () => window.removeEventListener('pointerdown', closePicker, true)
  }, [open])

  const selectOption = (option) => {
    onChange(option)
    setOpen(false)
  }

  return (
    <div className={`${className} image-suffix-field`} ref={rootRef}>
      <span>{label}</span>
      <div className="image-suffix-picker">
        <button
          aria-expanded={open}
          aria-haspopup="listbox"
          className="image-suffix-trigger"
          onClick={() => setOpen((current) => !current)}
          title={value}
          type="button"
        >
          <span>{value}</span>
          <i className="fa-solid fa-caret-down" aria-hidden="true" />
        </button>
        {open ? (
          <div className="image-suffix-menu" role="listbox">
            {options.map((option) => (
              <div className="image-suffix-option-row" key={option}>
                <button
                  aria-selected={value === option}
                  className={value === option ? 'image-suffix-option active' : 'image-suffix-option'}
                  onClick={() => selectOption(option)}
                  role="option"
                  title={option}
                  type="button"
                >
                  {option}
                </button>
                <button
                  aria-label={`Delete suffix ${option}`}
                  className="image-suffix-remove"
                  data-tooltip="Delete suffix"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setOpen(false)
                    onDelete(option)
                  }}
                  type="button"
                >
                  <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
              </div>
            ))}
            <button
              aria-selected={value === IMAGE_SUFFIX_OTHER}
              className={value === IMAGE_SUFFIX_OTHER ? 'image-suffix-option other active' : 'image-suffix-option other'}
              onClick={() => selectOption(IMAGE_SUFFIX_OTHER)}
              role="option"
              type="button"
            >
              {IMAGE_SUFFIX_OTHER}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

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
  const imageBodyRef = useRef(null)
  const imageCenterRef = useRef(null)
  const imageLayoutResizeCleanupRef = useRef(null)
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
  const [keywordMenu, setKeywordMenu] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [pendingFileName, setPendingFileName] = useState('')
  const [pendingFolderPath, setPendingFolderPath] = useState('')
  const [usingPicModeWideMoveFolder, setUsingPicModeWideMoveFolder] = useState(false)
  const [selectedRecentPath, setSelectedRecentPath] = useState(null)
  const [txtNoteEnabled, setTxtNoteEnabled] = useState(false)
  const [currentSortKey, setCurrentSortKey] = useState('name')
  const [currentSortDirection, setCurrentSortDirection] = useState('asc')
  const [imageLeftWidth, setImageLeftWidth] = useState(280)
  const [imageRightWidth, setImageRightWidth] = useState(112)
  const [imageBottomHeight, setImageBottomHeight] = useState(130)
  const [imageLayoutDragging, setImageLayoutDragging] = useState('')
  const [imageGroupStartIndex, setImageGroupStartIndex] = useState(0)

  const dirty = useAppStore((state) => state.dirtyByMode.image)
  const mode = useAppStore((state) => state.mode)
  const imageAutoLoadDelayMs = useSettingsStore((state) => state.settings.general.imageAutoLoadDelayMs)
  const imageViewCount = useSettingsStore((state) => state.settings.general.imageViewCount || 1)
  const imageSuffixOptions = useSettingsStore((state) => state.settings.general.imageSuffixOptions || [])
  const locallyMoveFolder = useSettingsStore((state) => state.settings.general.locallyMoveFolder)
  const picModeWideMoveFolder = useSettingsStore((state) => state.settings.general.picModeWideMoveFolder)
  const saveSettings = useSettingsStore((state) => state.saveSettings)
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

  useEffect(() => {
    if (suffixOption === IMAGE_SUFFIX_OTHER) return
    if (imageSuffixOptions.includes(suffixOption)) return
    setSuffixOption(imageSuffixOptions[0] || IMAGE_SUFFIX_OTHER)
  }, [imageSuffixOptions, setSuffixOption, suffixOption])

  useEffect(() => () => {
    imageLayoutResizeCleanupRef.current?.()
  }, [])

  const sortedImageFiles = useMemo(() => {
    const direction = currentSortDirection === 'desc' ? -1 : 1
    return [...imageFiles].sort((a, b) => compareImageFiles(a, b, currentSortKey) * direction)
  }, [currentSortDirection, currentSortKey, imageFiles])

  const activeImageIndex = sortedImageFiles.findIndex((item) => item.filePath === imageFile?.filePath)
  const visibleImageFiles = sortedImageFiles.slice(
    imageGroupStartIndex,
    imageGroupStartIndex + imageViewCount,
  )

  useEffect(() => {
    if (sortedImageFiles.length === 0) {
      if (imageGroupStartIndex !== 0) setImageGroupStartIndex(0)
      return
    }

    if (imageGroupStartIndex >= sortedImageFiles.length) {
      setImageGroupStartIndex(Math.max(0, sortedImageFiles.length - 1))
      return
    }

    if (
      activeImageIndex >= 0
      && (
        activeImageIndex < imageGroupStartIndex
        || activeImageIndex >= imageGroupStartIndex + imageViewCount
      )
    ) {
      setImageGroupStartIndex(activeImageIndex)
    }
  }, [activeImageIndex, imageGroupStartIndex, imageViewCount, sortedImageFiles.length])

  const selectedIndex = sortedImageFiles.findIndex((item) => item.filePath === selectedImagePath)
  const selectedRecentIndex = recentImageFiles.findIndex((filePath) => filePath === selectedRecentPath)
  imageFilesRef.current = sortedImageFiles
  selectedImagePathRef.current = selectedImagePath
  selectedRecentPathRef.current = selectedRecentPath
  const keywordInsertion = useKeywordInsertion({
    isActive: mode === APP_MODES.IMAGE,
    targets: {
      noteEditor: {
        ref: noteEditorRef,
        setValue: (value) => {
          setNoteDraft(value)
          setDirty(APP_MODES.IMAGE, true)
        },
      },
    },
  })

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
    nextGroupStartIndex = null,
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
      } else if (Number.isInteger(nextGroupStartIndex)) {
        setImageGroupStartIndex(nextGroupStartIndex)
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

  const activatePreviewImage = async (file) => {
    if (!file?.filePath || file.filePath === imageFile?.filePath) return
    await loadImageFile(file.filePath)
  }

  const loadImageFromCurrentList = async (filePath) => {
    const targetIndex = sortedImageFiles.findIndex((file) => file.filePath === filePath)
    const targetAlreadyVisible = targetIndex >= imageGroupStartIndex
      && targetIndex < imageGroupStartIndex + imageViewCount
    const loaded = await loadImageFile(filePath)
    if (loaded && targetIndex >= 0 && !targetAlreadyVisible) {
      setImageGroupStartIndex(targetIndex)
    }
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
      filePath: file.filePath,
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

  useEffect(() => {
    if (!keywordMenu) return undefined
    const closeMenu = () => setKeywordMenu(null)
    window.addEventListener('click', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
    }
  }, [keywordMenu])

  const getSuffix = () => (suffixOption === IMAGE_SUFFIX_OTHER ? customSuffix : suffixOption)

  const saveImageSuffixOptions = async (nextOptions) => {
    const currentSettings = useSettingsStore.getState().settings
    return saveSettings({
      ...currentSettings,
      general: {
        ...currentSettings.general,
        imageSuffixOptions: nextOptions,
      },
    })
  }

  const changeImageViewCount = async (nextCount) => {
    const normalizedCount = Math.max(1, Math.min(3, Math.round(Number(nextCount) || 1)))
    if (activeImageIndex >= 0) setImageGroupStartIndex(activeImageIndex)

    const currentSettings = useSettingsStore.getState().settings
    try {
      await saveSettings({
        ...currentSettings,
        general: {
          ...currentSettings.general,
          imageViewCount: normalizedCount,
        },
      })
    } catch (error) {
      window.debugApi?.log(`Save image view count failed: ${error?.message || String(error)}`)
    }
  }

  const rememberUsedCustomSuffix = async (suffix) => {
    const normalizedSuffix = String(suffix || '').trim()
    const suffixKey = getImageSuffixKey(normalizedSuffix)
    const currentOptions = useSettingsStore.getState().settings.general.imageSuffixOptions || []
    const existingOption = currentOptions.find((option) => getImageSuffixKey(option) === suffixKey)
    if (existingOption) {
      setSuffixOption(existingOption)
      return
    }

    try {
      await saveImageSuffixOptions([...currentOptions, normalizedSuffix])
      setSuffixOption(normalizedSuffix)
    } catch (error) {
      window.debugApi?.log(`Save image suffix failed: ${error?.message || String(error)}`)
    }
  }

  const deleteImageSuffix = async (suffix) => {
    setContextMenu(null)
    const decision = await showActionDialog({
      title: 'Delete suffix',
      message: `Delete "${suffix}" from the suffix list?`,
      defaultValue: 'delete',
      cancelValue: 'cancel',
      actions: [
        { label: 'Delete', value: 'delete', danger: true },
        { label: 'Cancel', value: 'cancel' },
      ],
    })
    if (decision !== 'delete') return

    const suffixKey = getImageSuffixKey(suffix)
    const currentOptions = useSettingsStore.getState().settings.general.imageSuffixOptions || []
    const nextOptions = currentOptions.filter((option) => getImageSuffixKey(option) !== suffixKey)
    try {
      await saveImageSuffixOptions(nextOptions)
      if (getImageSuffixKey(suffixOption) === suffixKey) {
        setSuffixOption(nextOptions[0] || IMAGE_SUFFIX_OTHER)
      }
    } catch (error) {
      window.debugApi?.log(`Delete image suffix failed: ${error?.message || String(error)}`)
      showAutoMessage('Suffix', 'Unable to delete the suffix.', 1600)
    }
  }

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
    const activeImagePath = contextMenu?.filePath
      || imageFile?.filePath
      || selectedImagePathRef.current
      || selectedImagePath
    if (!activeImagePath || !window.imageApi?.operateFile) return

    const customSuffixUsed = operation !== 'move' && suffixOption === IMAGE_SUFFIX_OTHER
    const customSuffixValue = customSuffixUsed ? String(customSuffix || '').trim() : ''
    const customSuffixError = customSuffixUsed ? getImageSuffixError(customSuffixValue) : ''
    if (customSuffixError) {
      showAutoMessage('Invalid suffix', customSuffixError, 1800)
      return
    }

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

    if (customSuffixUsed) {
      await rememberUsedCustomSuffix(customSuffixValue)
    }

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

  const handleNoteEditorContextMenu = (event) => {
    event.preventDefault()
    event.stopPropagation()
    keywordInsertion.rememberTarget('noteEditor')
    setKeywordMenu({
      x: Math.max(8, Math.min(event.clientX + 8, window.innerWidth - 218)),
      y: Math.max(8, Math.min(event.clientY + 8, window.innerHeight - 44)),
    })
  }

  const handleNoteEditorKeyDown = (event) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    event.preventDefault()
    event.stopPropagation()
    const rect = noteEditorRef.current?.getBoundingClientRect()
    keywordInsertion.rememberTarget('noteEditor')
    setKeywordMenu({
      x: Math.max(8, Math.min((rect?.left || 0) + 16, window.innerWidth - 218)),
      y: Math.max(8, Math.min((rect?.top || 0) + 16, window.innerHeight - 44)),
    })
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
    const currentIndex = imageFilesRef.current.findIndex((item) => item.filePath === imageFile?.filePath)
    const baseIndex = currentIndex >= 0 ? currentIndex : 0
    const visibleStart = Math.max(0, Math.min(imageGroupStartIndex, imageFilesRef.current.length - 1))
    const visibleEnd = Math.min(
      imageFilesRef.current.length - 1,
      visibleStart + imageViewCount - 1,
    )
    let targetIndex = baseIndex + step
    let nextGroupStartIndex = visibleStart

    if (step > 0 && baseIndex >= visibleEnd) {
      if (visibleEnd >= imageFilesRef.current.length - 1) return
      nextGroupStartIndex = visibleStart + imageViewCount
      targetIndex = nextGroupStartIndex
    } else if (step < 0 && baseIndex <= visibleStart) {
      if (visibleStart <= 0) return
      nextGroupStartIndex = Math.max(0, visibleStart - imageViewCount)
      targetIndex = visibleStart - 1
    }

    const previousPath = imageFile?.filePath || selectedImagePathRef.current
    const item = selectImageByIndex(targetIndex)
    if (item) {
      scheduleImageLoad(item.filePath, {
        nextGroupStartIndex,
        previousImagePath: previousPath,
        restoreEditorFocus: shouldRestoreEditorFocus,
      })
    }
  }

  const startImageLayoutResize = (event, type) => {
    event.preventDefault()
    event.stopPropagation()

    imageLayoutResizeCleanupRef.current?.()
    const bodyBounds = imageBodyRef.current?.getBoundingClientRect()
    const centerBounds = imageCenterRef.current?.getBoundingClientRect()
    if (!bodyBounds || !centerBounds) return

    const startX = event.clientX
    const startY = event.clientY
    const startLeftWidth = imageLeftWidth
    const startRightWidth = imageRightWidth
    const startBottomHeight = imageBottomHeight
    setImageLayoutDragging(type === 'horizontal' ? 'horizontal' : 'vertical')

    const handlePointerMove = (moveEvent) => {
      if (type === 'left') {
        const maximumLeftWidth = Math.max(80, bodyBounds.width - startRightWidth - 240 - 12)
        const nextWidth = startLeftWidth + (moveEvent.clientX - startX)
        setImageLeftWidth(Math.max(80, Math.min(maximumLeftWidth, nextWidth)))
        return
      }

      if (type === 'right') {
        const maximumRightWidth = Math.max(88, bodyBounds.width - startLeftWidth - 240 - 12)
        const nextWidth = startRightWidth - (moveEvent.clientX - startX)
        setImageRightWidth(Math.max(88, Math.min(maximumRightWidth, nextWidth)))
        return
      }

      const maximumBottomHeight = Math.max(90, centerBounds.height - 100 - 6)
      const nextHeight = startBottomHeight - (moveEvent.clientY - startY)
      setImageBottomHeight(Math.max(90, Math.min(maximumBottomHeight, nextHeight)))
    }

    const finishResize = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finishResize)
      window.removeEventListener('pointercancel', finishResize)
      if (imageLayoutResizeCleanupRef.current === finishResize) {
        imageLayoutResizeCleanupRef.current = null
      }
      setImageLayoutDragging('')
    }

    imageLayoutResizeCleanupRef.current = finishResize
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', finishResize)
    window.addEventListener('pointercancel', finishResize)
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
    imageFile?.filePath,
    imageGroupStartIndex,
    imageViewCount,
    operateSelectedFile,
    saveImageNote,
    toggleFocusBetweenCurrentListAndNoteInput,
  ])

  return (
    <section className={imageLayoutDragging ? `image-mode splitter-dragging-${imageLayoutDragging}` : 'image-mode'}>
      <div
        className="image-body"
        ref={imageBodyRef}
        style={{
          '--image-left-width': `${imageLeftWidth}px`,
          '--image-right-width': `${imageRightWidth}px`,
        }}
      >
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
                    onDoubleClick={() => loadImageFromCurrentList(file.filePath)}
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

        <div
          aria-label="Resize left picture panel"
          aria-orientation="vertical"
          className="image-layout-splitter vertical"
          onPointerDown={(event) => startImageLayoutResize(event, 'left')}
          role="separator"
        />

        <section
          className="image-center"
          ref={imageCenterRef}
          style={{ '--image-bottom-height': `${imageBottomHeight}px` }}
        >
        <div
          className="image-stage"
          style={{ '--image-view-count': imageViewCount }}
        >
          {visibleImageFiles.length > 0 ? (
            visibleImageFiles.map((file) => {
              const active = file.filePath === imageFile?.filePath
              const fileUrl = file.fileUrl || (active ? imageFile?.fileUrl : '')
              return (
                <button
                  className={active ? 'image-preview-tile active' : 'image-preview-tile'}
                  key={file.filePath}
                  onClick={() => activatePreviewImage(file)}
                  title={file.filePath}
                  type="button"
                >
                  {fileUrl ? <img alt={file.fileName} src={fileUrl} /> : null}
                  <span>{file.fileName}</span>
                </button>
              )
            })
          ) : (
            <div className="image-empty-stage">Open an image file or folder</div>
          )}
        </div>

        <div
          aria-label="Resize picture and note areas"
          aria-orientation="horizontal"
          className="image-layout-splitter horizontal"
          onPointerDown={(event) => startImageLayoutResize(event, 'horizontal')}
          role="separator"
        />

        <div className="image-bottom-panel">
          <textarea
            className="note-editor"
            onContextMenu={handleNoteEditorContextMenu}
            onChange={(event) => changeNoteDraft(event.target.value)}
            onKeyDown={handleNoteEditorKeyDown}
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

        <div
          aria-label="Resize right picture toolbar"
          aria-orientation="vertical"
          className="image-layout-splitter vertical"
          onPointerDown={(event) => startImageLayoutResize(event, 'right')}
          role="separator"
        />

        <aside className="image-toolbar">
        <button type="button" onClick={openImageFile}>Open File</button>
        <button type="button" onClick={openImageFolder}>Open Folder</button>
        <button type="button" onClick={() => runAction('image.saveNote')}>Save</button>
        <button type="button" onClick={() => runAction('image.previousImage')}>Pre</button>
        <button type="button" onClick={() => runAction('image.nextImage')}>Next</button>
        <div className="image-view-count-control">
          <span>Pictures</span>
          <div role="group" aria-label="Pictures shown at once">
            {[1, 2, 3].map((count) => (
              <button
                aria-pressed={imageViewCount === count}
                className={imageViewCount === count ? 'active' : ''}
                key={count}
                onClick={() => changeImageViewCount(count)}
                type="button"
              >
                {count}
              </button>
            ))}
          </div>
        </div>
        <ImageSuffixPicker
          className="toolbar-field"
          label="Suffix"
          onChange={setSuffixOption}
          onDelete={deleteImageSuffix}
          options={imageSuffixOptions}
          value={suffixOption}
        />
        {suffixOption === IMAGE_SUFFIX_OTHER ? (
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
        <span>Current: <strong>{activeImageIndex >= 0 ? activeImageIndex + 1 : '--'} / {imageFiles.length}</strong></span>
      </footer>

      {contextMenu ? (
        <div
          className="context-menu image-context-menu"
          ref={contextMenuRef}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <ImageSuffixPicker
            className="context-field"
            label="后缀"
            onChange={setSuffixOption}
            onDelete={deleteImageSuffix}
            options={imageSuffixOptions}
            value={suffixOption}
          />
          {suffixOption === IMAGE_SUFFIX_OTHER ? (
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

      {keywordMenu ? (
        <SimpleContextMenu
          items={[
            { label: 'Keywords...', action: () => keywordInsertion.openPicker('noteEditor') },
          ]}
          onClose={() => setKeywordMenu(null)}
          position={keywordMenu}
        />
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

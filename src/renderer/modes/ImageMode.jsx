import { useEffect, useMemo, useRef, useState } from 'react'
import { APP_MODES, useAppStore } from '../../stores/appStore'
import { IMAGE_SUFFIX_OPTIONS, useImageStore } from '../../stores/imageStore'
import useModeHotkeys from '../hooks/useModeHotkeys'

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

function addSuffixOnce(fileName, suffix) {
  const cleanSuffix = typeof suffix === 'string' ? suffix.trim() : ''
  if (!cleanSuffix) return fileName

  const { name, ext } = splitFileName(fileName)
  const normalizedSuffix = cleanSuffix.startsWith('_') ? cleanSuffix : `_${cleanSuffix}`
  if (name.endsWith(normalizedSuffix)) return fileName
  return `${name}${normalizedSuffix}${ext}`
}

export default function ImageMode() {
  const currentListRef = useRef(null)
  const recentListRef = useRef(null)
  const noteEditorRef = useRef(null)
  const dialogResolveRef = useRef(null)
  const leaveGuardHandlerRef = useRef(null)
  const pendingFileNameRef = useRef('')
  const [leftTab, setLeftTab] = useState('current')
  const [contextMenu, setContextMenu] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [pendingFileName, setPendingFileName] = useState('')
  const [selectedRecentPath, setSelectedRecentPath] = useState(null)
  const [txtNoteEnabled, setTxtNoteEnabled] = useState(false)

  const dirty = useAppStore((state) => state.dirty)
  const recentImageFiles = useAppStore((state) => state.recentFiles.image || [])
  const recentImageFolders = useAppStore((state) => state.recentFolders.image || [])
  const setDirty = useAppStore((state) => state.setDirty)
  const setCurrentFile = useAppStore((state) => state.setCurrentFile)
  const addRecentFile = useAppStore((state) => state.addRecentFile)
  const addRecentFolder = useAppStore((state) => state.addRecentFolder)
  const setLeaveGuard = useAppStore((state) => state.setLeaveGuard)

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

  const selectedIndex = imageFiles.findIndex((item) => item.filePath === selectedImagePath)
  const selectedRecentIndex = recentImageFiles.findIndex((filePath) => filePath === selectedRecentPath)

  const scrollSelectedRowIntoView = (listRef) => {
    window.requestAnimationFrame(() => {
      const row = listRef.current?.querySelector('.image-list-row.active')
      row?.scrollIntoView({ block: 'nearest' })
    })
  }

  useEffect(() => {
    if (leftTab === 'current') scrollSelectedRowIntoView(currentListRef)
  }, [leftTab, selectedImagePath])

  useEffect(() => {
    if (leftTab === 'recent') scrollSelectedRowIntoView(recentListRef)
  }, [leftTab, selectedRecentPath])

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

    setDirty(false)
    if (!silent) showAutoMessage('保存完成', '图片笔记已经保存。')
    return true
  }

  const confirmBeforeLeave = async () => {
    if (!dirty) return true

    const decision = await showActionDialog({
      title: '图片笔记已修改',
      message: '当前图片笔记已经修改，切换前需要处理这些修改。',
      defaultValue: 'save',
      cancelValue: 'cancel',
      actions: [
        { label: '保存并继续', value: 'save', primary: true },
        { label: '放弃修改', value: 'discard', danger: true },
        { label: '取消', value: 'cancel' },
      ],
    })

    if (decision === 'save') return saveImageNote({ silent: true })
    if (decision === 'discard') {
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

  const applyTxtFallbackNote = async (filePath) => {
    if (!filePath || !window.imageApi?.readTxtFallbackNote) return

    const result = await window.imageApi.readTxtFallbackNote(filePath)
    if (!result?.ok) return

    setNoteDraft(result.content || '')
    setDirty(true)
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
    setDirty(false)
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
    if (!filePath || !window.imageApi?.getImageFileInfo) return
    if (!(await confirmBeforeLeave())) return

    const info = await window.imageApi.getImageFileInfo(filePath)
    applyImageInfo(info)
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
    setDirty(false)
  }

  const selectImageByIndex = (index) => {
    if (imageFiles.length === 0) return null
    const safeIndex = Math.max(0, Math.min(index, imageFiles.length - 1))
    const item = imageFiles[safeIndex]
    setSelectedImagePath(item.filePath)
    return item
  }

  const selectRecentByIndex = (index) => {
    if (recentImageFiles.length === 0) return null
    const safeIndex = Math.max(0, Math.min(index, recentImageFiles.length - 1))
    const filePath = recentImageFiles[safeIndex]
    setSelectedRecentPath(filePath)
    return filePath
  }

  const handleCurrentListKeyDown = (event) => {
    if (!['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) return

    event.preventDefault()
    event.stopPropagation()

    if (event.key === 'Enter') {
      const item = imageFiles.find((file) => file.filePath === selectedImagePath) || selectImageByIndex(0)
      if (item) loadImageFile(item.filePath)
      return
    }

    const baseIndex = selectedIndex >= 0 ? selectedIndex : 0
    selectImageByIndex(selectedIndex >= 0
      ? baseIndex + (event.key === 'ArrowUp' ? -1 : 1)
      : 0)
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
    selectRecentByIndex(selectedRecentIndex >= 0
      ? baseIndex + (event.key === 'ArrowUp' ? -1 : 1)
      : 0)
  }

  const openFileMenu = (event, file) => {
    event.preventDefault()
    event.stopPropagation()
    setSelectedImagePath(file.filePath)
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
    })
  }

  useEffect(() => {
    if (!contextMenu) return undefined
    const closeMenu = () => setContextMenu(null)
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

  const refreshCurrentFolder = async (folderPath, nextSelectedPath = null) => {
    if (!window.imageApi?.listImageFiles || !folderPath) return
    const result = await window.imageApi.listImageFiles(folderPath)
    if (result?.ok) {
      setImageFiles(result.imageFiles || [])
      setSelectedImagePath(nextSelectedPath)
    }
  }

  const operateSelectedFile = async (operation) => {
    if (!selectedImagePath || !window.imageApi?.operateFile) return

    const selectedFile = imageFiles.find((file) => file.filePath === selectedImagePath)
    if (!selectedFile) return

    const suggestedFileName = buildSuggestedFileName(operation, selectedFile.fileName)
    pendingFileNameRef.current = suggestedFileName
    setPendingFileName(suggestedFileName)
    const decision = await showActionDialog({
      title: getOperationTitle(operation),
      defaultValue: 'ok',
      cancelValue: 'cancel',
      oldFileName: selectedFile.fileName,
      newFileNameEditable: true,
      actions: [
        { label: '确认', value: 'ok', primary: true },
        { label: '取消', value: 'cancel' },
      ],
    })
    if (decision !== 'ok') return

    const result = await window.imageApi.operateFile({
      filePath: selectedImagePath,
      operation,
      targetFileName: pendingFileNameRef.current || suggestedFileName,
    })
    setContextMenu(null)
    if (!result?.ok) return

    const movedAway = operation === 'move' || operation === 'moveRename'
    await refreshCurrentFolder(result.folderPath, movedAway ? null : result.filePath)
    if (!movedAway) {
      const info = await window.imageApi.getImageFileInfo(result.filePath)
      applyImageInfo(info)
    }
  }

  const changeNoteDraft = (value) => {
    setNoteDraft(value)
    setDirty(true)
  }

  const toggleTxtNote = (checked) => {
    setTxtNoteEnabled(checked)
    if (checked && imageFile?.filePath && !dirty) {
      applyTxtFallbackNote(imageFile.filePath)
    }
  }

  const toggleFocusBetweenCurrentListAndNoteInput = () => {
    const list = currentListRef.current
    const editor = noteEditorRef.current
    if (!list || !editor) return

    if (document.activeElement === editor) {
      if (leftTab !== 'current') setLeftTab('current')
      setTimeout(() => list.focus(), 0)
      return
    }

    if (leftTab !== 'current') {
      setLeftTab('current')
      setTimeout(() => list.focus(), 0)
      return
    }

    if (document.activeElement === list) {
      editor.focus()
      setTimeout(() => {
        editor.selectionStart = editor.selectionEnd = editor.value.length
      }, 0)
      return
    }

    list.focus()
  }

  const handlers = useMemo(() => ({
    'alt+e': () => toggleFocusBetweenCurrentListAndNoteInput(),
  }), [toggleFocusBetweenCurrentListAndNoteInput])

  useModeHotkeys(dialog ? {} : handlers)

  return (
    <section className="image-mode">
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
            <div className="list-title">Current files</div>
            <div className="image-file-list" onKeyDown={handleCurrentListKeyDown} ref={currentListRef} tabIndex={0}>
              {imageFiles.length === 0 ? (
                <div className="empty-list">No image files loaded</div>
              ) : (
                imageFiles.map((file) => (
                  <button
                    className={file.filePath === selectedImagePath ? 'image-list-row active' : 'image-list-row'}
                    key={file.filePath}
                    onClick={() => setSelectedImagePath(file.filePath)}
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
        <button type="button" onClick={saveImageNote}>Save</button>
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
        <button type="button" onClick={() => operateSelectedFile('rename')}>Rename</button>
        <button type="button" onClick={() => operateSelectedFile('move')}>Move</button>
        <button type="button" onClick={() => operateSelectedFile('moveRename')}>Move&Re</button>
      </aside>

      {contextMenu ? (
        <div
          className="context-menu image-context-menu"
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
          <button className="context-menu-item" onMouseDown={() => operateSelectedFile('rename')} type="button">
            改名
          </button>
          <button className="context-menu-item" onMouseDown={() => operateSelectedFile('move')} type="button">
            移动
          </button>
          <button className="context-menu-item" onMouseDown={() => operateSelectedFile('moveRename')} type="button">
            改名并移动
          </button>
        </div>
      ) : null}

      {dialog && !dialog.autoClose ? (
        <div className="inline-dialog-mask">
          <div className="inline-dialog">
            <div className="inline-dialog-title">{dialog.title}</div>
            {dialog.newFileNameEditable ? (
              <div className="file-operation-fields">
                <label>
                  <span>旧文件名</span>
                  <strong>{dialog.oldFileName}</strong>
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

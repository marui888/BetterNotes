import { useEffect, useRef } from 'react'
import { SHORTCUT_SCOPES, useSettingsStore } from '../../stores/settingsStore'
import { getRegisteredActions, runAction } from '../actions/actionRegistry'

export function formatShortcutEvent(event) {
  const key = event.key === ' ' ? 'Space' : event.key
  if (!key || ['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
    return ''
  }

  const parts = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Meta')

  const normalizedKey = key.length === 1 ? key.toUpperCase() : key
  parts.push(normalizedKey)
  return parts.join('+')
}

function formatPendingChordEvent(event) {
  const shortcut = formatShortcutEvent(event)
  const imeHandledKey = event.isComposing
    || event.key === 'Process'
    || event.key === 'Unidentified'
  const physicalLetterMatch = !event.ctrlKey
    && !event.altKey
    && !event.shiftKey
    && !event.metaKey
    ? /^Key([A-Z])$/.exec(String(event.code || ''))
    : null

  return imeHandledKey && physicalLetterMatch
    ? physicalLetterMatch[1]
    : shortcut
}

function findActionByShortcut(shortcuts, scope, shortcut) {
  const entries = Object.entries(shortcuts?.[scope] || {})
  const match = entries.find(([, value]) => value === shortcut)
  return match?.[0] || ''
}

function getScopedShortcutEntries(shortcuts, scope) {
  return Object.entries(shortcuts?.[scope] || {})
    .filter(([, value]) => typeof value === 'string' && value.trim())
}

function findActionByShortcutInScopes(shortcuts, scopes, shortcut) {
  for (const scope of scopes) {
    const actionId = findActionByShortcut(shortcuts, scope, shortcut)
    if (actionId) return actionId
  }
  return ''
}

function hasChordPrefix(shortcuts, scopes, shortcut) {
  return scopes.some((scope) => (
    getScopedShortcutEntries(shortcuts, scope)
      .some(([, value]) => value.includes(' ') && value.split(/\s+/)[0] === shortcut)
  ))
}

function getChordOptions(shortcuts, scopes, prefix, mode) {
  const actionLabels = new Map(
    getRegisteredActions().map((action) => [action.id, action.label || action.id])
  )
  const seenSecondKeys = new Set()
  const options = []

  scopes.forEach((scope) => {
    getScopedShortcutEntries(shortcuts, scope).forEach(([actionId, value]) => {
      const parts = value.trim().split(/\s+/)
      if (parts.length < 2 || parts[0] !== prefix) return
      const secondKey = parts.slice(1).join(' ')
      if (!secondKey || seenSecondKeys.has(secondKey)) return
      if (!isShortcutActionEnabled(actionId, mode)) return

      seenSecondKeys.add(secondKey)
      options.push({
        actionId,
        key: secondKey,
        label: actionLabels.get(actionId) || actionId,
      })
    })
  })

  return options
}

const GLOBAL_MODE_ACTION_IDS = new Set([
  'global.switchToVideo',
  'global.switchToPicture',
  'global.switchToText',
  'global.switchToManagement',
])

function getGlobalModeChord(shortcuts, mode) {
  const entries = getScopedShortcutEntries(shortcuts, SHORTCUT_SCOPES.GLOBAL)
    .filter(([actionId]) => GLOBAL_MODE_ACTION_IDS.has(actionId))
    .map(([actionId, value]) => ({ actionId, parts: value.trim().split(/\s+/) }))
    .filter(({ parts }) => parts.length >= 2)
  const prefix = entries[0]?.parts[0] || ''
  if (!prefix) return null

  const labels = new Map(
    getRegisteredActions().map((action) => [action.id, action.label || action.id])
  )
  const options = entries
    .filter(({ parts }) => parts[0] === prefix)
    .map(({ actionId, parts }) => ({
      actionId,
      key: parts.slice(1).join(' '),
      label: labels.get(actionId) || actionId,
    }))
    .filter(({ actionId, key }) => key && isShortcutActionEnabled(actionId, mode))

  return options.length > 0 ? { prefix, options } : null
}

const VIDEO_CONTROL_ACTIONS = new Set([
  'video.jumpBackShort',
  'video.jumpForwardShort',
  'video.volumeUp',
  'video.volumeDown',
  'video.rollingFontSizeUp',
  'video.rollingFontSizeDown',
  'video.videoOpacityDown',
  'video.videoOpacityUp',
])

const NOTE_CONTENT_ARROW_ACTIONS = new Set([
  'video.jumpBackShort',
  'video.jumpForwardShort',
  'video.volumeUp',
  'video.volumeDown',
])

const UNMODIFIED_ARROW_SHORTCUTS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
])

function shouldLeaveArrowKeyForVideoNoteContent(actionId, mode, shortcut) {
  if (mode !== SHORTCUT_SCOPES.VIDEO) return false
  if (!NOTE_CONTENT_ARROW_ACTIONS.has(actionId)) return false
  if (!UNMODIFIED_ARROW_SHORTCUTS.has(shortcut)) return false
  return document.activeElement?.matches?.('.video-mode .note-editor') === true
}

function isShortcutActionEnabled(actionId, mode) {
  if (mode === SHORTCUT_SCOPES.VIDEO && VIDEO_CONTROL_ACTIONS.has(actionId)) {
    return Boolean(document.querySelector('.video-mode.video-control-mode'))
  }

  return true
}

export default function useShortcutManager(mode, disabled = false) {
  const settings = useSettingsStore((state) => state.settings)
  const chordTimeoutMs = settings.general.segmentedShortcutWaitSec * 1000
  const pendingChordRef = useRef(null)
  const pendingChordScopesRef = useRef(null)
  const chordTimerRef = useRef(null)
  const suppressBeforeInputRef = useRef(false)
  const suppressBeforeInputTimerRef = useRef(null)
  const pendingChordFocusRef = useRef(null)
  const focusRestoreFrameRef = useRef(0)
  const focusRestoreSnapshotRef = useRef(null)

  const clearBeforeInputSuppression = () => {
    suppressBeforeInputRef.current = false
    if (suppressBeforeInputTimerRef.current) {
      clearTimeout(suppressBeforeInputTimerRef.current)
      suppressBeforeInputTimerRef.current = null
    }
  }

  const suppressNextBeforeInput = () => {
    clearBeforeInputSuppression()
    suppressBeforeInputRef.current = true
    suppressBeforeInputTimerRef.current = setTimeout(() => {
      suppressBeforeInputRef.current = false
      suppressBeforeInputTimerRef.current = null
    }, 0)
  }

  const cancelPendingChordFocusRestore = () => {
    if (focusRestoreFrameRef.current) {
      window.cancelAnimationFrame(focusRestoreFrameRef.current)
      focusRestoreFrameRef.current = 0
    }
    const snapshot = focusRestoreSnapshotRef.current
    focusRestoreSnapshotRef.current = null
    return snapshot
  }

  const captureAndBlurVideoNoteContent = () => {
    const deferredSnapshot = cancelPendingChordFocusRestore()
    const existingSnapshot = pendingChordFocusRef.current
    pendingChordFocusRef.current = null
    const element = document.activeElement
    if (!element?.matches?.('.video-mode .note-editor')) {
      pendingChordFocusRef.current = existingSnapshot || deferredSnapshot
      return
    }

    pendingChordFocusRef.current = {
      element,
      selectionStart: element.selectionStart,
      selectionEnd: element.selectionEnd,
    }
    element.blur()
  }

  const restorePendingChordFocus = () => {
    const snapshot = pendingChordFocusRef.current
    pendingChordFocusRef.current = null
    if (!snapshot?.element) return

    cancelPendingChordFocusRestore()
    focusRestoreSnapshotRef.current = snapshot
    focusRestoreFrameRef.current = window.requestAnimationFrame(() => {
      focusRestoreFrameRef.current = 0
      const restoreSnapshot = focusRestoreSnapshotRef.current
      focusRestoreSnapshotRef.current = null
      const element = restoreSnapshot?.element
      if (!element) return
      if (!element.isConnected || !element.closest('.mode-panel.active')) return

      element.focus({ preventScroll: true })
      const textLength = String(element.value || '').length
      const start = Math.max(0, Math.min(Number(restoreSnapshot.selectionStart) || 0, textLength))
      const end = Math.max(start, Math.min(Number(restoreSnapshot.selectionEnd) || start, textLength))
      element.setSelectionRange?.(start, end)
    })
  }

  const clearPendingChord = ({ restoreFocus = true } = {}) => {
    pendingChordRef.current = null
    pendingChordScopesRef.current = null
    if (chordTimerRef.current) {
      clearTimeout(chordTimerRef.current)
      chordTimerRef.current = null
    }
    window.dispatchEvent(new CustomEvent('shortcut-chord-change', { detail: null }))
    if (restoreFocus) restorePendingChordFocus()
  }

  const startPendingChord = (firstShortcut, options, scopes = null) => {
    clearPendingChord({ restoreFocus: false })
    captureAndBlurVideoNoteContent()
    pendingChordRef.current = firstShortcut
    pendingChordScopesRef.current = scopes
    window.dispatchEvent(new CustomEvent('shortcut-chord-change', {
      detail: { shortcut: firstShortcut, options },
    }))
    chordTimerRef.current = setTimeout(clearPendingChord, chordTimeoutMs)
  }

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.repeat) return
      if (disabled && !pendingChordRef.current) return
      if (document.querySelector('.subtitle-pick-dialog') && !pendingChordRef.current) return

      const shortcut = pendingChordRef.current
        ? formatPendingChordEvent(event)
        : formatShortcutEvent(event)
      if (!shortcut) return

      const shortcuts = settings.shortcuts || {}
      const scopes = [mode, SHORTCUT_SCOPES.GLOBAL]

      if (pendingChordRef.current) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation?.()
        if (event.key?.length === 1 || /^Key[A-Z]$/.test(String(event.code || ''))) {
          suppressNextBeforeInput()
        }

        if (shortcut === 'Escape') {
          clearPendingChord()
          return
        }

        const chordShortcut = `${pendingChordRef.current} ${shortcut}`
        const pendingScopes = pendingChordScopesRef.current || scopes
        clearPendingChord()
        const chordActionId = findActionByShortcutInScopes(shortcuts, pendingScopes, chordShortcut)
        if (!chordActionId) return
        if (!isShortcutActionEnabled(chordActionId, mode)) return

        runAction(chordActionId)
        return
      }

      if (hasChordPrefix(shortcuts, scopes, shortcut)) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation?.()
        startPendingChord(shortcut, getChordOptions(shortcuts, scopes, shortcut, mode))
        return
      }

      const actionId = findActionByShortcutInScopes(shortcuts, scopes, shortcut)

      if (!actionId) return
      if (shouldLeaveArrowKeyForVideoNoteContent(actionId, mode, shortcut)) return
      if (!isShortcutActionEnabled(actionId, mode)) return

      event.preventDefault()
      event.stopPropagation()
      runAction(actionId)
    }

    const handleBeforeInput = (event) => {
      if (!suppressBeforeInputRef.current) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
      clearBeforeInputSuppression()
    }

    const handleChordCancel = () => clearPendingChord()
    const handleGlobalActivationChanged = ({ active } = {}) => {
      window.dispatchEvent(new CustomEvent('shortcut-chord-cancel'))
      if (!active) return

      const globalModeChord = getGlobalModeChord(settings.shortcuts || {}, mode)
      if (!globalModeChord) return
      startPendingChord(
        globalModeChord.prefix,
        globalModeChord.options,
        [SHORTCUT_SCOPES.GLOBAL]
      )
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('beforeinput', handleBeforeInput, true)
    window.addEventListener('shortcut-chord-cancel', handleChordCancel)
    const removeGlobalActivationListener = window.appApi?.onGlobalActivationChanged?.(
      handleGlobalActivationChanged
    )
    return () => {
      clearPendingChord({ restoreFocus: false })
      pendingChordFocusRef.current = null
      cancelPendingChordFocusRestore()
      clearBeforeInputSuppression()
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('beforeinput', handleBeforeInput, true)
      window.removeEventListener('shortcut-chord-cancel', handleChordCancel)
      removeGlobalActivationListener?.()
    }
  }, [chordTimeoutMs, disabled, mode, settings.shortcuts])
}

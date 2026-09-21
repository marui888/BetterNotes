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

  const clearPendingChord = () => {
    pendingChordRef.current = null
    pendingChordScopesRef.current = null
    if (chordTimerRef.current) {
      clearTimeout(chordTimerRef.current)
      chordTimerRef.current = null
    }
    window.dispatchEvent(new CustomEvent('shortcut-chord-change', { detail: null }))
  }

  const startPendingChord = (firstShortcut, options, scopes = null) => {
    clearPendingChord()
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

      const shortcut = formatShortcutEvent(event)
      if (!shortcut) return

      const shortcuts = settings.shortcuts || {}
      const scopes = [mode, SHORTCUT_SCOPES.GLOBAL]

      if (pendingChordRef.current) {
        event.preventDefault()
        event.stopPropagation()

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
    window.addEventListener('shortcut-chord-cancel', handleChordCancel)
    const removeGlobalActivationListener = window.appApi?.onGlobalActivationChanged?.(
      handleGlobalActivationChanged
    )
    return () => {
      clearPendingChord()
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('shortcut-chord-cancel', handleChordCancel)
      removeGlobalActivationListener?.()
    }
  }, [chordTimeoutMs, disabled, mode, settings.shortcuts])
}

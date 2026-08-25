import { useEffect, useRef } from 'react'
import { SHORTCUT_SCOPES, useSettingsStore } from '../../stores/settingsStore'
import { runAction } from '../actions/actionRegistry'

const CHORD_TIMEOUT_MS = 2000

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

const VIDEO_CONTROL_ACTIONS = new Set([
  'video.jumpBackShort',
  'video.jumpForwardShort',
  'video.speedUp',
  'video.speedDown',
  'video.volumeUp',
  'video.volumeDown',
])

function isShortcutActionEnabled(actionId, mode) {
  if (mode === SHORTCUT_SCOPES.VIDEO && VIDEO_CONTROL_ACTIONS.has(actionId)) {
    return Boolean(document.querySelector('.video-mode.video-control-mode'))
  }

  return true
}

export default function useShortcutManager(mode, disabled = false) {
  const settings = useSettingsStore((state) => state.settings)
  const pendingChordRef = useRef(null)
  const chordTimerRef = useRef(null)

  const clearPendingChord = () => {
    pendingChordRef.current = null
    if (chordTimerRef.current) {
      clearTimeout(chordTimerRef.current)
      chordTimerRef.current = null
    }
    window.dispatchEvent(new CustomEvent('shortcut-chord-change', { detail: null }))
  }

  const startPendingChord = (firstShortcut) => {
    clearPendingChord()
    pendingChordRef.current = firstShortcut
    window.dispatchEvent(new CustomEvent('shortcut-chord-change', {
      detail: { shortcut: firstShortcut },
    }))
    chordTimerRef.current = setTimeout(clearPendingChord, CHORD_TIMEOUT_MS)
  }

  useEffect(() => {
    if (disabled) return undefined

    const handleKeyDown = (event) => {
      if (event.repeat) return

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
        clearPendingChord()
        const chordActionId = findActionByShortcutInScopes(shortcuts, scopes, chordShortcut)
        if (!chordActionId) return
        if (!isShortcutActionEnabled(chordActionId, mode)) return

        runAction(chordActionId)
        return
      }

      if (hasChordPrefix(shortcuts, scopes, shortcut)) {
        event.preventDefault()
        event.stopPropagation()
        startPendingChord(shortcut)
        return
      }

      const actionId = findActionByShortcutInScopes(shortcuts, scopes, shortcut)

      if (!actionId) return
      if (!isShortcutActionEnabled(actionId, mode)) return

      event.preventDefault()
      event.stopPropagation()
      runAction(actionId)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      clearPendingChord()
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [disabled, mode, settings.shortcuts])
}

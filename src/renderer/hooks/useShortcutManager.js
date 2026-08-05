import { useEffect } from 'react'
import { SHORTCUT_SCOPES, useSettingsStore } from '../../stores/settingsStore'
import { runAction } from '../actions/actionRegistry'

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

const VIDEO_CONTROL_ACTIONS = new Set([
  'video.jumpBackShort',
  'video.jumpForwardShort',
  'video.jumpBackLong',
  'video.jumpForwardLong',
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

  useEffect(() => {
    if (disabled) return undefined

    const handleKeyDown = (event) => {
      if (event.repeat) return

      const shortcut = formatShortcutEvent(event)
      if (!shortcut) return

      const shortcuts = settings.shortcuts || {}
      const actionId = findActionByShortcut(shortcuts, mode, shortcut)
        || findActionByShortcut(shortcuts, SHORTCUT_SCOPES.GLOBAL, shortcut)

      if (!actionId) return
      if (!isShortcutActionEnabled(actionId, mode)) return

      event.preventDefault()
      event.stopPropagation()
      runAction(actionId)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [disabled, mode, settings.shortcuts])
}

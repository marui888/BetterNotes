import { useEffect } from 'react'

function normalizeKey(event) {
  const parts = []

  if (event.ctrlKey) parts.push('ctrl')
  if (event.shiftKey) parts.push('shift')
  if (event.altKey) parts.push('alt')

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase()
  parts.push(key)

  return parts.join('+')
}

export default function useModeHotkeys(handlers) {
  useEffect(() => {
    const onKeyDown = (event) => {
      const key = normalizeKey(event)
      const handler = handlers[key]

      if (!handler) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      handler(event)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [handlers])
}

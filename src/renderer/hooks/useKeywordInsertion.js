import { useEffect, useRef } from 'react'

export default function useKeywordInsertion({ isActive, targets }) {
  const activeRef = useRef(isActive)
  const targetIdRef = useRef('')
  const selectionRef = useRef(null)
  const targetsRef = useRef(targets)

  activeRef.current = isActive
  targetsRef.current = targets

  const rememberTarget = (targetId) => {
    const target = targetsRef.current?.[targetId]
    const input = target?.ref?.current
    if (!input) return false

    targetIdRef.current = targetId
    selectionRef.current = {
      start: input.selectionStart ?? input.value.length,
      end: input.selectionEnd ?? input.value.length,
    }
    return true
  }

  const openPicker = (targetId) => {
    if (!rememberTarget(targetId)) return false
    window.keywordApi?.openPicker?.()
    return true
  }

  useEffect(() => {
    if (!window.keywordApi?.onInsert) return undefined

    return window.keywordApi.onInsert((payload) => {
      if (!activeRef.current) return

      const text = String(payload?.text || '')
      if (!text) return

      const targetId = targetIdRef.current
      const target = targetsRef.current?.[targetId]
      const input = target?.ref?.current
      const selection = selectionRef.current
      if (!input || !target?.setValue || !selection) return

      const value = input.value || ''
      const start = Math.max(0, Math.min(selection.start, value.length))
      const end = Math.max(start, Math.min(selection.end, value.length))
      const nextValue = `${value.slice(0, start)}${text}${value.slice(end)}`
      const nextCursor = start + text.length

      target.setValue(nextValue)
      selectionRef.current = { start: nextCursor, end: nextCursor }

      window.requestAnimationFrame(() => {
        input.focus()
        input.setSelectionRange(nextCursor, nextCursor)
      })
    })
  }, [])

  return {
    openPicker,
    rememberTarget,
  }
}

import { useEffect, useRef } from 'react'

export default function SimpleContextMenu({ className = '', items, onClose, position }) {
  const menuRef = useRef(null)

  useEffect(() => {
    window.requestAnimationFrame(() => {
      menuRef.current?.querySelector('button:not(:disabled)')?.focus()
    })
  }, [])

  const focusItemByOffset = (offset) => {
    const buttons = [...(menuRef.current?.querySelectorAll('button:not(:disabled)') || [])]
    if (buttons.length === 0) return

    const currentIndex = buttons.findIndex((button) => button === document.activeElement)
    const baseIndex = currentIndex >= 0 ? currentIndex : 0
    const nextIndex = (baseIndex + offset + buttons.length) % buttons.length
    buttons[nextIndex]?.focus()
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose?.()
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      focusItemByOffset(1)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      focusItemByOffset(-1)
    }
  }

  return (
    <div
      className={['context-menu', className].filter(Boolean).join(' ')}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleKeyDown}
      ref={menuRef}
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item, index) => (
        <button
          className={item.separator ? 'context-menu-item separator' : 'context-menu-item'}
          disabled={item.disabled}
          key={`${item.label}-${index}`}
          onClick={() => {
            onClose?.()
            item.action?.()
          }}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

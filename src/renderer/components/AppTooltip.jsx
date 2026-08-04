import { useEffect, useRef, useState } from 'react'

const OFFSET = 14
const EDGE_PADDING = 6

function findTooltipTarget(element) {
  return element?.closest?.('[data-tooltip]')
}

export default function AppTooltip() {
  const tooltipRef = useRef(null)
  const [tooltip, setTooltip] = useState({
    visible: false,
    text: '',
    x: 0,
    y: 0,
  })

  useEffect(() => {
    const hideTooltip = () => {
      setTooltip((current) => current.visible ? { ...current, visible: false } : current)
    }

    const updateTooltip = (event) => {
      const target = findTooltipTarget(event.target)
      const text = target?.dataset?.tooltip || ''

      if (!text || target?.disabled) {
        hideTooltip()
        return
      }

      setTooltip({
        visible: true,
        text,
        x: event.clientX,
        y: event.clientY,
      })
    }

    document.addEventListener('mousemove', updateTooltip)
    document.addEventListener('mouseleave', hideTooltip)
    document.addEventListener('mousedown', hideTooltip)
    document.addEventListener('keydown', hideTooltip)
    document.addEventListener('scroll', hideTooltip, true)

    return () => {
      document.removeEventListener('mousemove', updateTooltip)
      document.removeEventListener('mouseleave', hideTooltip)
      document.removeEventListener('mousedown', hideTooltip)
      document.removeEventListener('keydown', hideTooltip)
      document.removeEventListener('scroll', hideTooltip, true)
    }
  }, [])

  useEffect(() => {
    if (!tooltip.visible || !tooltipRef.current) return

    const element = tooltipRef.current
    const rect = element.getBoundingClientRect()
    let left = tooltip.x + OFFSET
    let top = tooltip.y + OFFSET

    if (left + rect.width + EDGE_PADDING > window.innerWidth) {
      left = tooltip.x - rect.width - OFFSET
    }

    if (top + rect.height + EDGE_PADDING > window.innerHeight) {
      top = tooltip.y - rect.height - OFFSET
    }

    left = Math.max(EDGE_PADDING, Math.min(left, window.innerWidth - rect.width - EDGE_PADDING))
    top = Math.max(EDGE_PADDING, Math.min(top, window.innerHeight - rect.height - EDGE_PADDING))

    element.style.left = `${Math.round(left)}px`
    element.style.top = `${Math.round(top)}px`
  }, [tooltip])

  return (
    <div
      className={tooltip.visible ? 'app-tooltip visible' : 'app-tooltip'}
      ref={tooltipRef}
      role="tooltip"
    >
      {tooltip.text}
    </div>
  )
}

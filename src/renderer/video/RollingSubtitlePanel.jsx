import { useEffect, useMemo, useRef, useState } from 'react'
import { getActiveSubtitleCueIndex } from './subtitleParser'
import './RollingSubtitlePanel.css'

const MIN_WIDTH = 260
const MIN_HEIGHT = 120
const DEFAULT_RECT = {
  x: 80,
  y: 56,
  width: 520,
  height: 260,
}
const MIN_FONT_SIZE = 10
const MAX_FONT_SIZE = 48
const DEFAULT_FONT_SIZE = 25

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max))
}

export default function RollingSubtitlePanel({
  containerRef,
  cues = [],
  currentTime = 0,
  defaultFontSize = DEFAULT_FONT_SIZE,
  getCurrentTime,
  onCueClick,
}) {
  const listRef = useRef(null)
  const dragRef = useRef(null)
  const initializedRectRef = useRef(false)
  const [rect, setRect] = useState(DEFAULT_RECT)
  const [fontSize, setFontSize] = useState(() => clamp(Number(defaultFontSize) || DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE))
  const [panelTime, setPanelTime] = useState(currentTime)
  const activeIndex = useMemo(() => getActiveSubtitleCueIndex(cues, panelTime), [cues, panelTime])

  useEffect(() => {
    setFontSize(clamp(Number(defaultFontSize) || DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE))
  }, [defaultFontSize])

  useEffect(() => {
    if (initializedRectRef.current) return
    const bounds = containerRef?.current?.getBoundingClientRect()
    if (!bounds?.width || !bounds?.height) return

    initializedRectRef.current = true
    setRect({
      x: 0,
      y: 0,
      width: Math.max(MIN_WIDTH, Math.round(bounds.width / 2)),
      height: Math.max(MIN_HEIGHT, Math.round(bounds.height * 0.95)),
    })
  }, [containerRef])

  useEffect(() => {
    let animationId = 0
    const tick = () => {
      const nextTime = Number(getCurrentTime?.())
      setPanelTime(Number.isFinite(nextTime) ? nextTime : currentTime)
      animationId = window.requestAnimationFrame(tick)
    }

    animationId = window.requestAnimationFrame(tick)
    return () => {
      window.cancelAnimationFrame(animationId)
    }
  }, [currentTime, getCurrentTime])

  useEffect(() => {
    if (activeIndex < 0) return
    const list = listRef.current
    const row = list?.querySelector(`[data-cue-index="${activeIndex}"]`)
    if (!list || !row) return

    const currentCenter = row.offsetTop + (row.clientHeight / 2)
    const nextCue = cues[activeIndex + 1]
    const nextRow = list.querySelector(`[data-cue-index="${activeIndex + 1}"]`)
    const nextCenter = nextRow ? nextRow.offsetTop + (nextRow.clientHeight / 2) : currentCenter
    const cue = cues[activeIndex]
    const span = nextCue ? Math.max(0.1, nextCue.start - cue.start) : Math.max(0.1, cue.end - cue.start)
    const progress = clamp((Number(panelTime) - cue.start) / span, 0, 1)
    const targetCenter = currentCenter + ((nextCenter - currentCenter) * progress)
    const targetTop = targetCenter - (list.clientHeight / 2)

    list.scrollTop = targetTop
  }, [activeIndex, cues, panelTime])

  useEffect(() => {
    const handlePointerMove = (event) => {
      const drag = dragRef.current
      if (!drag) return

      const bounds = containerRef?.current?.getBoundingClientRect()
      const maxWidth = Math.max(MIN_WIDTH, bounds?.width || window.innerWidth)
      const maxHeight = Math.max(MIN_HEIGHT, bounds?.height || window.innerHeight)
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY

      if (drag.type === 'move') {
        setRect((current) => ({
          ...current,
          x: clamp(drag.rect.x + dx, 0, Math.max(0, maxWidth - current.width)),
          y: clamp(drag.rect.y + dy, 0, Math.max(0, maxHeight - current.height)),
        }))
        return
      }

      setRect((current) => {
        const width = clamp(drag.rect.width + dx, MIN_WIDTH, maxWidth - current.x)
        const height = clamp(drag.rect.height + dy, MIN_HEIGHT, maxHeight - current.y)
        return { ...current, width, height }
      })
    }

    const handlePointerUp = () => {
      dragRef.current = null
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [containerRef])

  const startDrag = (event, type) => {
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = {
      type,
      startX: event.clientX,
      startY: event.clientY,
      rect,
    }
  }

  const changeFontSize = (event, step) => {
    event.preventDefault()
    event.stopPropagation()
    setFontSize((value) => clamp(value + step, MIN_FONT_SIZE, MAX_FONT_SIZE))
  }

  return (
    <div
      className="rolling-subtitle-panel"
      style={{
        width: rect.width,
        height: rect.height,
        transform: `translate(${rect.x}px, ${rect.y}px)`,
      }}
    >
      <div
        className="rolling-subtitle-drag-handle"
        onPointerDown={(event) => startDrag(event, 'move')}
        title="Drag rolling subtitles"
      >
        <span className="rolling-subtitle-font-tools">
          <button
            aria-label="Decrease subtitle font size"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => changeFontSize(event, -1)}
            title="Font smaller"
            type="button"
          >
            -
          </button>
          <button
            aria-label="Increase subtitle font size"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => changeFontSize(event, 1)}
            title="Font larger"
            type="button"
          >
            +
          </button>
          <span className="rolling-subtitle-font-size">{fontSize}px</span>
        </span>
      </div>
      <div className="rolling-subtitle-list" ref={listRef}>
        {cues.length === 0 ? (
          <div className="rolling-subtitle-empty">No subtitle cues.</div>
        ) : cues.map((cue, index) => {
          const highlighted = activeIndex >= 0 && index >= activeIndex - 1 && index <= activeIndex
          return (
            <button
              className={[
                'rolling-subtitle-row',
                highlighted ? 'highlighted' : '',
              ].filter(Boolean).join(' ')}
              data-cue-index={index}
              data-highlighted={highlighted ? 'true' : 'false'}
              key={cue.id}
              onClick={() => onCueClick?.(cue)}
              style={{ fontSize: highlighted ? fontSize + 2 : fontSize }}
              type="button"
            >
              <strong>{cue.text}</strong>
            </button>
          )
        })}
      </div>
      <div
        className="rolling-subtitle-resize-handle"
        onPointerDown={(event) => startDrag(event, 'resize')}
        title="Resize rolling subtitles"
      />
    </div>
  )
}

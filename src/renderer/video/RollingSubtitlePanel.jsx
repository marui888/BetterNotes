import { useEffect, useRef, useState } from 'react'
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
const LOOK_BACK = 4
const LOOK_AHEAD = 8
const SOFT_CORRECTION_PX_PER_SECOND = 36
const BOTTOM_CLUSTER_CORRECTION_PX_PER_SECOND = 72
const STRONG_CORRECTION_PX_PER_SECOND = 180
const MAX_FRAME_DELTA_MS = 80
const VISIBLE_HANDLE_SIZE = 24
const COMFORT_TOP_RATIO = 0.18
const COMFORT_BOTTOM_RATIO = 0.82
const BOTTOM_CLUSTER_LOOK_AHEAD = 2
const BOTTOM_CLUSTER_RATIO = 0.7

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max))
}

function applyLimitedCorrection(currentOffset, targetOffset, maxStep) {
  const correction = targetOffset - currentOffset
  return currentOffset + clamp(correction, -maxStep, maxStep)
}

function getVisibleMetrics(container, list) {
  const stageRect = container?.getBoundingClientRect()
  const listRect = list?.getBoundingClientRect()
  if (!stageRect || !listRect) return null

  const visibleTopInList = Math.max(0, stageRect.top - listRect.top)
  const visibleBottomInList = Math.min(listRect.height, stageRect.bottom - listRect.top)
  const visibleHeight = visibleBottomInList - visibleTopInList
  if (visibleHeight <= 0) return null

  return {
    visibleTop: visibleTopInList,
    visibleBottom: visibleBottomInList,
    visibleHeight,
    targetCenter: visibleTopInList + (visibleHeight / 2),
    comfortTop: visibleTopInList + (visibleHeight * COMFORT_TOP_RATIO),
    comfortBottom: visibleTopInList + (visibleHeight * COMFORT_BOTTOM_RATIO),
    bottomClusterStart: visibleTopInList + (visibleHeight * BOTTOM_CLUSTER_RATIO),
  }
}

function buildMotionPlan(cues, layouts, viewportHeight) {
  if (!Array.isArray(cues) || cues.length === 0 || layouts.length === 0) return []

  return cues.map((cue, index) => {
    const layout = layouts[index]
    if (!layout) return { speed: 0, centerOffset: 0 }

    const startIndex = Math.max(0, index - LOOK_BACK)
    const endIndex = Math.min(cues.length - 1, index + LOOK_AHEAD)
    const startLayout = layouts[startIndex] || layout
    const endLayout = layouts[endIndex] || layout
    const startCue = cues[startIndex] || cue
    const endCue = cues[endIndex] || cue
    const startOffset = (viewportHeight / 2) - startLayout.center
    const endOffset = (viewportHeight / 2) - endLayout.center
    const timeSpan = Math.max(0.1, Number(endCue.start) - Number(startCue.start))

    return {
      speed: (endOffset - startOffset) / timeSpan,
      centerOffset: (viewportHeight / 2) - layout.center,
    }
  })
}

function findActiveCueIndexNear(cues, currentTime, previousIndex) {
  if (!Array.isArray(cues) || cues.length === 0) return -1
  const time = Number(currentTime)
  if (!Number.isFinite(time)) return -1

  const startIndex = Math.max(0, Math.min(cues.length - 1, Number(previousIndex) || 0))
  const currentCue = cues[startIndex]
  if (currentCue && time >= currentCue.start && time <= currentCue.end) return startIndex

  if (currentCue && time > currentCue.end) {
    for (let index = startIndex + 1; index < cues.length; index += 1) {
      const cue = cues[index]
      if (time >= cue.start && time <= cue.end) return index
      if (cue.start > time) return Math.max(0, index - 1)
    }
    return cues.length - 1
  }

  for (let index = startIndex - 1; index >= 0; index -= 1) {
    const cue = cues[index]
    if (time >= cue.start && time <= cue.end) return index
    if (cue.end < time) return index
  }

  return getActiveSubtitleCueIndex(cues, time)
}

export default function RollingSubtitlePanel({
  bottomPanelRef,
  containerRef,
  cues = [],
  currentTime = 0,
  darkModeActive = false,
  darkLayoutRequest = 0,
  defaultFontSize = DEFAULT_FONT_SIZE,
  getCurrentTime,
  onCueClick,
}) {
  const listRef = useRef(null)
  const trackRef = useRef(null)
  const dragRef = useRef(null)
  const initializedRectRef = useRef(false)
  const activeIndexRef = useRef(-1)
  const trackOffsetRef = useRef(0)
  const cueLayoutsRef = useRef([])
  const motionPlanRef = useRef([])
  const visibleMetricsRef = useRef(null)
  const viewportHeightRef = useRef(0)
  const trackHeightRef = useRef(0)
  const lastFrameTimeRef = useRef(0)
  const lastVideoTimeRef = useRef(currentTime)
  const currentTimeRef = useRef(currentTime)
  const getCurrentTimeRef = useRef(getCurrentTime)
  const rectRef = useRef(DEFAULT_RECT)
  const rectBeforeDarkModeRef = useRef(null)
  const darkModeActiveRef = useRef(false)
  const [rect, setRect] = useState(DEFAULT_RECT)
  const [fontSize, setFontSize] = useState(() => clamp(Number(defaultFontSize) || DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE))
  const [activeIndex, setActiveIndex] = useState(() => getActiveSubtitleCueIndex(cues, currentTime))

  useEffect(() => {
    rectRef.current = rect
  }, [rect])

  const rebuildLayoutAndMotionPlan = () => {
    const list = listRef.current
    const track = trackRef.current
    if (!list || !track) return

    const rows = [...track.querySelectorAll('[data-cue-index]')]
    const layouts = rows.map((row) => ({
      top: row.offsetTop,
      height: row.clientHeight,
      center: row.offsetTop + (row.clientHeight / 2),
    }))
    const viewportHeight = list.clientHeight
    cueLayoutsRef.current = layouts
    viewportHeightRef.current = viewportHeight
    trackHeightRef.current = track.scrollHeight
    motionPlanRef.current = buildMotionPlan(cues, layouts, viewportHeight)
    visibleMetricsRef.current = getVisibleMetrics(containerRef?.current, list)
  }

  const refreshVisibleMetrics = () => {
    visibleMetricsRef.current = getVisibleMetrics(containerRef?.current, listRef.current)
  }

  useEffect(() => {
    setFontSize(clamp(Number(defaultFontSize) || DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE))
  }, [defaultFontSize])

  useEffect(() => {
    currentTimeRef.current = currentTime
    getCurrentTimeRef.current = getCurrentTime
  })

  useEffect(() => {
    activeIndexRef.current = -1
    trackOffsetRef.current = 0
    lastFrameTimeRef.current = 0
    lastVideoTimeRef.current = currentTimeRef.current
    setActiveIndex(getActiveSubtitleCueIndex(cues, currentTimeRef.current))
    const track = trackRef.current
    if (track) track.style.transform = 'translate3d(0, 0, 0)'
  }, [cues, fontSize])

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
    if (!darkModeActive && darkModeActiveRef.current && rectBeforeDarkModeRef.current) {
      setRect(rectBeforeDarkModeRef.current)
      rectBeforeDarkModeRef.current = null
      window.requestAnimationFrame(rebuildLayoutAndMotionPlan)
    }

    darkModeActiveRef.current = darkModeActive
  }, [darkModeActive])

  useEffect(() => {
    if (!darkLayoutRequest) return

    const stageRect = containerRef?.current?.getBoundingClientRect()
    if (!stageRect?.width || !stageRect?.height) return

    if (!rectBeforeDarkModeRef.current) rectBeforeDarkModeRef.current = rectRef.current

    const bottomRect = bottomPanelRef?.current?.getBoundingClientRect()
    const bottomTop = bottomRect ? bottomRect.top - stageRect.top : stageRect.height
    const availableHeight = bottomTop > MIN_HEIGHT ? bottomTop : stageRect.height
    const nextWidth = Math.max(MIN_WIDTH, Math.round(stageRect.width * 0.7))
    const nextHeight = Math.max(
      MIN_HEIGHT,
      Math.min(Math.round(stageRect.height), Math.round(availableHeight)),
    )

    setRect({
      x: Math.max(0, Math.round((stageRect.width - nextWidth) / 2)),
      y: 0,
      width: nextWidth,
      height: nextHeight,
    })
    window.requestAnimationFrame(rebuildLayoutAndMotionPlan)
  }, [bottomPanelRef, containerRef, darkLayoutRequest])

  useEffect(() => {
    let animationId = 0
    const tick = (frameTime) => {
      const nextTime = Number(getCurrentTimeRef.current?.())
      const resolvedTime = Number.isFinite(nextTime) ? nextTime : currentTimeRef.current
      const nextActiveIndex = findActiveCueIndexNear(cues, resolvedTime, activeIndexRef.current)
      const list = listRef.current
      const track = trackRef.current
      const previousActiveIndex = activeIndexRef.current

      if (nextActiveIndex !== activeIndexRef.current) {
        activeIndexRef.current = nextActiveIndex
        setActiveIndex(nextActiveIndex)
      }

      if (list && track && nextActiveIndex >= 0) {
        const layout = cueLayoutsRef.current[nextActiveIndex]
        const motion = motionPlanRef.current[nextActiveIndex]
        const visibleMetrics = visibleMetricsRef.current
        const viewportHeight = visibleMetrics?.visibleHeight || viewportHeightRef.current || list.clientHeight
        const trackHeight = trackHeightRef.current || track.scrollHeight
        const minOffset = Math.min(0, (visibleMetrics?.visibleBottom ?? list.clientHeight) - trackHeight)
        const maxOffset = visibleMetrics?.visibleTop ?? 0
        const frameDelta = lastFrameTimeRef.current
          ? Math.min(MAX_FRAME_DELTA_MS, Math.max(0, frameTime - lastFrameTimeRef.current))
          : 0
        const frameTimeStep = frameDelta / 1000
        const videoDelta = resolvedTime - lastVideoTimeRef.current
        const isPlayingForward = videoDelta > 0 && videoDelta < 1
        const timeStep = isPlayingForward ? videoDelta : 0
        const correctionScale = Math.max(frameTimeStep, timeStep)
        let nextOffset = trackOffsetRef.current

        if (layout && motion) {
          const centerOffset = visibleMetrics
            ? visibleMetrics.targetCenter - layout.center
            : motion.centerOffset
          if (previousActiveIndex < 0 || !lastFrameTimeRef.current || Math.abs(videoDelta) >= 1 || videoDelta < 0) {
            nextOffset = centerOffset
          } else if (isPlayingForward) {
            nextOffset += motion.speed * timeStep
          }

          const screenTop = layout.top + nextOffset
          const screenBottom = screenTop + layout.height
          const screenCenter = layout.center + nextOffset
          const visibleTop = visibleMetrics?.visibleTop ?? 0
          const visibleBottom = visibleMetrics?.visibleBottom ?? list.clientHeight
          const isFullyVisible = screenTop >= visibleTop && screenBottom <= visibleBottom
          const comfortTop = visibleMetrics?.comfortTop ?? (list.clientHeight * COMFORT_TOP_RATIO)
          const comfortBottom = visibleMetrics?.comfortBottom ?? (list.clientHeight * COMFORT_BOTTOM_RATIO)
          const isInComfortZone = screenCenter >= comfortTop && screenCenter <= comfortBottom
          const bottomClusterStart = visibleMetrics?.bottomClusterStart ?? (list.clientHeight * BOTTOM_CLUSTER_RATIO)
          const bottomClusterEndIndex = Math.min(
            cues.length - 1,
            nextActiveIndex + BOTTOM_CLUSTER_LOOK_AHEAD
          )
          const hasBottomCluster = nextActiveIndex < bottomClusterEndIndex
            && Array.from({ length: bottomClusterEndIndex - nextActiveIndex + 1 }, (_item, offset) => {
              const clusterLayout = cueLayoutsRef.current[nextActiveIndex + offset]
              return clusterLayout && clusterLayout.center + nextOffset >= bottomClusterStart
            }).every(Boolean)

          if (!isFullyVisible) {
            nextOffset = applyLimitedCorrection(nextOffset, centerOffset, STRONG_CORRECTION_PX_PER_SECOND * correctionScale)
          } else if (hasBottomCluster) {
            nextOffset = applyLimitedCorrection(nextOffset, centerOffset, BOTTOM_CLUSTER_CORRECTION_PX_PER_SECOND * correctionScale)
          } else if (!isInComfortZone) {
            nextOffset = applyLimitedCorrection(nextOffset, centerOffset, SOFT_CORRECTION_PX_PER_SECOND * correctionScale)
          }
        }

        nextOffset = clamp(nextOffset, minOffset, maxOffset)
        trackOffsetRef.current = nextOffset
        track.style.transform = `translate3d(0, ${nextOffset}px, 0)`
      }

      lastFrameTimeRef.current = frameTime
      lastVideoTimeRef.current = resolvedTime
      animationId = window.requestAnimationFrame(tick)
    }

    animationId = window.requestAnimationFrame(tick)
    return () => {
      window.cancelAnimationFrame(animationId)
    }
  }, [cues])

  useEffect(() => {
    rebuildLayoutAndMotionPlan()
    const track = trackRef.current

    const liveTime = Number(getCurrentTimeRef.current?.())
    const currentIndex = findActiveCueIndexNear(
      cues,
      Number.isFinite(liveTime) ? liveTime : currentTimeRef.current,
      activeIndexRef.current
    )
    const currentMotion = motionPlanRef.current[currentIndex]
    if (currentMotion && track) {
      const layout = cueLayoutsRef.current[currentIndex]
      const visibleMetrics = getVisibleMetrics(containerRef?.current, listRef.current)
      const nextOffset = layout && visibleMetrics
        ? visibleMetrics.targetCenter - layout.center
        : currentMotion.centerOffset
      trackOffsetRef.current = nextOffset
      track.style.transform = `translate3d(0, ${nextOffset}px, 0)`
    }
  }, [cues, fontSize, rect.height, rect.width])

  useEffect(() => {
    const list = listRef.current
    const track = trackRef.current
    if (!window.ResizeObserver || !list || !track) return undefined

    let animationId = 0
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(animationId)
      animationId = window.requestAnimationFrame(rebuildLayoutAndMotionPlan)
    })

    observer.observe(list)
    observer.observe(track)
    return () => {
      window.cancelAnimationFrame(animationId)
      observer.disconnect()
    }
  }, [cues])

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
          x: clamp(drag.rect.x + dx, -current.width + VISIBLE_HANDLE_SIZE, maxWidth - VISIBLE_HANDLE_SIZE),
          y: clamp(drag.rect.y + dy, 0, Math.max(0, maxHeight - VISIBLE_HANDLE_SIZE)),
        }))
        window.requestAnimationFrame(refreshVisibleMetrics)
        return
      }

      setRect((current) => {
        if (drag.type === 'resize-ne') {
          const maxHeightFromTop = drag.rect.y + drag.rect.height
          const nextY = clamp(drag.rect.y + dy, 0, Math.max(0, maxHeightFromTop - MIN_HEIGHT))
          const width = clamp(drag.rect.width + dx, MIN_WIDTH, maxWidth - current.x)
          const height = clamp(maxHeightFromTop - nextY, MIN_HEIGHT, maxHeight - nextY)
          window.requestAnimationFrame(refreshVisibleMetrics)
          return { ...current, y: nextY, width, height }
        }

        const width = clamp(drag.rect.width + dx, MIN_WIDTH, maxWidth - current.x)
        const height = clamp(drag.rect.height + dy, MIN_HEIGHT, maxHeight - current.y)
        window.requestAnimationFrame(refreshVisibleMetrics)
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
          <span className="rolling-subtitle-font-size">{fontSize}px</span>
          <button
            aria-label="Increase subtitle font size"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => changeFontSize(event, 1)}
            title="Font larger"
            type="button"
          >
            +
          </button>
        </span>
      </div>
      <div className="rolling-subtitle-list" ref={listRef}>
        <div className="rolling-subtitle-track" ref={trackRef}>
          {cues.length === 0 ? (
            <div className="rolling-subtitle-empty">No subtitle cues.</div>
          ) : cues.map((cue, index) => {
            const highlighted = activeIndex >= 0 && index === activeIndex
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
                style={{ fontSize }}
                type="button"
              >
                <strong>{cue.text}</strong>
              </button>
            )
          })}
        </div>
      </div>
      <div
        className="rolling-subtitle-resize-handle ne"
        onPointerDown={(event) => startDrag(event, 'resize-ne')}
        title="Resize rolling subtitles"
      />
      <div
        className="rolling-subtitle-resize-handle"
        onPointerDown={(event) => startDrag(event, 'resize')}
        title="Resize rolling subtitles"
      />
    </div>
  )
}

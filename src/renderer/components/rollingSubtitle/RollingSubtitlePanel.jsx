import { useEffect, useMemo, useRef, useState } from 'react'
import {
  findActiveCueIndexNear,
  formatTimingOffset,
  getActiveSubtitleCueIndex,
} from './subtitleTiming'
import {
  BOTTOM_CLUSTER_CORRECTION_PX_PER_SECOND,
  BOTTOM_CLUSTER_LOOK_AHEAD,
  BOTTOM_CLUSTER_RATIO,
  COMFORT_BOTTOM_RATIO,
  COMFORT_TOP_RATIO,
  DISPLAY_OFFSET_SMOOTHING,
  DISPLAY_OFFSET_SNAP_THRESHOLD,
  FLOAT_OFFSET_SMOOTHING,
  FLOAT_RESCUE_CORRECTION_PX_PER_SECOND,
  MAX_FRAME_DELTA_MS,
  SOFT_CORRECTION_PX_PER_SECOND,
  STRONG_CORRECTION_PX_PER_SECOND,
  applyLimitedCorrection,
  buildFloatCurve,
  buildMotionPlan,
  clamp,
  getFloatCurveOffset,
  getVisibleMetrics,
} from './subtitleMotion'
import {
  buildRenderWindow,
  shouldUpdateRenderWindow,
} from './subtitleWindowing'
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
const MAX_FONT_SIZE = 92
const DEFAULT_FONT_SIZE = 25
const FONT_SIZE_PRESETS = [12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 42, 48, 60, 72, 84, 92]
const VISIBLE_HANDLE_SIZE = 24
const MIN_TIMING_OFFSET = -5
const MAX_TIMING_OFFSET = 5
const DOCK_POSITIONS = ['left', 'center', 'right']

export default function RollingSubtitlePanel({
  bottomPanelRef,
  containerRef,
  cues = [],
  currentTime = 0,
  subtitleCenterModeActive = false,
  subtitleCenterLayout = 0,
  subtitleCenterLayoutRequest = 0,
  subtitleCenterViewDim = 0.65,
  enableSubtitleCenterLayout = false,
  enableSubtitleNoteAdding = false,
  hvLayout = 0,
  subtitleHidden = false,
  videoViewHidden = false,
  defaultFontSize = DEFAULT_FONT_SIZE,
  fontSizeKey = 'normal',
  getCurrentTime,
  onAddSelectedSubtitles,
  onPickSelectedSubtitles,
  pickSubRequest = 0,
  onToggleHvLayout,
  onToggleSubtitleHidden,
  onToggleVideoViewHidden,
  onSelectedSubtitlesChange,
  onCueClick,
}) {
  const listRef = useRef(null)
  const trackRef = useRef(null)
  const dragRef = useRef(null)
  const initializedRectRef = useRef(false)
  const activeIndexRef = useRef(-1)
  const renderWindowRef = useRef(buildRenderWindow(0, cues.length))
  const pendingWindowAnchorRef = useRef(null)
  const trackOffsetRef = useRef(0)
  const displayOffsetRef = useRef(0)
  const floatCurveRef = useRef([])
  const floatOffsetRef = useRef(0)
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
  const subtitleNoteAddingRef = useRef(false)
  const rectBeforeSubtitleCenterModeRef = useRef(null)
  const subtitleCenterModeActiveRef = useRef(false)
  const subtitleCenterModeSessionSizeRef = useRef(null)
  const [rect, setRect] = useState(DEFAULT_RECT)
  const [fontSizeByView, setFontSizeByView] = useState(() => {
    const initialFontSize = clamp(Number(defaultFontSize) || DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE)
    return {
      normal: initialFontSize,
      overlay: initialFontSize,
      subtitleCenter: initialFontSize,
    }
  })
  const [timingOffset, setTimingOffset] = useState(0)
  const initialActiveIndex = getActiveSubtitleCueIndex(cues, currentTime)
  const [activeIndex, setActiveIndex] = useState(() => initialActiveIndex)
  const [renderWindow, setRenderWindow] = useState(() => buildRenderWindow(initialActiveIndex, cues.length))
  const [localSubtitleHidden, setLocalSubtitleHidden] = useState(false)
  const [scrollMode, setScrollMode] = useState('follow')
  const [dockPosition, setDockPosition] = useState('left')
  const [subtitleNoteAdding, setSubtitleNoteAdding] = useState(false)
  const [selectedCueIds, setSelectedCueIds] = useState(() => new Set())
  const selectedCues = useMemo(() => (
    cues.filter((cue) => selectedCueIds.has(cue.id))
  ), [cues, selectedCueIds])
  const visibleCues = useMemo(() => (
    cues.slice(renderWindow.start, renderWindow.end)
  ), [cues, renderWindow])
  const resolvedFontSizeKey = ['normal', 'overlay', 'subtitleCenter'].includes(fontSizeKey) ? fontSizeKey : 'normal'
  const fallbackFontSize = clamp(Number(defaultFontSize) || DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE)
  const fontSize = clamp(Number(fontSizeByView[resolvedFontSizeKey]) || fallbackFontSize, MIN_FONT_SIZE, MAX_FONT_SIZE)
  const subtitleCenterViewDimNumber = Number(subtitleCenterViewDim)
  const subtitleCenterLayoutActive = enableSubtitleCenterLayout && subtitleCenterModeActive
  const subtitleNoteAddingActive = enableSubtitleNoteAdding && subtitleNoteAdding
  const effectiveSubtitleHidden = typeof subtitleHidden === 'boolean' ? subtitleHidden : localSubtitleHidden
  const hvLayoutLabel = Number(hvLayout) === 1 ? 'V' : 'H'
  const videoViewHiddenLabel = videoViewHidden ? 'Show View' : 'Hide View'
  const addSubsDisabled = effectiveSubtitleHidden || !enableSubtitleNoteAdding || cues.length === 0

  const getEffectiveTime = (time) => {
    const number = Number(time)
    return (Number.isFinite(number) ? number : 0) + timingOffset
  }

  const getVisualTrackOffset = () => (
    scrollMode === 'float' ? floatOffsetRef.current : displayOffsetRef.current
  )

  const clampTrackOffset = (offset) => {
    const list = listRef.current
    if (!list) return offset
    const visibleMetrics = getVisibleMetrics(containerRef?.current, list)
    const trackHeight = trackHeightRef.current || trackRef.current?.scrollHeight || 0
    const minOffset = Math.min(0, (visibleMetrics?.visibleBottom ?? list.clientHeight) - trackHeight)
    const maxOffset = visibleMetrics?.visibleTop ?? 0
    return clamp(offset, minOffset, maxOffset)
  }

  const setVisualTrackOffset = (offset) => {
    const track = trackRef.current
    if (!track) return
    const nextOffset = clampTrackOffset(offset)
    if (scrollMode === 'float') {
      floatOffsetRef.current = nextOffset
    } else {
      trackOffsetRef.current = nextOffset
      displayOffsetRef.current = nextOffset
    }
    track.style.transform = 'translate3d(0, ' + nextOffset + 'px, 0)'
  }

  const updateRenderWindowForIndex = (index, force = false) => {
    if (!force && !shouldUpdateRenderWindow(index, renderWindowRef.current, cues.length)) return false
    const nextWindow = buildRenderWindow(index, cues.length)
    const currentWindow = renderWindowRef.current
    if (nextWindow.start === currentWindow.start && nextWindow.end === currentWindow.end) return false
    const row = trackRef.current?.querySelector('[data-cue-index="' + index + '"]')
    pendingWindowAnchorRef.current = row
      ? {
        index,
        screenCenter: row.offsetTop + (row.clientHeight / 2) + getVisualTrackOffset(),
      }
      : null
    renderWindowRef.current = nextWindow
    setRenderWindow(nextWindow)
    return true
  }

  useEffect(() => {
    renderWindowRef.current = renderWindow
    const anchor = pendingWindowAnchorRef.current
    if (!anchor) return

    window.requestAnimationFrame(() => {
      rebuildLayoutAndMotionPlan()
      const layout = cueLayoutsRef.current[anchor.index]
      if (!layout) {
        pendingWindowAnchorRef.current = null
        return
      }

      setVisualTrackOffset(anchor.screenCenter - layout.center)
      pendingWindowAnchorRef.current = null
    })
  }, [renderWindow, scrollMode])

  useEffect(() => {
    if (enableSubtitleNoteAdding) return
    setSubtitleNoteAdding(false)
    clearSelectedCues()
  }, [enableSubtitleNoteAdding])

  useEffect(() => {
    rectRef.current = rect
  }, [rect])

  const rebuildLayoutAndMotionPlan = () => {
    const list = listRef.current
    const track = trackRef.current
    if (!list || !track) return

    const rows = [...track.querySelectorAll('[data-cue-index]')]
    const layouts = []
    rows.forEach((row) => {
      const index = Number(row.dataset.cueIndex)
      if (!Number.isInteger(index)) return
      layouts[index] = {
        top: row.offsetTop,
        height: row.clientHeight,
        center: row.offsetTop + (row.clientHeight / 2),
      }
    })
    const viewportHeight = list.clientHeight
    cueLayoutsRef.current = layouts
    viewportHeightRef.current = viewportHeight
    trackHeightRef.current = track.scrollHeight
    motionPlanRef.current = buildMotionPlan(cues, layouts, viewportHeight)
    visibleMetricsRef.current = getVisibleMetrics(containerRef?.current, list)
    floatCurveRef.current = buildFloatCurve(cues, layouts, visibleMetricsRef.current, viewportHeight)
  }

  const refreshVisibleMetrics = () => {
    visibleMetricsRef.current = getVisibleMetrics(containerRef?.current, listRef.current)
  }

  const syncTrackToCurrentCue = () => {
    rebuildLayoutAndMotionPlan()
    const track = trackRef.current

    const liveTime = Number(getCurrentTimeRef.current?.())
    const effectiveTime = getEffectiveTime(Number.isFinite(liveTime) ? liveTime : currentTimeRef.current)
    const currentIndex = findActiveCueIndexNear(cues, effectiveTime, activeIndexRef.current)
    if (currentIndex >= 0 && updateRenderWindowForIndex(currentIndex)) return

    if (scrollMode === 'float') {
      const nextOffset = getFloatCurveOffset(floatCurveRef.current, effectiveTime)
      if (Number.isFinite(nextOffset) && track) {
        floatOffsetRef.current = nextOffset
        track.style.transform = `translate3d(0, ${nextOffset}px, 0)`
      }
      return
    }

    const currentMotion = motionPlanRef.current[currentIndex]
    if (currentMotion && track) {
      const layout = cueLayoutsRef.current[currentIndex]
      const visibleMetrics = getVisibleMetrics(containerRef?.current, listRef.current)
      const nextOffset = layout && visibleMetrics
        ? visibleMetrics.targetCenter - layout.center
        : currentMotion.centerOffset
      trackOffsetRef.current = nextOffset
      displayOffsetRef.current = nextOffset
      track.style.transform = `translate3d(0, ${nextOffset}px, 0)`
    }
  }

  useEffect(() => {
    subtitleNoteAddingRef.current = subtitleNoteAdding
    if (!subtitleNoteAdding) {
      window.requestAnimationFrame(syncTrackToCurrentCue)
    }
  }, [subtitleNoteAddingActive])

  useEffect(() => {
    const nextDefaultFontSize = clamp(Number(defaultFontSize) || DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE)
    setFontSizeByView((current) => {
      const next = { ...current }
      let changed = false
      ;['normal', 'overlay', 'subtitleCenter'].forEach((key) => {
        if (!Number.isFinite(Number(next[key]))) {
          next[key] = nextDefaultFontSize
          changed = true
        }
      })
      return changed ? next : current
    })
  }, [defaultFontSize])

  useEffect(() => {
    currentTimeRef.current = currentTime
    getCurrentTimeRef.current = getCurrentTime
  })

  useEffect(() => {
    const nextActiveIndex = getActiveSubtitleCueIndex(cues, getEffectiveTime(currentTimeRef.current))
    const nextWindow = buildRenderWindow(nextActiveIndex, cues.length)
    activeIndexRef.current = -1
    renderWindowRef.current = nextWindow
    trackOffsetRef.current = 0
    displayOffsetRef.current = 0
    floatOffsetRef.current = 0
    lastFrameTimeRef.current = 0
    lastVideoTimeRef.current = getEffectiveTime(currentTimeRef.current)
    setActiveIndex(nextActiveIndex)
    setRenderWindow(nextWindow)
    const track = trackRef.current
    if (track) track.style.transform = 'translate3d(0, 0, 0)'
  }, [cues, fontSize, timingOffset, scrollMode])

  useEffect(() => {
    setSelectedCueIds((current) => {
      if (current.size === 0) return current
      const validIds = new Set(cues.map((cue) => cue.id))
      const next = new Set([...current].filter((id) => validIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [cues])

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
    if (!subtitleCenterModeActive && subtitleCenterModeActiveRef.current && rectBeforeSubtitleCenterModeRef.current) {
      setRect(rectBeforeSubtitleCenterModeRef.current)
      rectBeforeSubtitleCenterModeRef.current = null
      window.requestAnimationFrame(rebuildLayoutAndMotionPlan)
    }

    subtitleCenterModeActiveRef.current = subtitleCenterModeActive
  }, [subtitleCenterModeActive])

  useEffect(() => {
    if (!enableSubtitleCenterLayout || !subtitleCenterLayoutRequest) return

    const stageRect = containerRef?.current?.getBoundingClientRect()
    if (!stageRect?.width || !stageRect?.height) return

    if (!rectBeforeSubtitleCenterModeRef.current) rectBeforeSubtitleCenterModeRef.current = rectRef.current

    const bottomRect = bottomPanelRef?.current?.getBoundingClientRect()
    const bottomTop = bottomRect ? bottomRect.top - stageRect.top : stageRect.height
    const availableHeight = bottomTop > MIN_HEIGHT ? bottomTop : stageRect.height
    const sessionSize = subtitleCenterModeSessionSizeRef.current
    const widthSource = Number.isFinite(Number(sessionSize?.width))
      ? Number(sessionSize.width)
      : Math.round(stageRect.width * 0.5)
    const nextWidth = clamp(widthSource, MIN_WIDTH, Math.round(stageRect.width))
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
  }, [bottomPanelRef, containerRef, subtitleCenterLayoutRequest, enableSubtitleCenterLayout])

  useEffect(() => {
    let animationId = 0
    const tick = (frameTime) => {
      const nextTime = Number(getCurrentTimeRef.current?.())
      const resolvedTime = Number.isFinite(nextTime) ? nextTime : currentTimeRef.current
      const effectiveTime = getEffectiveTime(resolvedTime)
      const nextActiveIndex = findActiveCueIndexNear(cues, effectiveTime, activeIndexRef.current)
      const list = listRef.current
      const track = trackRef.current
      const previousActiveIndex = activeIndexRef.current

      if (nextActiveIndex !== activeIndexRef.current) {
        activeIndexRef.current = nextActiveIndex
        setActiveIndex(nextActiveIndex)
      }

      if (nextActiveIndex >= 0 && updateRenderWindowForIndex(nextActiveIndex)) {
        lastFrameTimeRef.current = frameTime
        lastVideoTimeRef.current = effectiveTime
        animationId = window.requestAnimationFrame(tick)
        return
      }

      if (list && track && nextActiveIndex >= 0 && !subtitleNoteAddingRef.current) {
        const layout = cueLayoutsRef.current[nextActiveIndex]
        const motion = motionPlanRef.current[nextActiveIndex]
        const visibleMetrics = visibleMetricsRef.current
        const trackHeight = trackHeightRef.current || track.scrollHeight
        const minOffset = Math.min(0, (visibleMetrics?.visibleBottom ?? list.clientHeight) - trackHeight)
        const maxOffset = visibleMetrics?.visibleTop ?? 0
        const frameDelta = lastFrameTimeRef.current
          ? Math.min(MAX_FRAME_DELTA_MS, Math.max(0, frameTime - lastFrameTimeRef.current))
          : 0
        const frameTimeStep = frameDelta / 1000
        const videoDelta = effectiveTime - lastVideoTimeRef.current
        const isPlayingForward = videoDelta > 0 && videoDelta < 1
        const timeStep = isPlayingForward ? videoDelta : 0
        const correctionScale = Math.max(frameTimeStep, timeStep)

        if (scrollMode === 'float') {
          const curveOffset = getFloatCurveOffset(floatCurveRef.current, effectiveTime)
          let nextOffset = Number.isFinite(curveOffset) ? curveOffset : floatOffsetRef.current
          let targetOffset = nextOffset
          let shouldSnapFloatOffset = previousActiveIndex < 0 || !lastFrameTimeRef.current || Math.abs(videoDelta) >= 1 || videoDelta < 0

          if (layout && visibleMetrics) {
            const screenTop = layout.top + targetOffset
            const screenBottom = screenTop + layout.height
            const isFullyVisible = screenTop >= visibleMetrics.visibleTop && screenBottom <= visibleMetrics.visibleBottom
            if (!isFullyVisible) {
              const centerOffset = visibleMetrics.targetCenter - layout.center
              targetOffset = applyLimitedCorrection(targetOffset, centerOffset, FLOAT_RESCUE_CORRECTION_PX_PER_SECOND * correctionScale)
            }
          }

          targetOffset = clamp(targetOffset, minOffset, maxOffset)
          const currentFloatOffset = floatOffsetRef.current
          const smoothing = 1 - ((1 - FLOAT_OFFSET_SMOOTHING) ** Math.max(1, frameDelta / 16.67))
          nextOffset = shouldSnapFloatOffset
            ? targetOffset
            : currentFloatOffset + ((targetOffset - currentFloatOffset) * smoothing)
          if (Math.abs(nextOffset - targetOffset) < DISPLAY_OFFSET_SNAP_THRESHOLD) nextOffset = targetOffset
          floatOffsetRef.current = nextOffset
          track.style.transform = `translate3d(0, ${nextOffset}px, 0)`
        } else {
          let nextOffset = trackOffsetRef.current
          let shouldSnapDisplayOffset = false

          if (layout && motion) {
            const centerOffset = visibleMetrics
              ? visibleMetrics.targetCenter - layout.center
              : motion.centerOffset
            if (previousActiveIndex < 0 || !lastFrameTimeRef.current || Math.abs(videoDelta) >= 1 || videoDelta < 0) {
              nextOffset = centerOffset
              shouldSnapDisplayOffset = true
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

          const currentDisplayOffset = displayOffsetRef.current
          const smoothing = 1 - ((1 - DISPLAY_OFFSET_SMOOTHING) ** Math.max(1, frameDelta / 16.67))
          const nextDisplayOffset = shouldSnapDisplayOffset
            ? nextOffset
            : currentDisplayOffset + ((nextOffset - currentDisplayOffset) * smoothing)
          const resolvedDisplayOffset = Math.abs(nextDisplayOffset - nextOffset) < DISPLAY_OFFSET_SNAP_THRESHOLD
            ? nextOffset
            : nextDisplayOffset
          displayOffsetRef.current = resolvedDisplayOffset
          track.style.transform = `translate3d(0, ${resolvedDisplayOffset}px, 0)`
        }
      }

      lastFrameTimeRef.current = frameTime
      lastVideoTimeRef.current = effectiveTime
      animationId = window.requestAnimationFrame(tick)
    }

    animationId = window.requestAnimationFrame(tick)
    return () => {
      window.cancelAnimationFrame(animationId)
    }
  }, [cues, timingOffset, scrollMode])

  useEffect(() => {
    if (pendingWindowAnchorRef.current) return
    syncTrackToCurrentCue()
  }, [cues, fontSize, rect.height, rect.width, timingOffset, renderWindow])

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
  }, [cues, renderWindow])

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
        if (subtitleCenterModeActive) {
          const direction = drag.type === 'resize-ne' ? -1 : 1
          const width = clamp(drag.rect.width + (dx * direction), MIN_WIDTH, maxWidth)
          const x = Math.max(0, Math.round((maxWidth - width) / 2))
          subtitleCenterModeSessionSizeRef.current = { width }
          window.requestAnimationFrame(refreshVisibleMetrics)
          return { ...current, x, width, height: drag.rect.height }
        }

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
  }, [containerRef, subtitleCenterModeActive])

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

  const applyDockPosition = (position) => {
    const bounds = containerRef?.current?.getBoundingClientRect()
    if (!bounds?.width || !bounds?.height) return

    const width = Math.min(bounds.width, Math.max(MIN_WIDTH, Math.round(bounds.width * 0.48)))
    const height = Math.min(bounds.height, Math.max(MIN_HEIGHT, Math.round(bounds.height * 0.95)))
    const x = position === 'left'
      ? 0
      : position === 'right'
        ? Math.max(0, Math.round(bounds.width - width))
        : Math.max(0, Math.round((bounds.width - width) / 2))
    const y = Math.max(0, Math.round((bounds.height - height) / 2))

    setRect({ x, y, width, height })
    window.requestAnimationFrame(syncTrackToCurrentCue)
  }

  const toggleDockPosition = (event) => {
    event.preventDefault()
    event.stopPropagation()
    setDockPosition((current) => {
      const currentIndex = Math.max(0, DOCK_POSITIONS.indexOf(current))
      const next = DOCK_POSITIONS[(currentIndex + 1) % DOCK_POSITIONS.length]
      applyDockPosition(next)
      return next
    })
  }

  const changeTimingOffset = (event, step) => {
    event.preventDefault()
    event.stopPropagation()
    setTimingOffset((value) => {
      const nextValue = Math.round((value + step) * 10) / 10
      return clamp(nextValue, MIN_TIMING_OFFSET, MAX_TIMING_OFFSET)
    })
  }

  const selectFontSize = (event) => {
    event.preventDefault()
    event.stopPropagation()
    const nextFontSize = Number(event.target.value)
    if (!Number.isFinite(nextFontSize)) return
    setFontSizeByView((current) => ({
      ...current,
      [resolvedFontSizeKey]: clamp(nextFontSize, MIN_FONT_SIZE, MAX_FONT_SIZE),
    }))
  }


  const getSelectedCuesByIds = (ids) => cues.filter((cue) => ids.has(cue.id))

  const toggleCueSelection = (event, cue) => {
    event.stopPropagation()
    const next = new Set(selectedCueIds)
    if (next.has(cue.id)) {
      next.delete(cue.id)
    } else {
      next.add(cue.id)
    }
    setSelectedCueIds(next)
    onSelectedSubtitlesChange?.(getSelectedCuesByIds(next))
  }

  const clearSelectedCues = () => {
    setSelectedCueIds(new Set())
    onSelectedSubtitlesChange?.([])
  }

  const pickSelectedSubtitles = async () => {
    if (!subtitleNoteAdding) {
      if (addSubsDisabled) return
      setSubtitleNoteAdding(true)
      return
    }

    if (selectedCues.length === 0) {
      setSubtitleNoteAdding(false)
      clearSelectedCues()
      return
    }

    const result = onPickSelectedSubtitles
      ? await onPickSelectedSubtitles(selectedCues)
      : await onAddSelectedSubtitles?.(selectedCues)

    if (result === 'goBack') return

    setSubtitleNoteAdding(false)
    clearSelectedCues()
  }

  useEffect(() => {
    if (!pickSubRequest) return
    pickSelectedSubtitles()
  }, [pickSubRequest])

  const addSelectedSubtitles = async (event) => {
    event.preventDefault()
    event.stopPropagation()
    pickSelectedSubtitles()
  }

  return (
    <div
      className={[
        'rolling-subtitle-panel',
        subtitleCenterModeActive ? 'subtitle-center-mode' : '',
        subtitleNoteAdding ? 'subtitle-note-adding' : '',
      ].filter(Boolean).join(' ')}
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

          <select
            aria-label="Subtitle font size preset"
            onChange={selectFontSize}
            onPointerDown={(event) => event.stopPropagation()}
            title="Font size preset"
            value={FONT_SIZE_PRESETS.includes(fontSize) ? fontSize : ''}
          >
            {!FONT_SIZE_PRESETS.includes(fontSize) ? (
              <option value="">{fontSize}px</option>
            ) : null}
            {FONT_SIZE_PRESETS.map((size) => (
              <option key={size} value={size}>{size}px</option>
            ))}
          </select>
        </span>

        <span className="rolling-subtitle-timing-tools">
          <button
            aria-label="Subtitle timing earlier"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => changeTimingOffset(event, -0.1)}
            title="Timing earlier"
            type="button"
          >
            -
          </button>
          <span className="rolling-subtitle-timing-offset">{formatTimingOffset(timingOffset)}</span>
          <button
            aria-label="Subtitle timing later"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => changeTimingOffset(event, 0.1)}
            title="Timing later"
            type="button"
          >
            +
          </button>
        </span>

        <button
          aria-label="Dock rolling subtitle panel"
          className="rolling-subtitle-dock-toggle"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={toggleDockPosition}
          title={`Dock panel: ${dockPosition}`}
          type="button"
        >
          Dock
        </button>

        <button
          aria-label="Toggle rolling subtitle scroll mode"
          className="rolling-subtitle-mode-toggle"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setScrollMode((value) => (value === 'follow' ? 'float' : 'follow'))
            window.requestAnimationFrame(syncTrackToCurrentCue)
          }}
          title={scrollMode === 'follow' ? 'Switch to Float scroll mode' : 'Switch to Follow scroll mode'}
          type="button"
        >
          {scrollMode === 'follow' ? 'Follow' : 'Float'}
        </button>
        <button
          aria-label={effectiveSubtitleHidden ? 'Show rolling subtitles' : 'Hide rolling subtitles'}
          className="rolling-subtitle-hide-toggle"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (!effectiveSubtitleHidden && subtitleNoteAdding) {
              setSubtitleNoteAdding(false)
              clearSelectedCues()
            }
            if (onToggleSubtitleHidden) {
              onToggleSubtitleHidden()
              return
            }
            setLocalSubtitleHidden((value) => !value)
          }}
          disabled={subtitleNoteAddingActive}
          title={subtitleNoteAddingActive ? 'Finish subtitle picking before hiding subtitles' : effectiveSubtitleHidden ? 'Show rolling subtitles' : 'Hide rolling subtitles'}
          type="button"
        >
          {effectiveSubtitleHidden ? 'Show Sub' : 'Hide Sub'}
        </button>

        <button
          aria-label={videoViewHidden ? 'Show video view' : 'Hide video view'}
          className="rolling-subtitle-view-toggle"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onToggleVideoViewHidden?.()
          }}
          title={videoViewHidden ? 'Show video view' : 'Hide video view'}
          type="button"
        >
          {videoViewHiddenLabel}
        </button>

        <button
          aria-label="Toggle HV Layout"
          className="rolling-subtitle-layout-toggle"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onToggleHvLayout?.()
          }}
          title="Toggle HV Layout"
          type="button"
        >
          HV Layout {hvLayoutLabel}
        </button>
        {enableSubtitleNoteAdding ? (
          <button
            aria-label="Pick selected subtitles as note"
            className="rolling-subtitle-add-toggle"
            disabled={addSubsDisabled}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={addSelectedSubtitles}
            title={subtitleNoteAddingActive ? 'Pick selected subtitles as note' : 'Start subtitle selection'}
            type="button"
          >
            Pick Sub{subtitleNoteAddingActive && selectedCues.length > 0 ? ` ${selectedCues.length}` : ''}
          </button>
        ) : null}
      </div>
      <div className={effectiveSubtitleHidden ? 'rolling-subtitle-list hidden' : 'rolling-subtitle-list'} ref={listRef}>
        <div className="rolling-subtitle-track" ref={trackRef}>
          {cues.length === 0 ? (
            <div className="rolling-subtitle-empty">No subtitle cues.</div>
          ) : visibleCues.map((cue, localIndex) => {
            const index = renderWindow.start + localIndex
            const activeCue = activeIndex >= 0 ? cues[activeIndex] : null
            const activeGroupId = activeCue?.groupId
            const cueGroupIds = cue.groupIds || (cue.groupId ? [cue.groupId] : [])
            const highlighted = activeGroupId
              ? cueGroupIds.includes(activeGroupId)
              : activeIndex >= 0 && index === activeIndex
            return (
              <div
                className={[
                  'rolling-subtitle-row',
                  highlighted ? 'highlighted' : '',
                  selectedCueIds.has(cue.id) ? 'selected' : '',
                ].filter(Boolean).join(' ')}
                data-cue-index={index}
                data-highlighted={highlighted ? 'true' : 'false'}
                key={cue.id}
                onClick={() => onCueClick?.(cue)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  onCueClick?.(cue)
                }}
                role="button"
                style={{ fontSize }}
                tabIndex={0}
              >
                {subtitleNoteAddingActive ? (
                  <input
                    aria-label="Select subtitle cue"
                    checked={selectedCueIds.has(cue.id)}
                    className="rolling-subtitle-cue-check"
                    onChange={(event) => toggleCueSelection(event, cue)}
                    onClick={(event) => event.stopPropagation()}
                    type="checkbox"
                  />
                ) : null}
                <strong>{cue.text}</strong>
              </div>
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

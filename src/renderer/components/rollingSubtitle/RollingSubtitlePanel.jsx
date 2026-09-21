import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
const CONTROL_HOT_ZONE_WIDTH = 120
const MIN_TIMING_OFFSET = -5
const MAX_TIMING_OFFSET = 5
const DOCK_POSITIONS = ['left', 'center', 'right']

const hasPanelRect = (value) => ['x', 'y', 'width', 'height'].every((key) => (
  value?.[key] !== null
  && value?.[key] !== undefined
  && value?.[key] !== ''
  && Number.isFinite(Number(value[key]))
))

const getRelativePanelRect = (panelRect, bounds) => {
  if (!panelRect || !bounds?.width || !bounds?.height) return null
  return {
    centerX: (panelRect.x + (panelRect.width / 2)) / bounds.width,
    centerY: (panelRect.y + (panelRect.height / 2)) / bounds.height,
    width: panelRect.width / bounds.width,
    height: panelRect.height / bounds.height,
  }
}

const getPanelRectFromRelative = (relativeRect, bounds) => {
  if (!relativeRect || !bounds?.width || !bounds?.height) return null

  const maxWidth = Math.max(1, Math.round(bounds.width))
  const maxHeight = Math.max(1, Math.round(bounds.height))
  const minWidth = Math.min(MIN_WIDTH, maxWidth)
  const minHeight = Math.min(MIN_HEIGHT, maxHeight)
  const width = clamp(Math.round(relativeRect.width * bounds.width), minWidth, maxWidth)
  const height = clamp(Math.round(relativeRect.height * bounds.height), minHeight, maxHeight)
  const visibleWidth = Math.min(VISIBLE_HANDLE_SIZE, maxWidth)
  const visibleHeight = Math.min(VISIBLE_HANDLE_SIZE, maxHeight)

  return {
    x: clamp(
      Math.round((relativeRect.centerX * bounds.width) - (width / 2)),
      -width + visibleWidth,
      maxWidth - visibleWidth,
    ),
    y: clamp(
      Math.round((relativeRect.centerY * bounds.height) - (height / 2)),
      0,
      Math.max(0, maxHeight - visibleHeight),
    ),
    width,
    height,
  }
}

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
  pickSubAutoSelectCurrent = false,
  subtitleInteractionMode = 'follow',
  readingStartCueIndex = -1,
  panelViewKey = 'f0',
  panelViewState = null,
  hvLayout = 0,
  subtitleHidden = false,
  videoViewHidden = false,
  defaultFontSize = DEFAULT_FONT_SIZE,
  fontSizeKey = 'normal',
  fontSizeStepRequest = null,
  getCurrentTime,
  onAddSelectedSubtitles,
  onPickSelectedSubtitles,
  pickSubRequest = 0,
  onToggleHvLayout,
  onToggleSubtitleHidden,
  onToggleVideoViewHidden,
  onSelectedSubtitlesChange,
  onCueClick,
  onCueContextMenu,
  onInteractionModeChange,
  onPanelViewStateChange,
  onReadingAnchorChange,
  onReadingViewportChange,
  onReadingScrollStart,
}) {
  const listRef = useRef(null)
  const trackRef = useRef(null)
  const dragRef = useRef(null)
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
  const relativeRectRef = useRef(null)
  const containerSizeRef = useRef(null)
  const activePanelViewKeyRef = useRef(panelViewKey)
  const sessionPanelViewStatesRef = useRef({})
  const initialPanelStateRestoredRef = useRef(false)
  const lastFontSizeStepSequenceRef = useRef(Number(fontSizeStepRequest?.sequence) || 0)
  const subtitleNoteAddingRef = useRef(false)
  const resumeScrollingRef = useRef(false)
  const resumeSettlingTimeRef = useRef(0)
  const subtitleCenterModeSessionSizeRef = useRef(null)
  const readingAnchorIndexRef = useRef(-1)
  const readingSettleTimerRef = useRef(null)
  const readingFrameRef = useRef(0)
  const readingWheelDeltaRef = useRef(0)
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
  const scrollMode = 'float'
  const [dockPosition, setDockPosition] = useState('left')
  const [checkboxHotZoneActive, setCheckboxHotZoneActive] = useState(false)
  const [controlHotZoneActive, setControlHotZoneActive] = useState(false)
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
  const subtitleNoteAdding = subtitleInteractionMode === 'pick' || subtitleInteractionMode === 'reading'
  const subtitlePickActive = enableSubtitleNoteAdding && subtitleInteractionMode === 'pick'
  const subtitleReadingActive = enableSubtitleNoteAdding && subtitleInteractionMode === 'reading'
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

  useLayoutEffect(() => {
    renderWindowRef.current = renderWindow
    const anchor = pendingWindowAnchorRef.current
    if (!anchor) return

      rebuildLayoutAndMotionPlan()
      const layout = cueLayoutsRef.current[anchor.index]
      if (!layout) {
        pendingWindowAnchorRef.current = null
        return
      }

      setVisualTrackOffset(anchor.screenCenter - layout.center)
      pendingWindowAnchorRef.current = null
  }, [fontSize, renderWindow, scrollMode])

  useEffect(() => {
    if (enableSubtitleNoteAdding) return
    onInteractionModeChange?.('follow')
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

  const reportReadingViewport = () => {
    if (!subtitleReadingActive) return
    const list = listRef.current
    const rows = [...(trackRef.current?.querySelectorAll('[data-cue-index]') || [])]
    if (!list || rows.length === 0) return

    const listBounds = list.getBoundingClientRect()
    const viewportCenter = listBounds.top + (listBounds.height / 2)
    const visibleRows = rows
      .map((row) => ({ row, bounds: row.getBoundingClientRect() }))
      .filter(({ bounds }) => (
        bounds.bottom > listBounds.top && bounds.top < listBounds.bottom
      ))
      .map(({ row, bounds }) => ({
        index: Number(row.dataset.cueIndex),
        distanceFromCenter: Math.abs((bounds.top + (bounds.height / 2)) - viewportCenter),
      }))
      .filter(({ index }) => Number.isInteger(index))
    if (visibleRows.length === 0) return

    const visibleIndexes = visibleRows.map(({ index }) => index)
    const focusIndex = visibleRows.reduce((nearest, current) => (
      current.distanceFromCenter < nearest.distanceFromCenter ? current : nearest
    )).index
    readingAnchorIndexRef.current = focusIndex
    onReadingViewportChange?.({
      total: cues.length,
      startIndex: Math.min(...visibleIndexes) + 1,
      endIndex: Math.max(...visibleIndexes) + 1,
      focusCue: cues[focusIndex] || null,
    })
  }

  const scheduleReadingSettlement = (delay = 1000) => {
    if (readingSettleTimerRef.current) window.clearTimeout(readingSettleTimerRef.current)
    readingSettleTimerRef.current = window.setTimeout(() => {
      readingSettleTimerRef.current = null
      window.cancelAnimationFrame(readingFrameRef.current)
      readingFrameRef.current = window.requestAnimationFrame(() => {
        rebuildLayoutAndMotionPlan()
        reportReadingViewport()
      })
    }, delay)
  }

  const centerReadingCue = (index) => {
    if (!subtitleReadingActive || cues.length === 0) return
    const safeIndex = clamp(Math.round(index), 0, cues.length - 1)
    const list = listRef.current
    if (!list) return

    readingAnchorIndexRef.current = safeIndex
    onReadingAnchorChange?.({
      cue: cues[safeIndex] || null,
      cueIndex: safeIndex,
    })
    const targetCenter = list.clientHeight / 2
    const changedWindow = updateRenderWindowForIndex(safeIndex)
    if (changedWindow) {
      pendingWindowAnchorRef.current = { index: safeIndex, screenCenter: targetCenter }
    } else {
      rebuildLayoutAndMotionPlan()
      const layout = cueLayoutsRef.current[safeIndex]
      if (layout) setVisualTrackOffset(targetCenter - layout.center)
      else pendingWindowAnchorRef.current = { index: safeIndex, screenCenter: targetCenter }
    }
  }

  const handleReadingWheel = (event) => {
    if (!subtitleReadingActive || cues.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    onReadingScrollStart?.()

    readingWheelDeltaRef.current += event.deltaY
    const wheelSteps = Math.trunc(readingWheelDeltaRef.current / 60)
    if (wheelSteps === 0) return
    readingWheelDeltaRef.current -= wheelSteps * 60
    const direction = wheelSteps > 0 ? 1 : -1
    const step = clamp(Math.abs(wheelSteps), 1, 5)
    const currentIndex = readingAnchorIndexRef.current >= 0
      ? readingAnchorIndexRef.current
      : Math.max(0, activeIndexRef.current)
    centerReadingCue(currentIndex + (direction * step))
    scheduleReadingSettlement()
  }

  const refreshVisibleMetrics = () => {
    visibleMetricsRef.current = getVisibleMetrics(containerRef?.current, listRef.current)
  }

  const syncTrackToCurrentCue = () => {
    rebuildLayoutAndMotionPlan()
    if (subtitleNoteAddingRef.current || resumeScrollingRef.current) return
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
    const wasPicking = subtitleNoteAddingRef.current
    resumeSettlingTimeRef.current = 0
    subtitleNoteAddingRef.current = subtitleNoteAddingActive
    if (subtitleNoteAddingActive) resumeScrollingRef.current = false
    else if (wasPicking) resumeScrollingRef.current = true
  }, [subtitleNoteAddingActive])

  useEffect(() => {
    if (!subtitleReadingActive) {
      if (readingSettleTimerRef.current) window.clearTimeout(readingSettleTimerRef.current)
      readingSettleTimerRef.current = null
      onReadingViewportChange?.(null)
      return undefined
    }

    const requestedIndex = Number(readingStartCueIndex)
    const initialIndex = Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex < cues.length
      ? requestedIndex
      : activeIndexRef.current >= 0
        ? activeIndexRef.current
        : getActiveSubtitleCueIndex(cues, getEffectiveTime(currentTimeRef.current))
    readingAnchorIndexRef.current = Math.max(0, initialIndex)
    readingWheelDeltaRef.current = 0
    readingFrameRef.current = window.requestAnimationFrame(() => {
      centerReadingCue(readingAnchorIndexRef.current)
      scheduleReadingSettlement(0)
    })
    return () => {
      window.cancelAnimationFrame(readingFrameRef.current)
      if (readingSettleTimerRef.current) window.clearTimeout(readingSettleTimerRef.current)
      readingSettleTimerRef.current = null
    }
  }, [subtitleReadingActive])

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
    const readingIndex = readingAnchorIndexRef.current >= 0
      ? Math.min(readingAnchorIndexRef.current, Math.max(0, cues.length - 1))
      : Math.max(0, nextActiveIndex)
    const windowIndex = subtitleReadingActive ? readingIndex : nextActiveIndex
    const nextWindow = buildRenderWindow(windowIndex, cues.length)
    activeIndexRef.current = -1
    resumeScrollingRef.current = false
    pendingWindowAnchorRef.current = subtitleReadingActive
      ? { index: readingIndex, screenCenter: (listRef.current?.clientHeight || 0) / 2 }
      : null
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
    if (subtitleReadingActive) {
      window.cancelAnimationFrame(readingFrameRef.current)
      readingFrameRef.current = window.requestAnimationFrame(() => {
        centerReadingCue(readingIndex)
        scheduleReadingSettlement()
      })
    }
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
    if (selectedCueIds.size === 0) return
    onSelectedSubtitlesChange?.(selectedCues)
  }, [cues])

  useEffect(() => {
    const bounds = containerRef?.current?.getBoundingClientRect()
    if (!bounds?.width || !bounds?.height) return

    const isInitialRestore = !initialPanelStateRestoredRef.current
    const previousPanelViewKey = activePanelViewKeyRef.current
    if (!isInitialRestore && previousPanelViewKey !== panelViewKey) {
      sessionPanelViewStatesRef.current[previousPanelViewKey] = {
        ...rectRef.current,
        dockPosition,
      }
    }

    const maxWidth = Math.max(1, Math.round(bounds.width))
    const maxHeight = Math.max(1, Math.round(bounds.height))
    const persistedRectAvailable = isInitialRestore && hasPanelRect(panelViewState)
    const sessionPanelViewState = !isInitialRestore
      ? sessionPanelViewStatesRef.current[panelViewKey]
      : null
    let nextRect
    let nextDockPosition

    if (sessionPanelViewState) {
      const width = Math.max(1, Number(sessionPanelViewState.width) || DEFAULT_RECT.width)
      const height = clamp(
        Number(sessionPanelViewState.height) || DEFAULT_RECT.height,
        Math.min(MIN_HEIGHT, maxHeight),
        maxHeight,
      )
      nextRect = {
        x: subtitleCenterModeActive
          ? Math.round((bounds.width - width) / 2)
          : clamp(
              Number(sessionPanelViewState.x) || 0,
              -width + Math.min(VISIBLE_HANDLE_SIZE, maxWidth),
              maxWidth - Math.min(VISIBLE_HANDLE_SIZE, maxWidth),
            ),
        y: clamp(
          Number(sessionPanelViewState.y) || 0,
          0,
          Math.max(0, bounds.height - Math.min(VISIBLE_HANDLE_SIZE, maxHeight)),
        ),
        width,
        height,
      }
      nextDockPosition = DOCK_POSITIONS.includes(sessionPanelViewState.dockPosition)
        ? sessionPanelViewState.dockPosition
        : subtitleCenterModeActive ? 'center' : 'left'
    } else if (subtitleCenterModeActive) {
      const bottomRect = bottomPanelRef?.current?.getBoundingClientRect()
      const bottomTop = bottomRect ? bottomRect.top - bounds.top : bounds.height
      const availableHeight = bottomTop > MIN_HEIGHT ? bottomTop : bounds.height
      const widthSource = Number.isFinite(Number(subtitleCenterModeSessionSizeRef.current?.width))
        ? Number(subtitleCenterModeSessionSizeRef.current.width)
        : persistedRectAvailable
          ? Number(panelViewState.width)
          : Math.round(bounds.width * 0.5)
      const width = clamp(widthSource, Math.min(MIN_WIDTH, maxWidth), maxWidth)
      const height = persistedRectAvailable
        ? clamp(Number(panelViewState.height), Math.min(MIN_HEIGHT, maxHeight), maxHeight)
        : Math.max(1, Math.min(maxHeight, Math.round(availableHeight)))
      nextRect = {
        x: Math.round((bounds.width - width) / 2),
        y: persistedRectAvailable
          ? clamp(Number(panelViewState.y), 0, Math.max(0, bounds.height - VISIBLE_HANDLE_SIZE))
          : 0,
        width,
        height,
      }
      nextDockPosition = 'center'
      subtitleCenterModeSessionSizeRef.current = { width }
    } else {
      const width = clamp(
        persistedRectAvailable ? Number(panelViewState.width) : Math.round(bounds.width / 2),
        Math.min(MIN_WIDTH, maxWidth),
        maxWidth,
      )
      const height = clamp(
        persistedRectAvailable ? Number(panelViewState.height) : Math.round(bounds.height * 0.95),
        Math.min(MIN_HEIGHT, maxHeight),
        maxHeight,
      )
      nextRect = {
        x: persistedRectAvailable
          ? clamp(Number(panelViewState.x), -width + VISIBLE_HANDLE_SIZE, bounds.width - VISIBLE_HANDLE_SIZE)
          : 0,
        y: persistedRectAvailable
          ? clamp(Number(panelViewState.y), 0, Math.max(0, bounds.height - VISIBLE_HANDLE_SIZE))
          : 0,
        width,
        height,
      }
      nextDockPosition = persistedRectAvailable && DOCK_POSITIONS.includes(panelViewState?.dockPosition)
        ? panelViewState.dockPosition
        : 'left'
    }

    const nextFontSize = isInitialRestore
      ? clamp(Number(panelViewState?.fontSize) || fallbackFontSize, MIN_FONT_SIZE, MAX_FONT_SIZE)
      : fontSize

    rectRef.current = nextRect
    relativeRectRef.current = getRelativePanelRect(nextRect, bounds)
    containerSizeRef.current = { width: bounds.width, height: bounds.height }
    activePanelViewKeyRef.current = panelViewKey
    initialPanelStateRestoredRef.current = true
    sessionPanelViewStatesRef.current[panelViewKey] = {
      ...nextRect,
      dockPosition: nextDockPosition,
    }
    setRect(nextRect)
    setDockPosition(nextDockPosition)
    if (isInitialRestore) {
      setFontSizeByView((current) => ({
        ...current,
        [resolvedFontSizeKey]: nextFontSize,
      }))
    }
    if (isInitialRestore && !persistedRectAvailable && !subtitleCenterModeActive) {
      onPanelViewStateChange?.({ ...nextRect, fontSize: nextFontSize, dockPosition: nextDockPosition })
    }
    window.requestAnimationFrame(rebuildLayoutAndMotionPlan)
  }, [containerRef, panelViewKey])

  useEffect(() => {
    if (
      !enableSubtitleCenterLayout
      || !subtitleCenterModeActive
      || !subtitleCenterLayoutRequest
    ) return undefined

    const animationId = window.requestAnimationFrame(() => {
      const stageRect = containerRef?.current?.getBoundingClientRect()
      if (!stageRect?.width || !stageRect?.height) return

      const sideBySideLayout = Number(subtitleCenterLayout) === 1
      const bottomRect = bottomPanelRef?.current?.getBoundingClientRect()
      const bottomTop = bottomRect ? bottomRect.top - stageRect.top : stageRect.height
      const availableBottom = sideBySideLayout
        ? stageRect.height
        : bottomTop > 0
          ? Math.min(stageRect.height, bottomTop)
          : stageRect.height
      const currentRect = rectRef.current
      const nextHeight = Math.max(1, Math.round(availableBottom - currentRect.y))
      const nextRect = {
        ...currentRect,
        x: Math.round((stageRect.width - currentRect.width) / 2),
        height: nextHeight,
      }

      rectRef.current = nextRect
      relativeRectRef.current = getRelativePanelRect(nextRect, stageRect)
      containerSizeRef.current = { width: stageRect.width, height: stageRect.height }
      sessionPanelViewStatesRef.current[panelViewKey] = {
        ...nextRect,
        dockPosition: 'center',
      }
      setRect(nextRect)
      setDockPosition('center')
      window.requestAnimationFrame(rebuildLayoutAndMotionPlan)
    })

    return () => window.cancelAnimationFrame(animationId)
  }, [
    bottomPanelRef,
    containerRef,
    enableSubtitleCenterLayout,
    panelViewKey,
    subtitleCenterLayout,
    subtitleCenterLayoutRequest,
    subtitleCenterModeActive,
  ])

  useEffect(() => {
    const container = containerRef?.current
    if (!window.ResizeObserver || !container) return undefined

    let animationId = 0
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(animationId)
      animationId = window.requestAnimationFrame(() => {
        const bounds = container.getBoundingClientRect()
        if (!bounds.width || !bounds.height) return

        const previousSize = containerSizeRef.current
        const widthChanged = !previousSize || Math.abs(previousSize.width - bounds.width) > 0.5
        const heightChanged = !previousSize || Math.abs(previousSize.height - bounds.height) > 0.5
        containerSizeRef.current = { width: bounds.width, height: bounds.height }
        if (!widthChanged && !heightChanged) return

        if (!relativeRectRef.current) {
          relativeRectRef.current = getRelativePanelRect(rectRef.current, bounds)
          return
        }

        const currentRect = rectRef.current
        const relativeNextRect = heightChanged
          ? getPanelRectFromRelative(relativeRectRef.current, bounds)
          : null
        const nextRect = {
          x: widthChanged
            ? Math.round((bounds.width - currentRect.width) / 2)
            : currentRect.x,
          y: relativeNextRect?.y ?? currentRect.y,
          width: currentRect.width,
          height: relativeNextRect?.height ?? currentRect.height,
        }
        rectRef.current = nextRect
        setRect(nextRect)
        window.requestAnimationFrame(rebuildLayoutAndMotionPlan)
      })
    })

    observer.observe(container)
    return () => {
      window.cancelAnimationFrame(animationId)
      observer.disconnect()
    }
  }, [containerRef, panelViewKey])

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

      // Keep overlapping rows when resuming across several virtual windows.
      let windowIndex = nextActiveIndex
      if (resumeScrollingRef.current) {
        const center = visibleMetricsRef.current?.targetCenter ?? 0
        let nearestDistance = Infinity
        cueLayoutsRef.current.forEach((layout, index) => {
          const distance = Math.abs(layout.center + getVisualTrackOffset() - center)
          if (distance < nearestDistance) {
            nearestDistance = distance
            windowIndex = index
          }
        })
      }
      if (!subtitleNoteAddingRef.current && windowIndex >= 0 && updateRenderWindowForIndex(windowIndex)) {
        lastFrameTimeRef.current = frameTime
        lastVideoTimeRef.current = effectiveTime
        animationId = window.requestAnimationFrame(tick)
        return
      }

      if (resumeScrollingRef.current && list && track && nextActiveIndex >= 0) {
        const layouts = cueLayoutsRef.current
        const indices = Object.keys(layouts).map(Number)
        const targetIndex = clamp(nextActiveIndex, indices[0], indices[indices.length - 1])
        const layout = layouts[targetIndex]
        const metrics = visibleMetricsRef.current
        if (layout && metrics) {
          const curveOffset = scrollMode === 'float' && targetIndex === nextActiveIndex
            ? getFloatCurveOffset(floatCurveRef.current, effectiveTime) : NaN
          const target = clampTrackOffset(Number.isFinite(curveOffset)
            ? curveOffset : metrics.targetCenter - layout.center)
          const offset = getVisualTrackOffset()
          const delta = Math.min(MAX_FRAME_DELTA_MS, Math.max(0, frameTime - lastFrameTimeRef.current)) / 1000
          const difference = target - offset
          const step = difference * (1 - Math.exp(-delta / 0.18))
          const maxStep = Math.max(240, list.clientHeight * 2) * delta
          setVisualTrackOffset(offset + clamp(step, -maxStep, maxStep))
          resumeSettlingTimeRef.current = targetIndex === nextActiveIndex
            && Math.abs(difference) < Math.max(24, list.clientHeight * 0.1)
            ? resumeSettlingTimeRef.current + delta : 0
          if (targetIndex === nextActiveIndex
            && (Math.abs(difference) < 0.5 || resumeSettlingTimeRef.current >= 0.4)) {
            // Hand off the actual displayed position, including while playing.
            resumeScrollingRef.current = false
          }
        }
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
      const maxWidth = Math.max(1, bounds?.width || window.innerWidth)
      const maxHeight = Math.max(1, bounds?.height || window.innerHeight)
      const minWidth = Math.min(MIN_WIDTH, maxWidth)
      const minHeight = Math.min(MIN_HEIGHT, maxHeight)
      const visibleWidth = Math.min(VISIBLE_HANDLE_SIZE, maxWidth)
      const visibleHeight = Math.min(VISIBLE_HANDLE_SIZE, maxHeight)
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY

      if (drag.type === 'move') {
        setRect((current) => {
          const nextRect = {
            ...current,
            x: subtitleCenterModeActive
              ? Math.round((maxWidth - current.width) / 2)
              : clamp(drag.rect.x + dx, -current.width + visibleWidth, maxWidth - visibleWidth),
            y: clamp(drag.rect.y + dy, 0, Math.max(0, maxHeight - visibleHeight)),
          }
          rectRef.current = nextRect
          return nextRect
        })
        window.requestAnimationFrame(refreshVisibleMetrics)
        return
      }

      setRect((current) => {
        if (subtitleCenterModeActive) {
          const width = clamp(drag.rect.width + dx, minWidth, maxWidth)
          const x = Math.round((maxWidth - width) / 2)
          subtitleCenterModeSessionSizeRef.current = { width }
          window.requestAnimationFrame(refreshVisibleMetrics)
          const nextRect = { ...current, x, width, height: drag.rect.height }
          rectRef.current = nextRect
          return nextRect
        }

        if (drag.type === 'resize-ne') {
          const maxHeightFromTop = drag.rect.y + drag.rect.height
          const availableWidth = Math.max(1, maxWidth - current.x)
          const nextY = clamp(drag.rect.y + dy, 0, Math.max(0, maxHeightFromTop - minHeight))
          const width = clamp(drag.rect.width + dx, Math.min(minWidth, availableWidth), availableWidth)
          const availableHeight = Math.max(1, maxHeight - nextY)
          const height = clamp(
            maxHeightFromTop - nextY,
            Math.min(minHeight, availableHeight),
            availableHeight,
          )
          window.requestAnimationFrame(refreshVisibleMetrics)
          const nextRect = { ...current, y: nextY, width, height }
          rectRef.current = nextRect
          return nextRect
        }

        const availableWidth = Math.max(1, maxWidth - current.x)
        const availableHeight = Math.max(1, maxHeight - current.y)
        const width = clamp(drag.rect.width + dx, Math.min(minWidth, availableWidth), availableWidth)
        const height = clamp(drag.rect.height + dy, Math.min(minHeight, availableHeight), availableHeight)
        window.requestAnimationFrame(refreshVisibleMetrics)
        const nextRect = { ...current, width, height }
        rectRef.current = nextRect
        return nextRect
      })
    }

    const handlePointerUp = () => {
      const hadActiveDrag = Boolean(dragRef.current)
      dragRef.current = null
      if (hadActiveDrag) {
        window.requestAnimationFrame(() => {
          const bounds = containerRef?.current?.getBoundingClientRect()
          const currentRect = rectRef.current
          const nextRect = subtitleCenterModeActive && bounds?.width
            ? {
                ...currentRect,
                x: Math.round((bounds.width - currentRect.width) / 2),
              }
            : currentRect
          if (nextRect !== currentRect) {
            rectRef.current = nextRect
            setRect(nextRect)
          }
          relativeRectRef.current = getRelativePanelRect(nextRect, bounds)
          if (bounds?.width && bounds?.height) {
            containerSizeRef.current = { width: bounds.width, height: bounds.height }
          }
          onPanelViewStateChange?.({
            ...nextRect,
            fontSize,
            dockPosition,
          })
        })
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [containerRef, dockPosition, fontSize, onPanelViewStateChange, subtitleCenterModeActive])

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

    const currentRect = rectRef.current
    const x = position === 'left'
      ? 0
      : position === 'right'
        ? Math.round(bounds.width - currentRect.width)
        : Math.round((bounds.width - currentRect.width) / 2)

    const nextRect = { ...currentRect, x }
    rectRef.current = nextRect
    relativeRectRef.current = getRelativePanelRect(nextRect, bounds)
    containerSizeRef.current = { width: bounds.width, height: bounds.height }
    setRect(nextRect)
    onPanelViewStateChange?.({
      ...nextRect,
      fontSize,
      dockPosition: position,
    })
    window.requestAnimationFrame(syncTrackToCurrentCue)
  }

  const toggleDockPosition = (event) => {
    event.preventDefault()
    event.stopPropagation()
    const currentIndex = Math.max(0, DOCK_POSITIONS.indexOf(dockPosition))
    const nextPosition = DOCK_POSITIONS[(currentIndex + 1) % DOCK_POSITIONS.length]
    setDockPosition(nextPosition)
    applyDockPosition(nextPosition)
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
    const resolvedNextFontSize = clamp(nextFontSize, MIN_FONT_SIZE, MAX_FONT_SIZE)
    setFontSizeByView((current) => ({
      ...current,
      [resolvedFontSizeKey]: resolvedNextFontSize,
    }))
    onPanelViewStateChange?.({
      ...rectRef.current,
      fontSize: resolvedNextFontSize,
      dockPosition,
    })
  }

  useEffect(() => {
    const sequence = Number(fontSizeStepRequest?.sequence) || 0
    if (!sequence || sequence === lastFontSizeStepSequenceRef.current) return
    lastFontSizeStepSequenceRef.current = sequence

    const direction = Number(fontSizeStepRequest?.direction) < 0 ? -1 : 1
    const nextFontSize = direction > 0
      ? FONT_SIZE_PRESETS.find((size) => size > fontSize)
      : [...FONT_SIZE_PRESETS].reverse().find((size) => size < fontSize)
    if (!Number.isFinite(nextFontSize)) return

    setFontSizeByView((current) => ({
      ...current,
      [resolvedFontSizeKey]: nextFontSize,
    }))
    onPanelViewStateChange?.({
      ...rectRef.current,
      fontSize: nextFontSize,
      dockPosition,
    })
  }, [dockPosition, fontSize, fontSizeStepRequest, onPanelViewStateChange, resolvedFontSizeKey])


  const getSelectedCuesByIds = (ids) => cues.filter((cue) => ids.has(cue.id))

  const toggleCueSelection = (event, cue) => {
    event.stopPropagation()
    const next = new Set(selectedCueIds)
    if (next.has(cue.id)) {
      next.delete(cue.id)
    } else {
      next.add(cue.id)
      if (!subtitleNoteAdding) onInteractionModeChange?.('pick')
    }
    setSelectedCueIds(next)
    onSelectedSubtitlesChange?.(getSelectedCuesByIds(next))
  }

  const updateCheckboxHotZone = (event) => {
    const trackBounds = trackRef.current?.getBoundingClientRect()
    if (!trackBounds) return
    const hotZoneActive = event.clientX >= trackBounds.left
      && event.clientX <= trackBounds.left + 38
    setCheckboxHotZoneActive((current) => (
      current === hotZoneActive ? current : hotZoneActive
    ))
  }

  const updateControlHotZone = (event) => {
    const panelBounds = event.currentTarget.getBoundingClientRect()
    const hotZoneActive = event.clientX >= panelBounds.right - CONTROL_HOT_ZONE_WIDTH
      && event.clientX <= panelBounds.right
    setControlHotZoneActive((current) => (
      current === hotZoneActive ? current : hotZoneActive
    ))
  }

  const clearSelectedCues = () => {
    setSelectedCueIds(new Set())
    onSelectedSubtitlesChange?.([])
  }

  const pickSelectedSubtitles = async ({ fromShortcut = false } = {}) => {
    if (!subtitleNoteAdding) {
      if (addSubsDisabled) return
      if (pickSubAutoSelectCurrent) {
        const currentIndex = activeIndexRef.current >= 0 ? activeIndexRef.current : activeIndex
        const currentCue = currentIndex >= 0 ? cues[currentIndex] : null
        if (currentCue) {
          const next = new Set(selectedCueIds)
          next.add(currentCue.id)
          setSelectedCueIds(next)
          onSelectedSubtitlesChange?.(getSelectedCuesByIds(next))
        }
      }
      onInteractionModeChange?.('pick')
      return
    }

    if (selectedCues.length === 0) {
      if (subtitleReadingActive) return
      onInteractionModeChange?.('follow')
      clearSelectedCues()
      return
    }

    const result = onPickSelectedSubtitles
      ? await onPickSelectedSubtitles(selectedCues, { fromShortcut, readingMode: subtitleReadingActive })
      : await onAddSelectedSubtitles?.(selectedCues)

    if (result === 'goBack') return

    if (subtitleReadingActive) {
      clearSelectedCues()
      return
    }

    onInteractionModeChange?.('follow')
    clearSelectedCues()
  }

  useEffect(() => {
    if (!pickSubRequest) return
    pickSelectedSubtitles({ fromShortcut: true })
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
        subtitlePickActive ? 'subtitle-pick-active' : '',
        subtitleReadingActive ? 'subtitle-reading' : '',
        checkboxHotZoneActive ? 'checkbox-hot-zone-active' : '',
        controlHotZoneActive ? 'control-hot-zone-active' : '',
      ].filter(Boolean).join(' ')}
      style={{
        width: rect.width,
        height: rect.height,
        transform: `translate(${rect.x}px, ${rect.y}px)`,
      }}
      onPointerLeave={() => setControlHotZoneActive(false)}
      onPointerMove={updateControlHotZone}
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
          aria-label={effectiveSubtitleHidden ? 'Show rolling subtitles' : 'Hide rolling subtitles'}
          className="rolling-subtitle-hide-toggle"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (!effectiveSubtitleHidden && subtitleNoteAdding) {
              onInteractionModeChange?.('follow')
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
      <div
        className={effectiveSubtitleHidden ? 'rolling-subtitle-list hidden' : 'rolling-subtitle-list'}
        onPointerLeave={() => setCheckboxHotZoneActive(false)}
        onPointerMove={updateCheckboxHotZone}
        onWheel={handleReadingWheel}
        ref={listRef}
      >
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
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onCueContextMenu?.(event, cue, { subtitleInteractionMode })
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  onCueClick?.(cue)
                }}
                role="button"
                style={{ fontSize }}
                tabIndex={0}
              >
                <input
                  aria-label="Select subtitle cue"
                  checked={selectedCueIds.has(cue.id)}
                  className="rolling-subtitle-cue-check"
                  onChange={(event) => toggleCueSelection(event, cue)}
                  onClick={(event) => event.stopPropagation()}
                  tabIndex={subtitleNoteAddingActive || checkboxHotZoneActive ? 0 : -1}
                  type="checkbox"
                />
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

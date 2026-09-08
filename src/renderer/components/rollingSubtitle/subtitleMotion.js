const LOOK_BACK = 4
const LOOK_AHEAD = 8

export const SOFT_CORRECTION_PX_PER_SECOND = 36
export const BOTTOM_CLUSTER_CORRECTION_PX_PER_SECOND = 72
export const STRONG_CORRECTION_PX_PER_SECOND = 180
export const MAX_FRAME_DELTA_MS = 80
export const COMFORT_TOP_RATIO = 0.18
export const COMFORT_BOTTOM_RATIO = 0.82
export const BOTTOM_CLUSTER_LOOK_AHEAD = 2
export const BOTTOM_CLUSTER_RATIO = 0.7
export const DISPLAY_OFFSET_SMOOTHING = 0.18
export const DISPLAY_OFFSET_SNAP_THRESHOLD = 0.2
export const FLOAT_RESCUE_CORRECTION_PX_PER_SECOND = 48
export const FLOAT_OFFSET_SMOOTHING = 0.22

export function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max))
}

export function applyLimitedCorrection(currentOffset, targetOffset, maxStep) {
  const correction = targetOffset - currentOffset
  return currentOffset + clamp(correction, -maxStep, maxStep)
}

export function getVisibleMetrics(container, list) {
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

export function buildMotionPlan(cues, layouts, viewportHeight) {
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

export function buildFloatCurve(cues, layouts, visibleMetrics, viewportHeight) {
  if (!Array.isArray(cues) || cues.length === 0 || layouts.length === 0) return []

  const targetCenter = visibleMetrics?.targetCenter ?? (viewportHeight / 2)
  return cues.reduce((items, cue, index) => {
    const layout = layouts[index]
    if (!layout) return items

    items.push({
      time: Number(cue.start) || 0,
      offset: targetCenter - layout.center,
    })
    return items
  }, [])
}

export function getFloatCurveOffset(curve, time) {
  if (!Array.isArray(curve) || curve.length === 0) return null
  if (curve.length === 1) return curve[0].offset

  const currentTime = Number(time)
  if (!Number.isFinite(currentTime)) return curve[0].offset
  if (currentTime <= curve[0].time) return curve[0].offset

  for (let index = 1; index < curve.length; index += 1) {
    const previous = curve[index - 1]
    const next = curve[index]
    if (currentTime <= next.time) {
      const span = Math.max(0.1, next.time - previous.time)
      const progress = clamp((currentTime - previous.time) / span, 0, 1)
      return previous.offset + ((next.offset - previous.offset) * progress)
    }
  }

  return curve[curve.length - 1].offset
}
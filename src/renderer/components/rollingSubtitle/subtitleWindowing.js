const RENDER_WINDOW_BEFORE = 30
const RENDER_WINDOW_AFTER = 60
const RENDER_WINDOW_EDGE = 12

export function buildRenderWindow(activeIndex, total) {
  const count = Math.max(0, Number(total) || 0)
  if (count === 0) return { start: 0, end: 0 }

  const safeIndex = Number.isInteger(activeIndex) && activeIndex >= 0
    ? Math.min(activeIndex, count - 1)
    : 0
  return {
    start: Math.max(0, safeIndex - RENDER_WINDOW_BEFORE),
    end: Math.min(count, safeIndex + RENDER_WINDOW_AFTER + 1),
  }
}

export function shouldUpdateRenderWindow(activeIndex, renderWindow, total) {
  if (!Number.isInteger(activeIndex) || activeIndex < 0 || total <= 0) return false
  if (activeIndex < renderWindow.start || activeIndex >= renderWindow.end) return true
  if (renderWindow.start > 0 && activeIndex - renderWindow.start < RENDER_WINDOW_EDGE) return true
  if (renderWindow.end < total && renderWindow.end - activeIndex <= RENDER_WINDOW_EDGE) return true
  return false
}
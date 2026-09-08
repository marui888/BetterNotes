export function getActiveSubtitleCueIndex(cues = [], currentTime = 0) {
  if (!Array.isArray(cues) || cues.length === 0) return -1
  const time = Number(currentTime)
  if (!Number.isFinite(time)) return -1

  const exactIndexes = []
  for (let index = 0; index < cues.length; index += 1) {
    if (time >= cues[index].start && time <= cues[index].end) exactIndexes.push(index)
    if (cues[index].start > time) break
  }

  if (exactIndexes.length === 1) return exactIndexes[0]

  if (exactIndexes.length > 1) {
    let selectedIndex = exactIndexes[0]
    for (let index = 1; index < exactIndexes.length; index += 1) {
      const selectedCue = cues[selectedIndex]
      const nextCue = cues[exactIndexes[index]]
      const overlapStart = Math.max(selectedCue.start, nextCue.start)
      const overlapEnd = Math.min(selectedCue.end, nextCue.end)
      const switchTime = overlapStart + ((overlapEnd - overlapStart) / 2)
      if (time >= switchTime) {
        selectedIndex = exactIndexes[index]
      } else {
        break
      }
    }
    return selectedIndex
  }

  let previousIndex = -1
  for (let index = 0; index < cues.length; index += 1) {
    if (cues[index].start > time) break
    previousIndex = index
  }
  return previousIndex
}
export function findActiveCueIndexNear(cues, currentTime, previousIndex) {
  if (!Array.isArray(cues) || cues.length === 0) return -1
  const time = Number(currentTime)
  if (!Number.isFinite(time)) return -1

  return getActiveSubtitleCueIndex(cues, time)
}

export function formatTimingOffset(value) {
  const number = Number(value) || 0
  if (Math.abs(number) < 0.001) return '0.0s'
  return `${number > 0 ? '+' : ''}${number.toFixed(1)}s`
}
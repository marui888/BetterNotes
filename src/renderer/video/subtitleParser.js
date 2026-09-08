function parseTimestamp(value = '') {
  const text = String(value).trim().replace(',', '.')
  const match = text.match(/^(?:(\d+):)?(\d{2}):(\d{2})(?:\.(\d+))?$/)
  if (!match) return Number.NaN

  const hours = Number(match[1] || 0)
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const fraction = Number(`0.${match[4] || '0'}`)
  if (![hours, minutes, seconds, fraction].every(Number.isFinite)) return Number.NaN

  return hours * 3600 + minutes * 60 + seconds + fraction
}

function normalizeSubtitleLine(line = '') {
  return String(line || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isSubtitleTimestampLine(line = '') {
  return String(line || '').includes('-->')
}

function isSubtitleIndexLine(lines, index) {
  return /^\d+$/.test(String(lines[index] || '').trim()) && isSubtitleTimestampLine(lines[index + 1])
}

function normalizeCueText(lines = []) {
  return lines
    .map((line) => normalizeSubtitleLine(line))
    .filter(Boolean)
}

function mergeAdjacentDuplicateCues(cues = []) {
  const merged = []

  cues.forEach((cue) => {
    const key = normalizeSubtitleLine(cue.text)
    const previous = merged[merged.length - 1]
    const previousKey = previous ? normalizeSubtitleLine(previous.text) : ''
    const gap = previous ? cue.start - previous.end : Number.POSITIVE_INFINITY

    if (previous && key && key === previousKey && gap <= 0.25) {
      previous.start = Math.min(previous.start, cue.start)
      previous.end = Math.max(previous.end, cue.end)
      previous.groupIds = [...new Set([...(previous.groupIds || [previous.groupId]), ...(cue.groupIds || [cue.groupId])].filter(Boolean))]
      previous.id = `${previous.start.toFixed(3)}-${previous.end.toFixed(3)}-${previous.text}`
      return
    }

    merged.push({ ...cue })
  })

  return merged
}

export function parseSubtitleCues(rawText = '') {
  const lines = String(rawText || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')

  const cues = []
  let index = 0
  let groupIndex = 0

  while (index < lines.length) {
    let line = lines[index].trim()
    if (!line || line === 'WEBVTT' || line.startsWith('NOTE')) {
      index += 1
      continue
    }

    if (!line.includes('-->') && lines[index + 1]?.includes('-->')) {
      index += 1
      line = lines[index].trim()
    }

    if (!line.includes('-->')) {
      index += 1
      continue
    }

    const [startText, endAndSettings] = line.split('-->')
    const endText = String(endAndSettings || '').trim().split(/\s+/)[0]
    const start = parseTimestamp(startText)
    const end = parseTimestamp(endText)
    index += 1

    const textLines = []
    while (
      index < lines.length
      && !lines[index].trim()
      && !isSubtitleTimestampLine(lines[index + 1])
      && !isSubtitleIndexLine(lines, index + 1)
    ) {
      index += 1
    }

    while (
      index < lines.length
      && lines[index].trim()
      && !isSubtitleTimestampLine(lines[index])
      && !isSubtitleIndexLine(lines, index)
    ) {
      textLines.push(lines[index])
      index += 1
    }

    const cueLines = normalizeCueText(textLines)
    if (Number.isFinite(start) && Number.isFinite(end) && cueLines.length > 0) {
      const groupId = `${start.toFixed(3)}-${end.toFixed(3)}-${groupIndex}`
      const groupSize = cueLines.length
      groupIndex += 1

      cueLines.forEach((text, groupLineIndex) => {
        cues.push({
          id: `${groupId}-${groupLineIndex}-${text}`,
          groupId,
          groupIds: [groupId],
          groupLineIndex,
          groupSize,
          start,
          end,
          text,
        })
      })
    }
  }

  return mergeAdjacentDuplicateCues(cues)
}

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

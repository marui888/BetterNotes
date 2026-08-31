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

export function parseSubtitleCues(rawText = '') {
  const lines = String(rawText || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')

  const cues = []
  let index = 0

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
      && lines[index].trim()
      && !isSubtitleTimestampLine(lines[index])
      && !isSubtitleIndexLine(lines, index)
    ) {
      textLines.push(lines[index])
      index += 1
    }

    const cueLines = normalizeCueText(textLines)
    if (Number.isFinite(start) && Number.isFinite(end) && cueLines.length > 0) {
      cueLines.forEach((text) => {
        cues.push({
          id: `${start.toFixed(3)}-${end.toFixed(3)}-${text}`,
          start,
          end,
          text,
        })
      })
    }
  }

  const seen = new Set()
  return cues.filter((cue) => {
    const key = normalizeSubtitleLine(cue.text)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function getActiveSubtitleCueIndex(cues = [], currentTime = 0) {
  if (!Array.isArray(cues) || cues.length === 0) return -1
  const time = Number(currentTime)
  if (!Number.isFinite(time)) return -1

  const exactIndex = cues.findIndex((cue) => time >= cue.start && time <= cue.end)
  if (exactIndex >= 0) return exactIndex

  let previousIndex = -1
  for (let index = 0; index < cues.length; index += 1) {
    if (cues[index].start > time) break
    previousIndex = index
  }
  return previousIndex
}

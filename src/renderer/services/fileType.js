import { APP_MODES } from '../../stores/appStore'

const videoExtensions = ['.mp4', '.m4v', '.mov', '.webm']
const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']
const textExtensions = ['.txt', '.md', '.json', '.log', '.csv']

function getExtension(filePath = '') {
  const lastDot = filePath.lastIndexOf('.')
  if (lastDot < 0) {
    return ''
  }

  return filePath.slice(lastDot).toLowerCase()
}

export function getModeForFile(filePath) {
  const extension = getExtension(filePath)

  if (videoExtensions.includes(extension)) {
    return APP_MODES.VIDEO
  }

  if (imageExtensions.includes(extension)) {
    return APP_MODES.IMAGE
  }

  if (textExtensions.includes(extension)) {
    return APP_MODES.TEXT
  }

  return APP_MODES.SEARCH
}

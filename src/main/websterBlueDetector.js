import cvModule from '@techstark/opencv-js'
import { nativeImage } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

const BLUE_RESULT_PATH = path.join(process.cwd(), 'tools', 'dictionary-ahk', 'webster-blue-result.json')
const MERGE_Y_GAP = 8
const MERGE_X_GAP = 14

let openCvReadyPromise = null

async function getOpenCv() {
  if (openCvReadyPromise) return openCvReadyPromise

  openCvReadyPromise = (async () => {
    let cv = cvModule
    if (cvModule instanceof Promise) {
      cv = await cvModule
    } else if (!cvModule.Mat) {
      await new Promise((resolve) => {
        cvModule.onRuntimeInitialized = () => resolve()
      })
      cv = cvModule
    }

    if (!cv?.matFromImageData || !cv?.findContours) {
      throw new Error('OpenCV.js is not ready')
    }

    return cv
  })()

  try {
    return await openCvReadyPromise
  } catch (error) {
    openCvReadyPromise = null
    throw error
  }
}

function isBluePixel(r, g, b) {
  return b >= 130
    && r <= 120
    && g <= 140
    && b >= r + 45
    && b >= g + 35
}

function buildMaskImageData(imageData) {
  const { data, width, height } = imageData
  const mask = new Uint8ClampedArray(width * height * 4)

  for (let index = 0; index < data.length; index += 4) {
    const r = data[index]
    const g = data[index + 1]
    const b = data[index + 2]
    const value = isBluePixel(r, g, b) ? 255 : 0
    mask[index] = value
    mask[index + 1] = value
    mask[index + 2] = value
    mask[index + 3] = 255
  }

  return { data: mask, width, height }
}

function readPngImageData(filePath) {
  const image = nativeImage.createFromPath(filePath)
  const size = image.getSize()
  const bitmap = image.toBitmap()
  const data = new Uint8ClampedArray(size.width * size.height * 4)

  for (let index = 0; index < bitmap.length; index += 4) {
    data[index] = bitmap[index + 2]
    data[index + 1] = bitmap[index + 1]
    data[index + 2] = bitmap[index]
    data[index + 3] = bitmap[index + 3]
  }

  return {
    width: size.width,
    height: size.height,
    data,
  }
}

function addCoordinateFields(area, captureInfo) {
  const centerImageX = area.imageX + Math.round(area.imageWidth / 2)
  const centerImageY = area.imageY + Math.round(area.imageHeight / 2)
  const scaleFactor = captureInfo?.display?.scaleFactor || 1
  const centerClientX = Math.round(centerImageX / scaleFactor)
  const centerClientY = Math.round(centerImageY / scaleFactor)

  return {
    ...area,
    imageCenterX: centerImageX,
    imageCenterY: centerImageY,
    clientX: centerClientX,
    clientY: centerClientY,
    screenX: Math.round(captureInfo.rect.screenX + centerClientX),
    screenY: Math.round(captureInfo.rect.screenY + centerClientY),
  }
}

function doAreasShareRow(a, b) {
  const aCenterY = a.imageY + a.imageHeight / 2
  const bCenterY = b.imageY + b.imageHeight / 2
  const maxHeight = Math.max(a.imageHeight, b.imageHeight)
  return Math.abs(aCenterY - bCenterY) <= Math.max(MERGE_Y_GAP, maxHeight * 0.65)
}

function mergeAreaPair(a, b) {
  const left = Math.min(a.imageX, b.imageX)
  const top = Math.min(a.imageY, b.imageY)
  const right = Math.max(a.imageX + a.imageWidth, b.imageX + b.imageWidth)
  const bottom = Math.max(a.imageY + a.imageHeight, b.imageY + b.imageHeight)

  return {
    imageX: left,
    imageY: top,
    imageWidth: right - left,
    imageHeight: bottom - top,
    pixelArea: (a.pixelArea || 0) + (b.pixelArea || 0),
    contourArea: (a.contourArea || 0) + (b.contourArea || 0),
    parts: [
      ...(Array.isArray(a.parts) ? a.parts : [a.index].filter(Boolean)),
      ...(Array.isArray(b.parts) ? b.parts : [b.index].filter(Boolean)),
    ],
  }
}

function mergeWordAreas(rawAreas, captureInfo) {
  const sorted = rawAreas
    .slice()
    .sort((a, b) => (a.imageY - b.imageY) || (a.imageX - b.imageX))
  const rows = []

  for (const area of sorted) {
    let row = rows.find((item) => item.some((existing) => doAreasShareRow(existing, area)))
    if (!row) {
      row = []
      rows.push(row)
    }
    row.push(area)
  }

  const merged = []
  for (const row of rows) {
    const rowAreas = row.slice().sort((a, b) => a.imageX - b.imageX)
    let current = null

    for (const area of rowAreas) {
      if (!current) {
        current = { ...area, parts: [area.index].filter(Boolean) }
        continue
      }

      const currentRight = current.imageX + current.imageWidth
      const gap = area.imageX - currentRight
      if (gap <= MERGE_X_GAP) {
        current = mergeAreaPair(current, area)
      } else {
        merged.push(current)
        current = { ...area, parts: [area.index].filter(Boolean) }
      }
    }

    if (current) {
      merged.push(current)
    }
  }

  return merged
    .filter((area) => area.imageWidth >= 8 && area.imageHeight >= 5)
    .sort((a, b) => (a.imageY - b.imageY) || (a.imageX - b.imageX))
    .map((area, index) => addCoordinateFields({ ...area, index: index + 1 }, captureInfo))
}

function getContourAreas(cv, binaryMat, captureInfo) {
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  const areas = []

  try {
    cv.findContours(binaryMat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index)
      const rect = cv.boundingRect(contour)
      const contourArea = cv.contourArea(contour)
      contour.delete()

      const width = rect.width
      const height = rect.height
      const area = width * height
      if (width < 5 || height < 4 || width > 180 || height > 40 || area < 20 || contourArea < 8) {
        continue
      }

      areas.push(addCoordinateFields({
        index: areas.length + 1,
        imageX: rect.x,
        imageY: rect.y,
        imageWidth: width,
        imageHeight: height,
        pixelArea: area,
        contourArea: Math.round(contourArea),
      }, captureInfo))
    }
  } finally {
    hierarchy.delete()
    contours.delete()
  }

  return areas.sort((a, b) => (a.imageY - b.imageY) || (a.imageX - b.imageX))
    .map((area, index) => ({ ...area, index: index + 1 }))
}

export async function detectWebsterBlueText(captureInfo) {
  if (!captureInfo?.ok || !captureInfo.imagePath || !captureInfo.rect) {
    return { ok: false, reason: 'invalid-webster-capture-info', captureInfo }
  }

  try {
    const cv = await getOpenCv()
    const imageData = readPngImageData(captureInfo.imagePath)
    const { width, height } = imageData
    const maskImageData = buildMaskImageData(imageData)
    const sourceMat = cv.matFromImageData(maskImageData)
    const grayMat = new cv.Mat()
    const binaryMat = new cv.Mat()
    const kernel = cv.Mat.ones(2, 2, cv.CV_8U)

    try {
      cv.cvtColor(sourceMat, grayMat, cv.COLOR_RGBA2GRAY)
      cv.threshold(grayMat, binaryMat, 127, 255, cv.THRESH_BINARY)
      cv.morphologyEx(binaryMat, binaryMat, cv.MORPH_CLOSE, kernel)
      const rawAreas = getContourAreas(cv, binaryMat, captureInfo)
      const areas = mergeWordAreas(rawAreas, captureInfo)
      const result = {
        ok: true,
        imagePath: captureInfo.imagePath,
        resultPath: BLUE_RESULT_PATH,
        rect: captureInfo.rect,
        display: captureInfo.display,
        crop: captureInfo.crop,
        trimRight: captureInfo.trimRight,
        imageSize: { width, height },
        rawAreas,
        areas,
      }

      await fs.writeFile(BLUE_RESULT_PATH, JSON.stringify(result, null, 2), 'utf8')
      return result
    } finally {
      kernel.delete()
      binaryMat.delete()
      grayMat.delete()
      sourceMat.delete()
    }
  } catch (error) {
    return { ok: false, reason: 'detect-webster-blue-text-failed', detail: error.message, captureInfo }
  }
}

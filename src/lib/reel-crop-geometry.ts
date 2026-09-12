import { isValidTrim as isValidTrimValue, sanitizeTrim } from './reel-trim-geometry'

import type { ReelCrop, ReelEditState } from '../types/reel-creator'

export const REEL_CROP_ASPECT_RATIO = 9 / 16
export const REEL_CROP_MAX_SCALE = 4

export type CropGeometry = {
  sourceWidth: number
  sourceHeight: number
  viewportWidth: number
  viewportHeight: number
}

export type CropTransform = {
  scale: number
  translateX: number
  translateY: number
}

const isFinitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const getSafeGeometry = (geometry: CropGeometry): CropGeometry => ({
  sourceWidth: isFinitePositive(geometry.sourceWidth) ? geometry.sourceWidth : 1080,
  sourceHeight: isFinitePositive(geometry.sourceHeight) ? geometry.sourceHeight : 1920,
  viewportWidth: isFinitePositive(geometry.viewportWidth) ? geometry.viewportWidth : 1,
  viewportHeight: isFinitePositive(geometry.viewportHeight) ? geometry.viewportHeight : 16 / 9,
})

const getNormalizedCropWidthToHeight = (sourceWidth: number, sourceHeight: number) =>
  REEL_CROP_ASPECT_RATIO / (sourceWidth / sourceHeight)

export const getCoverScale = (
  sourceWidth: number,
  sourceHeight: number,
  viewportWidth: number,
  viewportHeight: number,
) => {
  const safeGeometry = getSafeGeometry({
    sourceWidth,
    sourceHeight,
    viewportWidth,
    viewportHeight,
  })

  return Math.max(
    safeGeometry.viewportWidth / safeGeometry.sourceWidth,
    safeGeometry.viewportHeight / safeGeometry.sourceHeight,
  )
}

export const getDefaultCropRect = (sourceWidth: number, sourceHeight: number): ReelCrop => {
  const safeSourceWidth = isFinitePositive(sourceWidth) ? sourceWidth : 1080
  const safeSourceHeight = isFinitePositive(sourceHeight) ? sourceHeight : 1920
  const widthToHeight = getNormalizedCropWidthToHeight(safeSourceWidth, safeSourceHeight)
  const width = Math.min(1, widthToHeight)
  const height = Math.min(1, 1 / widthToHeight)

  return {
    version: 1,
    x: (1 - width) / 2,
    y: (1 - height) / 2,
    width,
    height,
    aspectRatio: '9:16',
  }
}

export const isValidReelCrop = (value: unknown): value is ReelCrop => {
  if (!isRecord(value) || value.version !== 1 || value.aspectRatio !== '9:16') {
    return false
  }

  const { x, y, width, height } = value

  return (
    isFinitePositive(width) &&
    isFinitePositive(height) &&
    typeof x === 'number' &&
    Number.isFinite(x) &&
    typeof y === 'number' &&
    Number.isFinite(y) &&
    x >= 0 &&
    y >= 0 &&
    width <= 1 &&
    height <= 1 &&
    x + width <= 1.000001 &&
    y + height <= 1.000001
  )
}

export const normalizeCropRect = (
  value: unknown,
  sourceWidth?: number,
  sourceHeight?: number,
): ReelCrop | null => {
  if (!isValidReelCrop(value)) {
    return null
  }

  const safeSourceWidth = isFinitePositive(sourceWidth) ? sourceWidth : 1080
  const safeSourceHeight = isFinitePositive(sourceHeight) ? sourceHeight : 1920
  const widthToHeight = getNormalizedCropWidthToHeight(safeSourceWidth, safeSourceHeight)

  let width = clamp(value.width, 0.000001, 1)
  let height = width / widthToHeight

  if (height > 1) {
    height = 1
    width = widthToHeight
  }

  if (width > 1) {
    width = 1
    height = 1 / widthToHeight
  }

  const defaultCrop = getDefaultCropRect(safeSourceWidth, safeSourceHeight)
  const minimumWidth = defaultCrop.width / REEL_CROP_MAX_SCALE
  const minimumHeight = defaultCrop.height / REEL_CROP_MAX_SCALE

  if (width < minimumWidth) {
    width = minimumWidth
    height = width / widthToHeight
  }

  if (height < minimumHeight) {
    height = minimumHeight
    width = height * widthToHeight
  }

  const centerX = clamp(value.x + value.width / 2, width / 2, 1 - width / 2)
  const centerY = clamp(value.y + value.height / 2, height / 2, 1 - height / 2)

  return {
    version: 1,
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
    aspectRatio: '9:16',
  }
}

export const sanitizeReelEditState = (
  value: unknown,
  sourceWidth?: number,
  sourceHeight?: number,
  sourceDurationMs?: number | null,
): ReelEditState => {
  const trim = isRecord(value) ? sanitizeTrim(value.trim, sourceDurationMs) : null

  if (!isRecord(value)) {
    return { framing: 'fit', crop: null, trim: null }
  }

  if (value.framing === 'crop') {
    const crop = normalizeCropRect(value.crop, sourceWidth, sourceHeight)
    return crop ? { framing: 'crop', crop, trim } : { framing: 'fit', crop: null, trim }
  }

  return { framing: 'fit', crop: null, trim }
}

export const isValidReelEditState = (
  value: unknown,
  sourceWidth?: number,
  sourceHeight?: number,
  sourceDurationMs?: number | null,
): value is ReelEditState => {
  if (!isRecord(value)) {
    return false
  }

  if (value.framing === 'fit') {
    return (
      (value.crop === null || value.crop === undefined) &&
      (value.trim === null ||
        value.trim === undefined ||
        isValidTrimValue(value.trim, sourceDurationMs))
    )
  }

  return (
    value.framing === 'crop' &&
    normalizeCropRect(value.crop, sourceWidth, sourceHeight) !== null &&
    (value.trim === null ||
      value.trim === undefined ||
      isValidTrimValue(value.trim, sourceDurationMs))
  )
}

export const clampCropTranslation = (
  translateX: number,
  translateY: number,
  scale: number,
  geometry: CropGeometry,
) => {
  const safeGeometry = getSafeGeometry(geometry)
  const safeScale = clamp(scale, 1, REEL_CROP_MAX_SCALE)
  const coverScale = getCoverScale(
    safeGeometry.sourceWidth,
    safeGeometry.sourceHeight,
    safeGeometry.viewportWidth,
    safeGeometry.viewportHeight,
  )
  const maxTranslateX = Math.max(
    0,
    (safeGeometry.sourceWidth * coverScale * safeScale - safeGeometry.viewportWidth) / 2,
  )
  const maxTranslateY = Math.max(
    0,
    (safeGeometry.sourceHeight * coverScale * safeScale - safeGeometry.viewportHeight) / 2,
  )

  return {
    translateX: clamp(Number.isFinite(translateX) ? translateX : 0, -maxTranslateX, maxTranslateX),
    translateY: clamp(Number.isFinite(translateY) ? translateY : 0, -maxTranslateY, maxTranslateY),
  }
}

export const getCropTransformFromRect = (
  crop: ReelCrop,
  geometry: CropGeometry,
  maxScale = REEL_CROP_MAX_SCALE,
): CropTransform => {
  const safeGeometry = getSafeGeometry(geometry)
  const safeCrop =
    normalizeCropRect(crop, safeGeometry.sourceWidth, safeGeometry.sourceHeight) ??
    getDefaultCropRect(safeGeometry.sourceWidth, safeGeometry.sourceHeight)
  const coverScale = getCoverScale(
    safeGeometry.sourceWidth,
    safeGeometry.sourceHeight,
    safeGeometry.viewportWidth,
    safeGeometry.viewportHeight,
  )
  const cropWidth = safeCrop.width * safeGeometry.sourceWidth * coverScale
  const cropHeight = safeCrop.height * safeGeometry.sourceHeight * coverScale
  const scale = clamp(
    Math.max(safeGeometry.viewportWidth / cropWidth, safeGeometry.viewportHeight / cropHeight),
    1,
    Math.max(1, maxScale),
  )
  const layerWidth = safeGeometry.sourceWidth * coverScale
  const layerHeight = safeGeometry.sourceHeight * coverScale
  const cropCenterX = (safeCrop.x + safeCrop.width / 2) * layerWidth
  const cropCenterY = (safeCrop.y + safeCrop.height / 2) * layerHeight
  const translation = clampCropTranslation(
    -(cropCenterX - layerWidth / 2) * scale,
    -(cropCenterY - layerHeight / 2) * scale,
    scale,
    safeGeometry,
  )

  return { scale, ...translation }
}

export const getCropRectFromTransform = (
  transform: CropTransform,
  geometry: CropGeometry,
): ReelCrop => {
  const safeGeometry = getSafeGeometry(geometry)
  const safeScale = clamp(transform.scale, 1, REEL_CROP_MAX_SCALE)
  const translation = clampCropTranslation(
    transform.translateX,
    transform.translateY,
    safeScale,
    safeGeometry,
  )
  const coverScale = getCoverScale(
    safeGeometry.sourceWidth,
    safeGeometry.sourceHeight,
    safeGeometry.viewportWidth,
    safeGeometry.viewportHeight,
  )
  const scaledCover = safeScale * coverScale
  const width = safeGeometry.viewportWidth / (safeGeometry.sourceWidth * scaledCover)
  const height = safeGeometry.viewportHeight / (safeGeometry.sourceHeight * scaledCover)
  const x =
    0.5 -
    (safeGeometry.viewportWidth / 2 + translation.translateX) /
      (safeGeometry.sourceWidth * scaledCover)
  const y =
    0.5 -
    (safeGeometry.viewportHeight / 2 + translation.translateY) /
      (safeGeometry.sourceHeight * scaledCover)

  return (
    normalizeCropRect(
      {
        version: 1,
        x,
        y,
        width,
        height,
        aspectRatio: '9:16',
      },
      safeGeometry.sourceWidth,
      safeGeometry.sourceHeight,
    ) ?? getDefaultCropRect(safeGeometry.sourceWidth, safeGeometry.sourceHeight)
  )
}

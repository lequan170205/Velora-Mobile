import * as MediaLibrary from 'expo-media-library'

import { isRemoteMediaUri } from './chatMedia'

interface LegacyFileSystemModule {
  cacheDirectory: string | null
  documentDirectory: string | null
  deleteAsync: (uri: string, options?: { idempotent?: boolean }) => Promise<void>
  downloadAsync: (uri: string, targetUri: string) => Promise<{ status: number; uri: string }>
}

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const LegacyFileSystem = require('expo-file-system/legacy') as LegacyFileSystemModule

const getMediaFileExtension = ({
  mimeType,
  type,
}: {
  mimeType?: string
  type: 'image' | 'video'
}) => {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'video/quicktime':
      return 'mov'
    case 'video/webm':
      return 'webm'
    case 'video/mp4':
      return 'mp4'
    default:
      return type === 'video' ? 'mp4' : 'jpg'
  }
}

export async function saveChatMediaToLibrary({
  mimeType,
  type,
  uri,
}: {
  mimeType?: string
  type: 'image' | 'video'
  uri: string
}) {
  const permission = await MediaLibrary.requestPermissionsAsync(true)
  if (!permission.granted) {
    throw new Error('Allow photo access in Settings to save media.')
  }

  const isRemote = isRemoteMediaUri(uri)
  const writableDirectory = LegacyFileSystem.cacheDirectory ?? LegacyFileSystem.documentDirectory
  if (isRemote && !writableDirectory) {
    throw new Error('No local storage is available to save this media.')
  }

  const temporaryUri = isRemote
    ? `${writableDirectory}velora-media-${Date.now()}.${getMediaFileExtension({
        type,
        ...(mimeType ? { mimeType } : {}),
      })}`
    : null

  try {
    let localUri = uri
    if (temporaryUri) {
      const downloadResult = await LegacyFileSystem.downloadAsync(uri, temporaryUri)
      if (downloadResult.status < 200 || downloadResult.status >= 300) {
        throw new Error(`Could not download media. Server returned ${downloadResult.status}.`)
      }
      localUri = downloadResult.uri
    }

    await MediaLibrary.saveToLibraryAsync(localUri)
  } finally {
    if (temporaryUri) {
      await LegacyFileSystem.deleteAsync(temporaryUri, { idempotent: true }).catch(() => undefined)
    }
  }
}

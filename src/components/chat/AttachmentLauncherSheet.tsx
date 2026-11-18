import * as ImagePicker from 'expo-image-picker'
import { forwardRef, useImperativeHandle } from 'react'
import { Alert, Linking, Platform } from 'react-native'

import { BOT_IMAGE_PICK_QUALITY } from '../../lib/chatMedia'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AttachmentLauncherSheetProps {
  /** One photo only, compressed: what a chat with Velora AI can read. */
  singleCompressedImage?: boolean
  onSelectAssets: (assets: ImagePicker.ImagePickerAsset[]) => Promise<void> | void
}

export interface AttachmentLauncherSheetHandle {
  present: () => void
  dismiss: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export const AttachmentLauncherSheet = forwardRef<
  AttachmentLauncherSheetHandle,
  AttachmentLauncherSheetProps
>(function AttachmentLauncherSheet({ onSelectAssets, singleCompressedImage = false }, ref) {
  const isCloudVideoPickerError = (error: unknown) => {
    if (Platform.OS !== 'ios') {
      return false
    }

    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : JSON.stringify(error)

    return (
      message.includes('PHPhotosErrorDomain error 3164') ||
      message.includes('PHPhotosErrorDomain Code=3164')
    )
  }

  const launchCloudVideoFallbackPicker = async () => {
    const fallbackResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: true,
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
      quality: 1,
      videoExportPreset: ImagePicker.VideoExportPreset.MediumQuality,
    })

    if (!fallbackResult.canceled && fallbackResult.assets.length > 0) {
      await onSelectAssets(fallbackResult.assets)
    }
  }

  useImperativeHandle(ref, () => ({
    present: async () => {
      try {
        if (Platform.OS === 'ios') {
          const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()

          if (!permission.granted) {
            Alert.alert(
              'Permission denied',
              'Velora needs photo library access to pick images and videos.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Open Settings', onPress: () => void Linking.openSettings() },
              ],
            )
            return
          }
        }

        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: singleCompressedImage ? ['images'] : ['images', 'videos'],
          allowsMultipleSelection: !singleCompressedImage,
          selectionLimit: singleCompressedImage ? 1 : 10,
          orderedSelection: true,
          // iPhone photos are HEIC, which chat uploads reject; Compatible makes iOS hand over JPEG.
          preferredAssetRepresentationMode:
            ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
          // Android's picker re-decodes the photo to compress it and fails on HDR camera photos
          // (content:// URIs), so only iOS compresses at pick time.
          quality: singleCompressedImage && Platform.OS === 'ios' ? BOT_IMAGE_PICK_QUALITY : 1,
          videoExportPreset: ImagePicker.VideoExportPreset.MediumQuality,
        })

        if (!result.canceled && result.assets.length > 0) {
          await onSelectAssets(result.assets)
        }
      } catch (error) {
        console.error('Failed to launch native picker:', error)

        if (isCloudVideoPickerError(error)) {
          Alert.alert(
            'Video Stored In iCloud',
            'Some videos are still in iCloud and cannot be opened by the multi-select picker. Velora will reopen a single-video picker that downloads cloud videos more reliably.',
            [
              {
                text: 'Cancel',
                style: 'cancel',
              },
              {
                text: 'Choose Video',
                onPress: () => {
                  void launchCloudVideoFallbackPicker().catch((fallbackError) => {
                    console.error('Cloud video fallback picker failed:', fallbackError)
                    Alert.alert(
                      'Could not open video',
                      'iOS still could not load that cloud video. Please download it in Photos first, then try again.',
                    )
                  })
                },
              },
            ],
          )
          return
        }

        if (Platform.OS === 'android') {
          // Android reports a photo it cannot open (a RAW camera file, a stale gallery entry) as a
          // failed write; say what to do instead of blaming the picker.
          Alert.alert(
            'Could not open that photo',
            'Velora could not open that photo. Choose a JPEG, PNG or WebP photo; RAW camera files such as .CR2 are not supported.',
          )
          return
        }

        Alert.alert(
          'Could not open library',
          'iOS was unable to open the photo picker for this selection. Please try again.',
        )
      }
    },
    dismiss: () => {},
  }))

  return null
})

import * as ImagePicker from 'expo-image-picker'
import { forwardRef, useImperativeHandle } from 'react'
import { Alert, Platform } from 'react-native'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AttachmentLauncherSheetProps {
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
>(function AttachmentLauncherSheet({ onSelectAssets }, ref) {
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
            )
            return
          }
        }

        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images', 'videos'],
          allowsMultipleSelection: true,
          selectionLimit: 10,
          orderedSelection: true,
          preferredAssetRepresentationMode:
            ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
          quality: 1,
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

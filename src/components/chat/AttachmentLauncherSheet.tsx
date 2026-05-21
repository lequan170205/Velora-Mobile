import * as ImagePicker from 'expo-image-picker'
import { forwardRef, useImperativeHandle } from 'react'

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
  useImperativeHandle(ref, () => ({
    present: async () => {
      try {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.All,
          allowsMultipleSelection: true,
          quality: 1,
          videoMaxDuration: 120,
        })

        if (!result.canceled && result.assets.length > 0) {
          await onSelectAssets(result.assets)
        }
      } catch (error) {
        console.error('Failed to launch native picker:', error)
      }
    },
    dismiss: () => {},
  }))

  return null
})

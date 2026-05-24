import { StatusBar } from 'expo-status-bar'
import React from 'react'
import { View } from 'react-native'

import { CaptureStage } from '@/components/reels/create/capture-stage'
import { EditorStage } from '@/components/reels/create/editor-stage'
import { PublishStage } from '@/components/reels/create/publish-stage'
import { ImportOverlay } from '@/components/reels/create/shared-ui'
import { useReelCreator } from '@/hooks/useReelCreator'

export default function CreateReelScreen() {
  const controller = useReelCreator()
  const activeStage =
    controller.stage === 'edit' && controller.selectedAsset ? (
      <EditorStage controller={controller} />
    ) : controller.stage === 'publish' && controller.selectedAsset ? (
      <PublishStage controller={controller} />
    ) : (
      <CaptureStage controller={controller} />
    )

  return (
    <View className="flex-1 bg-[#F7F2EC]">
      <StatusBar style={controller.stage === 'capture' ? 'light' : 'dark'} />
      <View className="flex-1">
        {activeStage}
        <ImportOverlay importState={controller.importState} />
      </View>
    </View>
  )
}

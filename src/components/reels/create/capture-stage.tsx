import { MaterialIcons } from '@expo/vector-icons'
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { durationOptions } from '../../../constants/reel-creator'
import { formatDurationLabel } from '../../../lib/reels'
import { ReelVideo } from '../ReelVideo'

import { GlassIconButton, SegmentedPill } from './shared-ui'

import type { ReelCreatorController } from '../../../hooks/useReelCreator'

type CameraFacing = 'back' | 'front'
type TorchMode = 'off' | 'on'
type CameraRecordingResult = { codec?: string | undefined; uri: string }
type CameraViewHandle = {
  recordAsync: (options?: { maxDuration?: number }) => Promise<CameraRecordingResult | undefined>
  stopRecording: () => void
}

export function CaptureStage({ controller }: { controller: ReelCreatorController }) {
  const insets = useSafeAreaInsets()
  const cameraRef = useRef<CameraViewHandle | null>(null)
  const didAskPermissionRef = useRef(false)
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions()
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>('back')
  const [flashMode, setFlashMode] = useState<TorchMode>('off')
  const [isCameraReady, setIsCameraReady] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const hasSavedDraft = Boolean(controller.availableDraft?.asset)
  const hasCameraAccess = Boolean(cameraPermission?.granted && microphonePermission?.granted)

  useEffect(() => {
    if (didAskPermissionRef.current) {
      return
    }

    didAskPermissionRef.current = true
    void (async () => {
      await requestCameraPermission()
      await requestMicrophonePermission()
    })()
  }, [requestCameraPermission, requestMicrophonePermission])

  const ensureCameraAccess = useCallback(async () => {
    const nextCameraPermission = cameraPermission?.granted
      ? cameraPermission
      : await requestCameraPermission()
    const nextMicrophonePermission = microphonePermission?.granted
      ? microphonePermission
      : await requestMicrophonePermission()

    if (!nextCameraPermission.granted || !nextMicrophonePermission.granted) {
      Alert.alert(
        'Camera access needed',
        'Allow camera and microphone permissions to record a reel.',
      )
      return false
    }

    return true
  }, [cameraPermission, microphonePermission, requestCameraPermission, requestMicrophonePermission])

  const handleRecordPress = useCallback(async () => {
    if (controller.selectedAsset) {
      controller.goToEditStage()
      return
    }

    const canRecord = await ensureCameraAccess()
    if (!canRecord) {
      return
    }

    if (!cameraRef.current || !isCameraReady) {
      return
    }

    if (isRecording) {
      cameraRef.current.stopRecording()
      return
    }

    try {
      setIsRecording(true)
      const recording = await cameraRef.current.recordAsync({
        maxDuration: controller.selectedDuration,
      })

      if (recording?.uri) {
        await controller.handleCameraRecordingComplete(recording.uri)
      }
    } catch {
      Alert.alert('Recording failed', 'Velora could not record this reel.')
    } finally {
      setIsRecording(false)
    }
  }, [controller, ensureCameraAccess, isCameraReady, isRecording])

  const toggleCameraFacing = useCallback(() => {
    setIsCameraReady(false)
    setCameraError(null)
    setCameraFacing((current) => (current === 'back' ? 'front' : 'back'))
  }, [])

  const toggleFlash = useCallback(() => {
    setFlashMode((current) => (current === 'off' ? 'on' : 'off'))
  }, [])

  return (
    <Animated.View className="flex-1 bg-black" entering={FadeIn.duration(180)}>
      <View className="absolute inset-0">
        {controller.selectedAsset ? (
          <ReelVideo
            uri={controller.selectedAsset.uri}
            {...(controller.thumbnailUri ? { posterUri: controller.thumbnailUri } : {})}
            shouldPlay={false}
            loop
            muted={controller.isPreviewMuted}
            contentFit="cover"
            style={{ width: '100%', height: '100%', backgroundColor: '#050505' }}
          />
        ) : hasCameraAccess && !cameraError ? (
          <CameraView
            ref={cameraRef as React.Ref<React.ElementRef<typeof CameraView>>}
            active
            enableTorch={flashMode === 'on'}
            facing={cameraFacing}
            mode="video"
            mute={false}
            onCameraReady={() => {
              setIsCameraReady(true)
              setCameraError(null)
            }}
            onMountError={(event: { message?: string }) => {
              setIsCameraReady(false)
              setCameraError(event.message ?? 'Camera preview could not start.')
            }}
            responsiveOrientationWhenOrientationLocked
            style={{ width: '100%', height: '100%' }}
            videoQuality="1080p"
          />
        ) : (
          <LinearGradient
            colors={['#050505', '#120F10', '#1A1311']}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 1, y: 1 }}
            className="flex-1 items-center justify-center px-8"
          >
            <View className="h-20 w-20 items-center justify-center rounded-full bg-white/10">
              <MaterialIcons name="photo-camera" size={34} color="#FFFFFF" />
            </View>
            <Text
              className="mt-5 text-center text-base2 leading-6"
              style={{ color: 'rgba(255,255,255,0.72)' }}
            >
              {cameraError ?? 'Allow camera and microphone access to record inside Velora.'}
            </Text>
            <TouchableOpacity
              className="mt-6 rounded-full bg-[#FF7A45] px-6 py-3.5"
              activeOpacity={0.84}
              onPress={() => {
                setCameraError(null)
                void ensureCameraAccess()
              }}
            >
              <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>
                {hasCameraAccess ? 'Retry camera' : 'Allow camera'}
              </Text>
            </TouchableOpacity>
          </LinearGradient>
        )}
      </View>

      <LinearGradient
        colors={['rgba(0,0,0,0.72)', 'rgba(0,0,0,0.06)', 'rgba(0,0,0,0.92)']}
        locations={[0, 0.46, 1]}
        className="absolute inset-0"
        pointerEvents="none"
      />

      <View className="absolute inset-x-0 top-0 px-5" style={{ paddingTop: insets.top + 8 }}>
        <View className="flex-row items-center justify-between">
          <GlassIconButton icon="close" onPress={controller.handleClose} />

          <View className="flex-row gap-3">
            {!controller.selectedAsset ? (
              <>
                <GlassIconButton
                  icon={flashMode === 'on' ? 'flash-on' : 'flash-off'}
                  active={flashMode === 'on'}
                  onPress={toggleFlash}
                />
                <GlassIconButton icon="flip-camera-ios" onPress={toggleCameraFacing} />
              </>
            ) : null}

            {controller.selectedAsset || hasSavedDraft ? (
              <TouchableOpacity
                className="items-center justify-center rounded-full bg-white px-4 py-2"
                activeOpacity={0.84}
                onPress={controller.handleDiscardDraft}
                style={{
                  shadowColor: 'rgba(0, 0, 0, 0.18)',
                  shadowOffset: { width: 0, height: 8 },
                  shadowOpacity: 1,
                  shadowRadius: 18,
                  elevation: 3,
                }}
              >
                <Text
                  style={{
                    color: controller.selectedAsset ? '#D85A21' : '#17120F',
                    fontWeight: '700',
                    lineHeight: 20,
                  }}
                >
                  {controller.selectedAsset ? 'Discard' : 'Clear draft'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>

      <View
        className="absolute inset-x-0 bottom-0 px-5"
        style={{ paddingBottom: insets.bottom + 16 }}
      >
        {controller.selectedAsset ? (
          <View
            className="mb-5 rounded-[30px] bg-white px-5 py-5"
            style={{
              shadowColor: 'rgba(0, 0, 0, 0.18)',
              shadowOffset: { width: 0, height: 16 },
              shadowOpacity: 1,
              shadowRadius: 28,
              elevation: 6,
            }}
          >
            <View className="flex-row items-center">
              <View className="overflow-hidden rounded-[18px] border border-[#E9DED5]">
                {controller.thumbnailUri ? (
                  <Image
                    source={{ uri: controller.thumbnailUri }}
                    contentFit="cover"
                    style={{ width: 60, height: 84 }}
                  />
                ) : (
                  <View className="h-[84px] w-[60px] items-center justify-center bg-[#F7F2EC]">
                    <MaterialIcons name="movie" size={20} color="#17120F" />
                  </View>
                )}
              </View>

              <View className="ml-4 flex-1">
                <Text style={{ color: '#17120F', fontWeight: '800' }}>
                  {controller.orientationMessage}
                </Text>
                <Text className="mt-1 text-sm2" style={{ color: 'rgba(46,36,30,0.62)' }}>
                  {formatDurationLabel(controller.selectedAsset.duration) || '0:00'} •{' '}
                  {controller.selectedAssetType
                    ? controller.selectedAssetType.replace('video/', '').toUpperCase()
                    : 'Unknown'}
                </Text>
              </View>
            </View>

            <View className="mt-5 flex-row gap-3">
              <TouchableOpacity
                className="flex-1 rounded-[22px] bg-[#F7F2EC] px-4 py-4"
                activeOpacity={0.84}
                onPress={() => {
                  void controller.handlePickFromLibrary()
                }}
              >
                <Text className="text-center" style={{ color: '#17120F', fontWeight: '800' }}>
                  Replace
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 rounded-[22px] bg-[#FF7A45] px-4 py-4"
                activeOpacity={0.84}
                onPress={controller.goToEditStage}
              >
                <Text className="text-center" style={{ color: '#FFFFFF', fontWeight: '700' }}>
                  Open preview
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {!controller.selectedAsset ? (
          <>
            <View className="items-center">
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row gap-3">
                  {durationOptions.map((option) => (
                    <SegmentedPill
                      key={option}
                      label={`${option}s`}
                      active={controller.selectedDuration === option}
                      onPress={() => {
                        controller.setSelectedDuration(option)
                      }}
                    />
                  ))}
                </View>
              </ScrollView>
              <Text className="mt-2 text-xs2" style={{ color: 'rgba(255,255,255,0.72)' }}>
                Records up to {controller.selectedDuration}s
              </Text>
            </View>

            <View className="mt-6 flex-row items-center justify-between">
              <TouchableOpacity
                className="h-[74px] w-[74px] overflow-hidden rounded-[24px]"
                activeOpacity={0.84}
                onPress={() => {
                  void controller.handlePickFromLibrary()
                }}
                style={{
                  backgroundColor: 'rgba(255,255,255,0.18)',
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.22)',
                }}
              >
                {controller.thumbnailUri ? (
                  <Image
                    source={{ uri: controller.thumbnailUri }}
                    contentFit="cover"
                    style={{ width: '100%', height: '100%' }}
                  />
                ) : (
                  <View className="flex-1 items-center justify-center">
                    <MaterialIcons name="collections" size={24} color="#FFFFFF" />
                  </View>
                )}
              </TouchableOpacity>

              <TouchableOpacity activeOpacity={0.9} onPress={handleRecordPress}>
                <View
                  className={`h-[104px] w-[104px] items-center justify-center rounded-full border ${
                    isRecording ? 'border-[#FFB199] bg-[#FF7A45]/18' : 'border-white/14 bg-white/10'
                  }`}
                >
                  <View
                    className={`items-center justify-center ${
                      isRecording
                        ? 'h-[50px] w-[50px] rounded-[16px] bg-[#FF7A45]'
                        : 'h-[82px] w-[82px] rounded-full bg-[#FF7A45]'
                    }`}
                  >
                    <MaterialIcons
                      name={isRecording ? 'stop' : 'fiber-manual-record'}
                      size={28}
                      color="#FFFFFF"
                    />
                  </View>
                </View>
              </TouchableOpacity>

              {hasSavedDraft ? (
                <TouchableOpacity
                  className="h-[74px] w-[74px] items-center justify-center rounded-[24px] border border-[#5B3327] bg-[#241713]"
                  activeOpacity={0.84}
                  onPress={() => {
                    void controller.handleResumeDraft()
                  }}
                >
                  <MaterialIcons name="restore" size={24} color="#FFBEA8" />
                </TouchableOpacity>
              ) : (
                <View className="h-[74px] w-[74px]" />
              )}
            </View>
          </>
        ) : null}
      </View>
    </Animated.View>
  )
}

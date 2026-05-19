import { MaterialIcons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import React, { useMemo, useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native'
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'
import Animated, { interpolate, useAnimatedStyle } from 'react-native-reanimated'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { HashtagCaptionInput } from '../../src/components/reels/HashtagCaptionInput'
import { ReelVideo } from '../../src/components/reels/ReelVideo'
import { allowedVideoTypes } from '../../src/constants/reels'
import { useCreateReel } from '../../src/hooks/useReels'
import {
  extractHashtags,
  formatDurationLabel,
  resolveAllowedVideoType,
  stripHashtagsFromCaption,
} from '../../src/lib/reels'

import type { ImagePickerAsset } from 'expo-image-picker'

const shellShadow = {
  shadowColor: 'rgba(120, 88, 53, 0.08)',
  shadowOffset: { width: 0, height: 10 },
  shadowOpacity: 1,
  shadowRadius: 22,
  elevation: 5,
} as const

const sourceButtonBase = 'flex-1 flex-row items-center justify-center rounded-[18px] px-4 py-3.5'

export default function CreateReelScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const { progress } = useReanimatedKeyboardAnimation()
  const [selectedAsset, setSelectedAsset] = useState<ImagePickerAsset | null>(null)
  const [isPreviewMuted, setIsPreviewMuted] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const { mutate: createReel, isPending, step } = useCreateReel()
  const selectedAssetType = resolveAllowedVideoType(
    selectedAsset?.mimeType,
    selectedAsset?.fileName ?? selectedAsset?.uri,
  )
  const extractedTags = useMemo(() => extractHashtags(description), [description])
  const sanitizedDescription = useMemo(() => stripHashtagsFromCaption(description), [description])
  const previewExpandedHeight = Math.min(320, Math.max(240, windowHeight * 0.34))
  const previewCollapsedHeight = 156

  const previewStyle = useAnimatedStyle(() => ({
    height: interpolate(progress.value, [0, 1], [previewExpandedHeight, previewCollapsedHeight]),
  }))

  const handleSelectedAsset = (asset: ImagePickerAsset) => {
    const resolvedType = resolveAllowedVideoType(asset.mimeType, asset.fileName ?? asset.uri)

    if (!resolvedType) {
      Alert.alert(
        'Unsupported video',
        `Please use one of these formats: ${allowedVideoTypes.join(', ')}`,
      )
      return
    }

    setSelectedAsset(asset)
    setIsPreviewMuted(false)
  }

  const handlePickFromLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (permission.status !== 'granted') {
      Alert.alert('Permission denied', 'Velora needs library access to pick a reel.')
      return
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: false,
      quality: 1,
      videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
    })

    if (result.canceled || result.assets.length === 0) {
      return
    }

    handleSelectedAsset(result.assets[0])
  }

  const handleRecordVideo = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (permission.status !== 'granted') {
      Alert.alert('Permission denied', 'Velora needs camera access to record a reel.')
      return
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['videos'],
      allowsEditing: false,
      quality: 1,
      videoMaxDuration: 90,
      videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
    })

    if (result.canceled || result.assets.length === 0) {
      return
    }

    handleSelectedAsset(result.assets[0])
  }

  const handleSubmit = () => {
    if (!selectedAsset) {
      Alert.alert('Choose a video', 'Pick or record a clip first.')
      return
    }

    if (!selectedAssetType) {
      Alert.alert(
        'Unsupported video',
        `Please use one of these formats: ${allowedVideoTypes.join(', ')}`,
      )
      return
    }

    if (!title.trim()) {
      Alert.alert('Title required', 'Add a title before publishing.')
      return
    }

    createReel(
      {
        fileUri: selectedAsset.uri,
        fileType: selectedAssetType,
        title: title.trim(),
        description: sanitizedDescription,
        tags: extractedTags,
      },
      {
        onSuccess: () => {
          Alert.alert('Reel created', 'Your reel is processing.', [
            {
              text: 'Back',
              onPress: () => {
                router.back()
              },
            },
          ])
        },
        onError: (err) => {
          const error = err as Error & { response?: { data?: { message?: string } } }
          Alert.alert('Creation failed', error.response?.data?.message || error.message)
        },
      },
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-[#F6EFE7]" edges={['top']}>
      <StatusBar style="dark" />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <View className="flex-1 px-5 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
          <View className="flex-row items-center justify-between">
            <TouchableOpacity
              className="h-11 w-11 items-center justify-center rounded-full bg-white"
              onPress={() => {
                router.back()
              }}
              activeOpacity={0.82}
              style={shellShadow}
            >
              <MaterialIcons name="arrow-back" size={22} color="#161616" />
            </TouchableOpacity>

            <Text className="font-heading text-lg text-text-primary">New reel</Text>

            <TouchableOpacity
              className={`rounded-full px-5 py-3 ${isPending ? 'bg-brand-light' : 'bg-brand'}`}
              activeOpacity={0.84}
              onPress={handleSubmit}
              disabled={isPending}
            >
              <Text className="font-medium text-white">
                {isPending ? (step === 'uploading' ? 'Uploading' : 'Publishing') : 'Publish'}
              </Text>
            </TouchableOpacity>
          </View>

          <Animated.View
            className="mt-4 overflow-hidden rounded-[34px] border border-[#E7D5C5] bg-white"
            style={[shellShadow, previewStyle]}
          >
            {selectedAsset ? (
              <>
                <ReelVideo
                  uri={selectedAsset.uri}
                  shouldPlay
                  loop
                  muted={isPreviewMuted}
                  contentFit="cover"
                  style={{ width: '100%', height: '100%', backgroundColor: '#101011' }}
                />

                <TouchableOpacity
                  className="absolute left-4 top-4 h-10 w-10 items-center justify-center rounded-full bg-black/22"
                  activeOpacity={0.84}
                  onPress={() => {
                    setIsPreviewMuted((current) => !current)
                  }}
                >
                  <MaterialIcons
                    name={isPreviewMuted ? 'volume-off' : 'volume-up'}
                    size={18}
                    color="#FFFFFF"
                  />
                </TouchableOpacity>

                <View className="absolute right-4 top-4 rounded-full bg-black/22 px-3 py-1.5">
                  <Text className="text-sm2 text-white">
                    {formatDurationLabel(selectedAsset.duration) || 'Preview'}
                  </Text>
                </View>
              </>
            ) : (
              <LinearGradient
                colors={['#FFE4D3', '#FFF6EE']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                className="flex-1 items-center justify-start pt-14"
              >
                <View className="h-16 w-16 items-center justify-center rounded-full bg-white/80">
                  <MaterialIcons name="play-circle-outline" size={34} color="#D85A21" />
                </View>
                <Text className="mt-4 font-heading text-[28px] text-text-primary">Pick a clip</Text>
              </LinearGradient>
            )}

            <View className="absolute inset-x-0 bottom-0 px-4 pb-4">
              <View className="flex-row gap-3">
                <TouchableOpacity
                  className={`${sourceButtonBase} bg-[#111111]`}
                  activeOpacity={0.84}
                  onPress={handleRecordVideo}
                >
                  <MaterialIcons name="videocam" size={18} color="#FFFFFF" />
                  <Text className="ml-2 font-medium text-white">Record</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  className={`${sourceButtonBase} bg-white`}
                  activeOpacity={0.84}
                  onPress={handlePickFromLibrary}
                  style={shellShadow}
                >
                  <MaterialIcons name="collections" size={18} color="#161616" />
                  <Text className="ml-2 font-medium text-text-primary">Library</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>

          <View
            className="mt-4 flex-1 rounded-[30px] border border-[#E7D5C5] bg-white px-4 py-4"
            style={shellShadow}
          >
            <View className="rounded-[22px] bg-surface-input px-4 py-3.5">
              <TextInput
                className="text-md text-text-primary"
                placeholder="Title"
                placeholderTextColor="#A6A6A6"
                value={title}
                onChangeText={setTitle}
                maxLength={120}
                editable={!isPending}
              />
            </View>

            <View className="mt-4 flex-1 rounded-[22px] bg-surface-input px-4 py-4">
              <HashtagCaptionInput
                value={description}
                onChangeText={setDescription}
                placeholder="Write a caption... #cityrun"
                editable={!isPending}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

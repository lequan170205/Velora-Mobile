import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert } from 'react-native'

import {
  MAX_CAPTION_LENGTH,
  REEL_CREATOR_DRAFT_KEY,
  bannedHashtags,
  durationOptions,
  hashtagSuggestions,
  mentionSuggestions,
} from '../constants/reel-creator'
import { allowedVideoTypes } from '../constants/reels'
import {
  buildDerivedTitle,
  buildTimelineFrames,
  getComposerToken,
  getOrientationMessage,
  replaceComposerToken,
} from '../lib/reel-creator'
import { extractHashtags, resolveAllowedVideoType, stripHashtagsFromCaption } from '../lib/reels'

import { useCreateReel } from './useReels'

import type { ReelVideoProgress } from '../components/reels/ReelVideo'
import type {
  CreateStage,
  DraftState,
  ImportState,
  StoredAsset,
  TimelineFrame,
} from '../types/reel-creator'
import type { ReelVisibility } from '../types/reel.types'

const DEFAULT_DURATION = durationOptions[1]

export function useReelCreator() {
  const router = useRouter()
  const hydrateCompletedRef = useRef(false)
  const [stage, setStage] = useState<CreateStage>('capture')
  const [selectedAsset, setSelectedAsset] = useState<StoredAsset | null>(null)
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(null)
  const [timelineFrames, setTimelineFrames] = useState<TimelineFrame[]>([])
  const [isPreviewMuted, setIsPreviewMuted] = useState(false)
  const [selectedDuration, setSelectedDuration] = useState(DEFAULT_DURATION)
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [visibility, setVisibility] = useState<ReelVisibility>('public')
  const [videoDurationSeconds, setVideoDurationSeconds] = useState(0)
  const [videoPlaybackPosition, setVideoPlaybackPosition] = useState(0)
  const [importState, setImportState] = useState<ImportState>({
    active: false,
    label: '',
    progress: 0,
  })
  const [captureHint, setCaptureHint] = useState('Record a clip or choose one from your gallery')
  const [availableDraft, setAvailableDraft] = useState<DraftState | null>(null)
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null)
  const [draftSaveStatus, setDraftSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [didRestoreDraft, setDidRestoreDraft] = useState(false)
  const { mutateAsync: createReelAsync, isPending, step } = useCreateReel()

  const selectedAssetType = useMemo(
    () =>
      resolveAllowedVideoType(
        selectedAsset?.mimeType,
        selectedAsset?.fileName ?? selectedAsset?.uri,
      ),
    [selectedAsset],
  )
  const extractedTags = useMemo(() => extractHashtags(caption), [caption])
  const sanitizedDescription = useMemo(() => stripHashtagsFromCaption(caption), [caption])
  const captionToken = useMemo(() => getComposerToken(caption), [caption])
  const publishProgressLabel = isPending
    ? step === 'uploading'
      ? 'Uploading reel...'
      : 'Publishing...'
    : 'Publish reel'
  const orientationMessage = useMemo(() => getOrientationMessage(selectedAsset), [selectedAsset])
  const filteredComposerSuggestions = useMemo(() => {
    if (!captionToken) {
      return hashtagSuggestions.slice(0, 4).map((tag) => `#${tag}`)
    }

    if (captionToken.startsWith('#')) {
      const query = captionToken.replace(/^#/, '').toLowerCase()
      return hashtagSuggestions
        .filter((item) => item.includes(query))
        .slice(0, 6)
        .map((item) => `#${item}`)
    }

    if (captionToken.startsWith('@')) {
      const query = captionToken.replace(/^@/, '').toLowerCase()
      return mentionSuggestions
        .filter((item) => item.includes(query))
        .slice(0, 6)
        .map((item) => `@${item}`)
    }

    return []
  }, [captionToken])

  const pulseHaptic = useCallback(
    (style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) => {
      void Haptics.impactAsync(style).catch(() => undefined)
    },
    [],
  )

  const resetCreatorState = useCallback(() => {
    setStage('capture')
    setSelectedAsset(null)
    setThumbnailUri(null)
    setTimelineFrames([])
    setIsPreviewMuted(false)
    setSelectedDuration(DEFAULT_DURATION)
    setTitle('')
    setCaption('')
    setVisibility('public')
    setVideoDurationSeconds(0)
    setVideoPlaybackPosition(0)
    setImportState({
      active: false,
      label: '',
      progress: 0,
    })
    setCaptureHint('Record a clip or choose one from your gallery')
    setAvailableDraft(null)
    setDraftSavedAt(null)
    setDraftSaveStatus('idle')
    setDidRestoreDraft(false)
  }, [])

  const saveDraftSnapshot = useCallback(async (nextDraft: DraftState | null) => {
    if (!nextDraft) {
      await AsyncStorage.removeItem(REEL_CREATOR_DRAFT_KEY)
      setAvailableDraft(null)
      setDraftSavedAt(null)
      return
    }

    await AsyncStorage.setItem(REEL_CREATOR_DRAFT_KEY, JSON.stringify(nextDraft))
    setAvailableDraft(nextDraft)
    setDraftSavedAt(nextDraft.savedAt)
  }, [])

  const buildDraftSnapshot = useCallback(
    (savedAt: number): DraftState | null =>
      selectedAsset
        ? {
            stage,
            asset: selectedAsset,
            title,
            caption,
            visibility,
            durationOption: selectedDuration,
            savedAt,
          }
        : null,
    [caption, selectedAsset, selectedDuration, stage, title, visibility],
  )

  const applySelectedAsset = useCallback(
    async (
      asset: StoredAsset,
      {
        label,
        stageAfterImport = 'edit',
        showOverlay = true,
        captureMessage = 'Clip attached. Review it and continue when ready.',
      }: {
        label: string
        stageAfterImport?: CreateStage
        showOverlay?: boolean
        captureMessage?: string
      },
    ) => {
      const resolvedType = resolveAllowedVideoType(asset.mimeType, asset.fileName ?? asset.uri)

      if (!resolvedType) {
        Alert.alert(
          'Unsupported video',
          `Please use one of these formats: ${allowedVideoTypes.join(', ')}`,
        )
        return
      }

      const storedAsset: StoredAsset = {
        uri: asset.uri,
        fileName: asset.fileName ?? null,
        mimeType: resolvedType,
        duration: asset.duration ?? null,
        width: asset.width ?? null,
        height: asset.height ?? null,
      }

      if (showOverlay) {
        setImportState({
          active: true,
          label,
          progress: 0.2,
        })
      } else {
        setImportState({
          active: false,
          label: '',
          progress: 0,
        })
      }
      setSelectedAsset(storedAsset)
      setStage(stageAfterImport)
      setVideoPlaybackPosition(0)
      setVideoDurationSeconds(0)
      setIsPreviewMuted(false)
      setCaptureHint(captureMessage)

      try {
        const frames = await buildTimelineFrames(storedAsset)
        const fallbackFrame = frames[0]?.uri ?? storedAsset.uri
        setTimelineFrames(frames.length > 0 ? frames : [{ uri: fallbackFrame, timeMs: 0 }])
        setThumbnailUri(fallbackFrame)
      } catch {
        setTimelineFrames([{ uri: storedAsset.uri, timeMs: 0 }])
        setThumbnailUri(storedAsset.uri)
      }

      if (showOverlay) {
        setImportState({
          active: true,
          label: 'Preview ready',
          progress: 1,
        })
        setTimeout(() => {
          setImportState({
            active: false,
            label: '',
            progress: 0,
          })
        }, 220)
      }
    },
    [],
  )

  const handlePickFromLibrary = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()

    if (permission.status !== 'granted') {
      Alert.alert(
        'Library permission needed',
        'Velora needs media library access to import a reel from your device.',
      )
      return
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: false,
      quality: 1,
      videoExportPreset: ImagePicker.VideoExportPreset.MediumQuality,
      videoMaxDuration: 90,
    })

    if (result.canceled || result.assets.length === 0) {
      return
    }

    pulseHaptic()
    setDidRestoreDraft(false)
    await applySelectedAsset(result.assets[0], {
      label: 'Importing video from gallery',
    })
  }, [applySelectedAsset, pulseHaptic])

  const handleCameraRecordingComplete = useCallback(
    async (uri: string) => {
      pulseHaptic(Haptics.ImpactFeedbackStyle.Medium)
      setDidRestoreDraft(false)
      await applySelectedAsset(
        {
          uri,
          fileName: `velora-reel-${Date.now()}.mp4`,
          mimeType: 'video/mp4',
          duration: selectedDuration * 1000,
          width: 1080,
          height: 1920,
        },
        {
          label: 'Preparing camera clip',
        },
      )
    },
    [applySelectedAsset, pulseHaptic, selectedDuration],
  )

  const handleInsertComposerSuggestion = useCallback(
    (value: string) => {
      setCaption((current) => replaceComposerToken(current, value))
      pulseHaptic()
    },
    [pulseHaptic],
  )

  const handleSaveDraftManually = useCallback(async () => {
    const nextDraft = buildDraftSnapshot(Date.now())

    if (!nextDraft) {
      Alert.alert('No clip attached', 'Record or import a reel before saving a draft.')
      return
    }

    setDraftSaveStatus('saving')

    try {
      await saveDraftSnapshot(nextDraft)
      pulseHaptic()
      setDraftSaveStatus('saved')
      setCaptureHint('Draft saved on this device.')
    } catch {
      setDraftSaveStatus('idle')
      Alert.alert('Draft not saved', 'Velora could not save this draft on your device.')
    }
  }, [buildDraftSnapshot, pulseHaptic, saveDraftSnapshot])

  const handleResumeDraft = useCallback(async () => {
    if (!availableDraft?.asset) {
      return
    }

    setTitle(availableDraft.title ?? '')
    setCaption(availableDraft.caption ?? '')
    setVisibility(availableDraft.visibility ?? 'public')
    setSelectedDuration(availableDraft.durationOption ?? DEFAULT_DURATION)
    setDraftSavedAt(availableDraft.savedAt ?? Date.now())
    setDidRestoreDraft(true)

    await applySelectedAsset(availableDraft.asset, {
      label: 'Restoring draft',
      stageAfterImport: availableDraft.stage === 'publish' ? 'publish' : 'edit',
      showOverlay: false,
      captureMessage: 'Saved draft loaded. Review this clip or continue posting.',
    })
  }, [applySelectedAsset, availableDraft])

  const handleDiscardDraft = useCallback(() => {
    const message = selectedAsset
      ? 'This removes the attached video and clears the saved draft.'
      : 'This clears the saved draft from this device.'

    Alert.alert('Discard draft?', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          resetCreatorState()
          void saveDraftSnapshot(null)
        },
      },
    ])
  }, [resetCreatorState, saveDraftSnapshot, selectedAsset])

  const handlePublish = useCallback(async () => {
    if (!selectedAsset) {
      Alert.alert('Select a video', 'Record or import a vertical video before publishing.')
      setStage('capture')
      return
    }

    if (!selectedAssetType) {
      Alert.alert(
        'Unsupported video',
        `Please use one of these formats: ${allowedVideoTypes.join(', ')}`,
      )
      return
    }

    const finalTitle = title.trim() || buildDerivedTitle(caption)

    if (!finalTitle) {
      Alert.alert('Title required', 'Add a title or caption before publishing this reel.')
      return
    }

    if (caption.length > MAX_CAPTION_LENGTH) {
      Alert.alert('Caption too long', `Keep your caption under ${MAX_CAPTION_LENGTH} characters.`)
      return
    }

    const blockedTags = extractedTags.filter((tag) => bannedHashtags.includes(tag))

    if (blockedTags.length > 0) {
      Alert.alert(
        'Banned hashtags',
        `Remove these hashtags before publishing: ${blockedTags.join(', ')}`,
      )
      return
    }

    const payload = {
      fileUri: selectedAsset.uri,
      fileType: selectedAssetType,
      title: finalTitle,
      description: sanitizedDescription,
      tags: extractedTags,
      visibility,
      ...(thumbnailUri ? { localThumbnailUri: thumbnailUri } : {}),
    }

    let lastError: Error | null = null

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        if (attempt === 1) {
          pulseHaptic()
        }

        const createdReel = await createReelAsync(payload)
        await saveDraftSnapshot(null)
        resetCreatorState()
        router.replace({
          pathname: '/reels/[id]',
          params: { id: createdReel.id, source: 'profile', returnTo: 'profile' },
        })
        return
      } catch (error) {
        lastError = error as Error & { response?: { data?: { message?: string } } }
        if ((error as { reelCreated?: boolean }).reelCreated) {
          break
        }
      }
    }

    Alert.alert(
      'Publish failed',
      (lastError as (Error & { response?: { data?: { message?: string } } }) | null)?.response?.data
        ?.message ||
        lastError?.message ||
        'Velora could not upload this reel.',
    )
  }, [
    caption,
    createReelAsync,
    extractedTags,
    pulseHaptic,
    resetCreatorState,
    router,
    sanitizedDescription,
    saveDraftSnapshot,
    selectedAsset,
    selectedAssetType,
    thumbnailUri,
    title,
    visibility,
  ])

  const handleEditorProgress = useCallback(
    ({ currentTime, duration }: ReelVideoProgress) => {
      if (duration > 0 && duration !== videoDurationSeconds) {
        setVideoDurationSeconds(duration)
      }

      setVideoPlaybackPosition(currentTime)
    },
    [videoDurationSeconds],
  )

  useEffect(() => {
    let cancelled = false

    const hydrateDraft = async () => {
      try {
        const rawValue = await AsyncStorage.getItem(REEL_CREATOR_DRAFT_KEY)

        if (!rawValue || cancelled) {
          return
        }

        const draft = JSON.parse(rawValue) as Partial<DraftState>

        if (!draft.asset) {
          await AsyncStorage.removeItem(REEL_CREATOR_DRAFT_KEY)
          return
        }

        setAvailableDraft({
          stage: draft.stage ?? 'edit',
          asset: draft.asset,
          title: draft.title ?? '',
          caption: draft.caption ?? '',
          visibility: draft.visibility ?? 'public',
          durationOption: draft.durationOption ?? DEFAULT_DURATION,
          savedAt: draft.savedAt ?? Date.now(),
        })
        setDraftSavedAt(draft.savedAt ?? Date.now())
      } catch {
        await AsyncStorage.removeItem(REEL_CREATOR_DRAFT_KEY)
      } finally {
        hydrateCompletedRef.current = true
      }
    }

    void hydrateDraft()

    return () => {
      cancelled = true
    }
  }, [applySelectedAsset])

  useEffect(() => {
    if (!hydrateCompletedRef.current) {
      return
    }

    const timer = setTimeout(() => {
      void saveDraftSnapshot(buildDraftSnapshot(Date.now()))
    }, 320)

    return () => {
      clearTimeout(timer)
    }
  }, [buildDraftSnapshot, saveDraftSnapshot])

  useEffect(() => {
    if (!selectedAsset && stage !== 'capture') {
      setStage('capture')
    }
  }, [selectedAsset, stage])

  useEffect(() => {
    if (draftSaveStatus !== 'saved') {
      return
    }

    const timer = setTimeout(() => {
      setDraftSaveStatus('idle')
    }, 1600)

    return () => {
      clearTimeout(timer)
    }
  }, [draftSaveStatus])

  const handleClose = useCallback(() => {
    router.back()
  }, [router])

  const goToCaptureStage = useCallback(() => {
    setStage('capture')
  }, [])

  const goToEditStage = useCallback(() => {
    if (selectedAsset) {
      setStage('edit')
    }
  }, [selectedAsset])

  const goToPublishStage = useCallback(() => {
    if (selectedAsset) {
      setStage('publish')
    }
  }, [selectedAsset])

  const togglePreviewMuted = useCallback(() => {
    pulseHaptic()
    setIsPreviewMuted((current) => !current)
  }, [pulseHaptic])

  const toggleEditorPlaying = useCallback(() => {
    pulseHaptic()
    setVideoPlaybackPosition((current) => current)
  }, [pulseHaptic])

  return {
    caption,
    captureHint,
    didRestoreDraft,
    draftSavedAt,
    draftSaveStatus,
    extractedTags,
    filteredComposerSuggestions,
    goToCaptureStage,
    goToEditStage,
    goToPublishStage,
    handleResumeDraft,
    handleClose,
    handleDiscardDraft,
    handleEditorProgress,
    handleInsertComposerSuggestion,
    handleCameraRecordingComplete,
    handlePickFromLibrary,
    handlePublish,
    handleSaveDraftManually,
    importState,
    isPending,
    isPreviewMuted,
    orientationMessage,
    publishProgressLabel,
    selectedAsset,
    selectedAssetType,
    selectedDuration,
    setCaption,
    setSelectedDuration,
    setTitle,
    setVisibility,
    stage,
    thumbnailUri,
    timelineFrames,
    title,
    toggleEditorPlaying,
    togglePreviewMuted,
    availableDraft,
    videoDurationSeconds,
    videoPlaybackPosition,
    visibility,
  }
}

export type ReelCreatorController = ReturnType<typeof useReelCreator>

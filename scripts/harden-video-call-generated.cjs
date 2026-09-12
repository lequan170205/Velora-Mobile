const fs = require('node:fs')

const replaceOnce = (source, before, after, label) => {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`Missing hardening anchor: ${label}`)
  return source.replace(before, after)
}

const typesPath = 'src/types/call.types.ts'
let types = fs.readFileSync(typesPath, 'utf8')
if (!types.includes('export interface SetVideoEnabledPayload')) {
  types = replaceOnce(
    types,
    `export interface SetCallTypePayload {\n  callId: string\n  callType: CallType\n}`,
    `export interface SetCallTypePayload {\n  callId: string\n  callType: CallType\n}\n\nexport interface SetVideoEnabledPayload {\n  callId: string\n  producerId: string\n  enabled: boolean\n}`,
    'SetVideoEnabledPayload',
  )
}
types = types.replace(
  /kind: 'audio' \| 'video'\n  \}\[\]/g,
  "kind: 'audio' | 'video'\n    paused?: boolean\n  }[]",
)
if (!types.includes('paused?: boolean\n}')) {
  types = replaceOnce(
    types,
    `export interface NewProducerPayload {\n  callId: string\n  userId: string\n  producerId: string\n  kind: 'audio' | 'video'\n}`,
    `export interface NewProducerPayload {\n  callId: string\n  userId: string\n  producerId: string\n  kind: 'audio' | 'video'\n  paused?: boolean\n}`,
    'NewProducerPayload.paused',
  )
}
if (!types.includes('export interface VideoStateChangedPayload')) {
  types = replaceOnce(
    types,
    `export interface CallTypeChangedPayload {\n  callId: string\n  callType: CallType\n  changedByUserId: string\n}`,
    `export interface CallTypeChangedPayload {\n  callId: string\n  callType: CallType\n  changedByUserId: string\n}\n\nexport interface VideoStateChangedPayload {\n  callId: string\n  userId: string\n  producerId: string\n  enabled: boolean\n}`,
    'VideoStateChangedPayload',
  )
}
if (!types.includes('video_state_changed: (payload: VideoStateChangedPayload)')) {
  types = replaceOnce(
    types,
    `  call_type_changed: (payload: CallTypeChangedPayload) => void`,
    `  call_type_changed: (payload: CallTypeChangedPayload) => void\n  video_state_changed: (payload: VideoStateChangedPayload) => void`,
    'video_state_changed server event',
  )
}
if (!types.includes('set_video_enabled: (payload: SetVideoEnabledPayload)')) {
  types = replaceOnce(
    types,
    `  set_call_type: (payload: SetCallTypePayload) => void`,
    `  set_call_type: (payload: SetCallTypePayload) => void\n  set_video_enabled: (payload: SetVideoEnabledPayload) => void`,
    'set_video_enabled client event',
  )
}
fs.writeFileSync(typesPath, types)

const providerPath = 'src/providers/CallProvider.tsx'
let provider = fs.readFileSync(providerPath, 'utf8')
provider = provider.replace(
  /\n      if \(payload\.callType === 'VIDEO'\) \{\n        socketRef\.current\?\.emit\('reject_call', \{\n          callId: payload\.callId,\n          reason: 'unsupported_video',\n        \}\)\n        presentError\('Video calls are not supported yet'\)\n        return\n      \}\n/g,
  '\n',
)
provider = provider.replace(
  /\n        if \(callState\.callType === 'VIDEO'\) \{\n          veloraSystemCalls\.dismissIncomingCall\(action\.callId\)\n          completeNativeCallAction\(action\.actionId\)\n          return\n        \}\n/g,
  '\n',
)
provider = provider.replace(
  /catch \{\}/g,
  "catch {\n        // Best-effort media cleanup; the native resource may already be closed.\n      }",
)
provider = provider.replace(
  '    [currentUserId, presentError, queryClient],\n  )',
  '    [currentUserId, queryClient],\n  )',
)
if (!provider.includes('VideoStateChangedPayload,')) {
  provider = replaceOnce(
    provider,
    `  UseCallValue,\n} from '../types/call.types'`,
    `  UseCallValue,\n  VideoStateChangedPayload,\n} from '../types/call.types'`,
    'VideoStateChangedPayload import',
  )
}
if (!provider.includes('remoteVideoEnabledByProducerRef')) {
  provider = replaceOnce(
    provider,
    `  const handledRemoteProducerIdsRef = useRef<Set<string>>(new Set())`,
    `  const handledRemoteProducerIdsRef = useRef<Set<string>>(new Set())\n  const remoteVideoEnabledByProducerRef = useRef<Map<string, boolean>>(new Map())`,
    'remote video state map ref',
  )
  provider = replaceOnce(
    provider,
    `      handledRemoteProducerIdsRef.current.clear()\n      consumingProducerIdsRef.current.clear()`,
    `      handledRemoteProducerIdsRef.current.clear()\n      remoteVideoEnabledByProducerRef.current.clear()\n      consumingProducerIdsRef.current.clear()`,
    'remote video state map reset',
  )
}

if (!provider.includes('const emitLocalVideoState = useCallback')) {
  provider = replaceOnce(
    provider,
    `  const deactivateLocalVideo = useCallback(() => {`,
    `  const emitLocalVideoState = useCallback((enabled: boolean) => {\n    const state = useCallStore.getState()\n    const socket = socketRef.current\n    const producerId = videoProducerRef.current?.id\n    if (\n      state.phase !== 'active' ||\n      state.callType !== 'VIDEO' ||\n      !state.callId ||\n      !producerId ||\n      !socket?.connected\n    ) {\n      return\n    }\n\n    socket.emit('set_video_enabled', {\n      callId: state.callId,\n      producerId,\n      enabled,\n    })\n  }, [])\n\n  const deactivateLocalVideo = useCallback(() => {`,
    'emitLocalVideoState helper',
  )
}
provider = provider.replace(
  `      if (existingTrack && existingTrack.readyState === 'live') {\n        existingTrack.enabled = true\n        useCallStore.getState().patch({\n          cameraEnabled: true,\n          localStreamUrl: localStreamRef.current?.toURL() ?? null,\n        })\n        return true\n      }`,
  `      if (existingTrack && existingTrack.readyState === 'live') {\n        existingTrack.enabled = true\n        emitLocalVideoState(true)\n        useCallStore.getState().patch({\n          cameraEnabled: true,\n          localStreamUrl: localStreamRef.current?.toURL() ?? null,\n        })\n        return true\n      }`,
)
provider = provider.replace(
  `    [ensureCameraPermission, presentError],\n  )`,
  `    [emitLocalVideoState, ensureCameraPermission, presentError],\n  )`,
)
provider = provider.replace(
  `    if (track) track.enabled = false\n    useCallStore.getState().patch({ cameraEnabled: false })`,
  `    if (track) track.enabled = false\n    emitLocalVideoState(false)\n    useCallStore.getState().patch({ cameraEnabled: false })`,
)
provider = provider.replace(
  `  }, [activateLocalVideo])\n\n  const switchCamera`,
  `  }, [activateLocalVideo, emitLocalVideoState])\n\n  const switchCamera`,
)

if (!provider.includes('const shouldDeferLocalVideo =')) {
  provider = provider.replace(
    "      const callType = payload.session.callType\n      const telemetry = telemetrySessionRef.current",
    "      const callType = payload.session.callType\n      const shouldDeferLocalVideo =\n        callType === 'VIDEO' && AppState.currentState !== 'active'\n      const telemetry = telemetrySessionRef.current",
  )
}
provider = provider.replace(
  "            video: callType === 'VIDEO' ? cameraConstraints(stateBeforeMedia.cameraFacing) : false,",
  "            video:\n              callType === 'VIDEO' && !shouldDeferLocalVideo\n                ? cameraConstraints(stateBeforeMedia.cameraFacing)\n                : false,",
)
provider = provider.replace(
  "      if (callType === 'VIDEO' && !localVideoTrack)\n        throw new Error('No local video track available')",
  "      if (callType === 'VIDEO' && !shouldDeferLocalVideo && !localVideoTrack)\n        throw new Error('No local video track available')",
)
if (!provider.includes('cameraPausedByBackgroundRef.current = true\n\n      const consumers =')) {
  provider = provider.replace(
    '      const consumers = [...consumerMapRef.current.values()]',
    "      if (shouldDeferLocalVideo) {\n        cameraPausedByBackgroundRef.current = true\n      }\n\n      const consumers = [...consumerMapRef.current.values()]",
  )
}
provider = provider.replace(
  "        cameraEnabled: callType === 'VIDEO' && Boolean(localVideoTrack),",
  "        cameraEnabled:\n          callType === 'VIDEO' && (Boolean(localVideoTrack) || shouldDeferLocalVideo),",
)
provider = provider.replace(
  /\{ callId, userId: producer\.userId, producerId: producer\.producerId, kind: producer\.kind \}/g,
  `{\n            callId,\n            userId: producer.userId,\n            producerId: producer.producerId,\n            kind: producer.kind,\n            paused: producer.paused,\n          }`,
)
provider = provider.replace(
  /\{\n            callId: rejoined\.callId,\n            userId: producer\.userId,\n            producerId: producer\.producerId,\n            kind: producer\.kind,\n          \}/g,
  `{\n            callId: rejoined.callId,\n            userId: producer.userId,\n            producerId: producer.producerId,\n            kind: producer.kind,\n            paused: producer.paused,\n          }`,
)

provider = provider.replace(
  `        if (payload.kind === 'video') {\n          useCallStore.getState().patch({ remoteVideoState: 'connected' })\n          return\n        }`,
  `        if (payload.kind === 'video') {\n          if (payload.paused !== undefined) {\n            remoteVideoEnabledByProducerRef.current.set(payload.producerId, !payload.paused)\n          }\n          const videoEnabled =\n            remoteVideoEnabledByProducerRef.current.get(payload.producerId) ?? !payload.paused\n          useCallStore.getState().patch({\n            remoteVideoState: videoEnabled ? 'connected' : 'off',\n          })\n          return\n        }`,
)

provider = provider.replace(
  `          localVideoTrack.enabled = false\n          cameraPausedByBackgroundRef.current = true`,
  `          localVideoTrack.enabled = false\n          emitLocalVideoState(false)\n          cameraPausedByBackgroundRef.current = true`,
)
provider = provider.replace(
  `        if (localVideoTrack) {\n          localVideoTrack.enabled = true\n          cameraPausedByBackgroundRef.current = false`,
  `        if (localVideoTrack) {\n          localVideoTrack.enabled = true\n          emitLocalVideoState(true)\n          cameraPausedByBackgroundRef.current = false`,
)
provider = provider.replace(
  `  }, [activateLocalVideo, processPendingNativeCallAction])`,
  `  }, [activateLocalVideo, emitLocalVideoState, processPendingNativeCallAction])`,
)

if (!provider.includes('const handleVideoStateChanged = (payload: VideoStateChangedPayload)')) {
  provider = replaceOnce(
    provider,
    `    const handlePeerLeft = (payload: PeerLeftPayload) => {`,
    `    const handleVideoStateChanged = (payload: VideoStateChangedPayload) => {\n      if (!isCurrentCall(payload.callId) || payload.userId === currentUserId) return\n\n      remoteVideoEnabledByProducerRef.current.set(payload.producerId, payload.enabled)\n      const hasVideoConsumer = [...consumerMapRef.current.values()].some(\n        (consumer) => consumer.producerId === payload.producerId && consumer.kind === 'video',\n      )\n      useCallStore.getState().patch({\n        remoteVideoState: payload.enabled\n          ? hasVideoConsumer\n            ? 'connected'\n            : 'waiting'\n          : 'off',\n      })\n    }\n\n    const handlePeerLeft = (payload: PeerLeftPayload) => {`,
    'video state socket handler',
  )
  provider = replaceOnce(
    provider,
    `    socket.on('call_type_changed', handleCallTypeChanged)`,
    `    socket.on('call_type_changed', handleCallTypeChanged)\n    socket.on('video_state_changed', handleVideoStateChanged)`,
    'video state socket listener',
  )
  provider = replaceOnce(
    provider,
    `      socket.off('call_type_changed', handleCallTypeChanged)`,
    `      socket.off('call_type_changed', handleCallTypeChanged)\n      socket.off('video_state_changed', handleVideoStateChanged)`,
    'video state socket cleanup',
  )
}
provider = provider.replace(
  `      consumerMapRef.current.delete(consumerId)\n      handledRemoteProducerIdsRef.current.delete(payload.producerId)`,
  `      consumerMapRef.current.delete(consumerId)\n      handledRemoteProducerIdsRef.current.delete(payload.producerId)\n      remoteVideoEnabledByProducerRef.current.delete(payload.producerId)`,
)
fs.writeFileSync(providerPath, provider)

const layoutPath = 'app/_layout.tsx'
let layout = fs.readFileSync(layoutPath, 'utf8')
layout = layout.replace("import { useQueryClient } from '@tanstack/react-query'\n", '')
layout = layout.replace(
  "import { useEffect, useMemo, useState } from 'react'",
  "import { useEffect, useState } from 'react'",
)
layout = layout.replace("import { queryKeys } from '../src/constants/queryKeys'\n", '')
layout = layout.replace("\nimport type { Conversation } from '../src/types/conversation.types'\n", '\n')
const shortcutStart = layout.indexOf('const getConversationList =')
const bannerStart = layout.indexOf('function ActiveCallBanner()')
if (shortcutStart >= 0 && bannerStart > shortcutStart) {
  layout = layout.slice(0, shortcutStart) + layout.slice(bannerStart)
}
layout = layout.replace('      <ConversationVideoCallShortcut />\n', '')
fs.writeFileSync(layoutPath, layout)

const callScreenPath = 'app/call/[id].tsx'
let callScreen = fs.readFileSync(callScreenPath, 'utf8')
callScreen = callScreen.replace(
  "import { RTCView } from 'react-native-webrtc'\nimport { SafeAreaView } from 'react-native-safe-area-context'",
  "import { SafeAreaView } from 'react-native-safe-area-context'\nimport { RTCView } from 'react-native-webrtc'",
)
callScreen = callScreen.replace(/streamURL=\{remoteStreamUrl!\}/g, "streamURL={remoteStreamUrl ?? ''}")
callScreen = callScreen.replace(/streamURL=\{localStreamUrl!\}/g, "streamURL={localStreamUrl ?? ''}")
fs.writeFileSync(callScreenPath, callScreen)

const pluginPath = 'plugins/withVeloraSystemCalls.js'
let plugin = fs.readFileSync(pluginPath, 'utf8')
plugin = plugin.replace(
  "const path = require('path')\nconst {",
  "const path = require('path')\n\nconst {",
)
fs.writeFileSync(pluginPath, plugin)

console.log('Generated video-call integration hardened successfully')

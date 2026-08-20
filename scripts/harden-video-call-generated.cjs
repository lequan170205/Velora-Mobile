const fs = require('node:fs')

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
  `      if (
        previousState !== 'active' &&
        cameraPausedByBackgroundRef.current &&
        callState.callType === 'VIDEO' &&
        callState.cameraEnabled &&
        localVideoTrack
      ) {
        localVideoTrack.enabled = true
        cameraPausedByBackgroundRef.current = false
      }`,
  `      if (
        previousState !== 'active' &&
        cameraPausedByBackgroundRef.current &&
        callState.callType === 'VIDEO' &&
        callState.cameraEnabled
      ) {
        if (localVideoTrack) {
          localVideoTrack.enabled = true
          cameraPausedByBackgroundRef.current = false
        } else {
          void activateLocalVideo({ requestPermission: false }).then((activated) => {
            if (activated) cameraPausedByBackgroundRef.current = false
          })
        }
      }`,
)
provider = provider.replace(
  '  }, [processPendingNativeCallAction])',
  '  }, [activateLocalVideo, processPendingNativeCallAction])',
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

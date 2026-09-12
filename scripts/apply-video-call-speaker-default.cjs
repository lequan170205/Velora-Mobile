const fs = require('node:fs')

const filePath = 'src/providers/CallProvider.tsx'
let source = fs.readFileSync(filePath, 'utf8')

const incomingBefore = `        if (!veloraSystemCalls.setCallActive(callId)) {\n          throw new Error('Native call is no longer active')\n        }\n        telemetry.record('control_plane_active', { outcome: 'succeeded' })`
const incomingAfter = `        if (!veloraSystemCalls.setCallActive(callId)) {\n          throw new Error('Native call is no longer active')\n        }\n        if (state.callType === 'VIDEO' && veloraSystemCalls.setSpeakerEnabled(true)) {\n          useCallStore.getState().patch({ speakerEnabled: true })\n        }\n        telemetry.record('control_plane_active', { outcome: 'succeeded' })`
if (!source.includes(incomingAfter)) {
  if (!source.includes(incomingBefore)) throw new Error('Missing incoming video speaker anchor')
  source = source.replace(incomingBefore, incomingAfter)
}

const outgoingBefore = `        if (!veloraSystemCalls.setCallActive(joined.callId)) {\n          throw new Error('Native call is no longer active')\n        }\n        telemetry.record('control_plane_active', { outcome: 'succeeded' })`
const outgoingAfter = `        if (!veloraSystemCalls.setCallActive(joined.callId)) {\n          throw new Error('Native call is no longer active')\n        }\n        if (callType === 'VIDEO' && veloraSystemCalls.setSpeakerEnabled(true)) {\n          useCallStore.getState().patch({ speakerEnabled: true })\n        }\n        telemetry.record('control_plane_active', { outcome: 'succeeded' })`
if (!source.includes(outgoingAfter)) {
  if (!source.includes(outgoingBefore)) throw new Error('Missing outgoing video speaker anchor')
  source = source.replace(outgoingBefore, outgoingAfter)
}

const conversionBefore = `        if (callType === 'VIDEO') {\n          const activated = await activateLocalVideo()\n          if (!activated) {\n            socket.emit('set_call_type', { callId: state.callId, callType: 'VOICE' })\n            presentError('Unable to start the camera')\n          }\n        } else {`
const conversionAfter = `        if (callType === 'VIDEO') {\n          const activated = await activateLocalVideo()\n          if (!activated) {\n            socket.emit('set_call_type', { callId: state.callId, callType: 'VOICE' })\n            presentError('Unable to start the camera')\n          } else if (veloraSystemCalls.setSpeakerEnabled(true)) {\n            useCallStore.getState().patch({ speakerEnabled: true })\n          }\n        } else {`
if (!source.includes(conversionAfter)) {
  if (!source.includes(conversionBefore)) throw new Error('Missing voice-to-video speaker anchor')
  source = source.replace(conversionBefore, conversionAfter)
}

fs.writeFileSync(filePath, source)
console.log('Configured active VIDEO calls to prefer speaker output')

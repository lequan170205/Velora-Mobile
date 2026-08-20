const fs = require('node:fs')

const screenPath = 'app/call/[id].tsx'
let screen = fs.readFileSync(screenPath, 'utf8')
screen = screen.replace("onPress={() => void acceptIncomingCall('ui')}", "onPress={() => void acceptIncomingCall()}")
screen = screen.replace(
  "  }, [durationSec, phase, remoteAudioState])",
  "  }, [callType, durationSec, phase, remoteAudioState])",
)
if (screen.includes("acceptIncomingCall('ui')")) throw new Error('Simulator answer still passes private source argument')
if (!screen.includes('[callType, durationSec, phase, remoteAudioState]')) throw new Error('Incoming status dependency was not finalized')
fs.writeFileSync(screenPath, screen)

const providerPath = 'src/providers/CallProvider.tsx'
let provider = fs.readFileSync(providerPath, 'utf8')
provider = provider.replace(
  "    [currentUserId, queryClient],\n  )\n\n  const prepareIncomingCallFromState",
  "    [currentUserId, queryClient, router],\n  )\n\n  const prepareIncomingCallFromState",
)
if (!provider.includes('[currentUserId, queryClient, router]')) throw new Error('Simulator incoming route dependency was not finalized')
fs.writeFileSync(providerPath, provider)

const testPath = 'tests/video-call-1to1-contract.test.cjs'
let test = fs.readFileSync(testPath, 'utf8')
test = test.replace("assert.ok(callScreen.includes(\"acceptIncomingCall('ui')\"))", "assert.ok(callScreen.includes('acceptIncomingCall()'))")
fs.writeFileSync(testPath, test)

console.log('Finalized iOS Simulator call lifecycle typing and hook dependencies')

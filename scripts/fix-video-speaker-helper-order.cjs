const fs = require('node:fs')

const providerPath = 'src/providers/CallProvider.tsx'
let source = fs.readFileSync(providerPath, 'utf8')

const innerHelper = `  const enableDefaultVideoSpeaker = useCallback((configuration?: AudioSessionConfiguration) => {\n    if (!shouldDefaultVideoToSpeaker(configuration)) return\n    if (veloraSystemCalls.setSpeakerEnabled(true)) {\n      useCallStore.getState().patch({ speakerEnabled: true })\n    }\n  }, [])\n\n`
source = source.replace(innerHelper, '')

if (!source.includes('const enableDefaultVideoSpeaker = (')) {
  const anchor = `const shouldDefaultVideoToSpeaker = (configuration: AudioSessionConfiguration | undefined) => {\n  const externalRoutePattern = /Bluetooth|Headphones|Headset|AirPlay|CarAudio|USB|LineOut|Wired/i\n  return !(configuration?.outputRouteTypes ?? []).some((routeType) =>\n    externalRoutePattern.test(routeType),\n  )\n}\n`
  if (!source.includes(anchor)) {
    throw new Error('Top-level video speaker helper anchor not found')
  }
  source = source.replace(
    anchor,
    `${anchor}\nconst enableDefaultVideoSpeaker = (configuration?: AudioSessionConfiguration) => {\n  if (!shouldDefaultVideoToSpeaker(configuration)) return\n  if (veloraSystemCalls.setSpeakerEnabled(true)) {\n    useCallStore.getState().patch({ speakerEnabled: true })\n  }\n}\n`,
  )
}

source = source.replace(/      enableDefaultVideoSpeaker,\n/g, '')

fs.writeFileSync(providerPath, source)
console.log('Moved default VIDEO speaker helper to stable top-level scope')

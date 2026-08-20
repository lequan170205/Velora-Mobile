const fs = require('node:fs')

const providerPath = 'src/providers/CallProvider.tsx'
let source = fs.readFileSync(providerPath, 'utf8')

const innerHelperStart = source.indexOf('  const enableDefaultVideoSpeaker = useCallback(')
if (innerHelperStart >= 0) {
  const toggleSpeakerStart = source.indexOf('  const toggleSpeaker = useCallback(', innerHelperStart)
  if (toggleSpeakerStart < 0) {
    throw new Error('Unable to bound duplicated default speaker helper')
  }
  source = `${source.slice(0, innerHelperStart)}${source.slice(toggleSpeakerStart)}`
}

const remoteDelete = `      remoteVideoEnabledByProducerRef.current.delete(payload.producerId)\n`
while (source.includes(`${remoteDelete}${remoteDelete}`)) {
  source = source.replace(`${remoteDelete}${remoteDelete}`, remoteDelete)
}

source = source.replace(/      enableDefaultVideoSpeaker,\n/g, '')

if ((source.match(/const enableDefaultVideoSpeaker =/g) ?? []).length !== 1) {
  throw new Error('Expected exactly one default VIDEO speaker helper')
}
if ((source.match(/remoteVideoEnabledByProducerRef\.current\.delete\(payload\.producerId\)/g) ?? []).length !== 1) {
  throw new Error('Expected exactly one remote video producer cleanup')
}

fs.writeFileSync(providerPath, source)
console.log('Removed generated CallProvider duplication while preserving video behavior')

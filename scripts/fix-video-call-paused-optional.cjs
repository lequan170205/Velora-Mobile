const fs = require('node:fs')

const filePath = 'src/providers/CallProvider.tsx'
let source = fs.readFileSync(filePath, 'utf8')
const before = '            paused: producer.paused,\n'
const after =
  '            ...(producer.paused !== undefined ? { paused: producer.paused } : {}),\n'

if (!source.includes(after)) {
  const matches = source.split(before).length - 1
  if (matches < 2) {
    throw new Error(`Expected at least two optional paused producer mappings, found ${matches}`)
  }
  source = source.split(before).join(after)
}

fs.writeFileSync(filePath, source)
console.log('Normalized optional producer paused state for exactOptionalPropertyTypes')

const fs = require('node:fs')

const replaceOnce = (source, before, after, label) => {
  if (!source.includes(before)) {
    if (after && source.includes(after)) return source
    throw new Error(`Hardening anchor not found: ${label}`)
  }
  return source.replace(before, after)
}

const providerPath = 'src/providers/CallProvider.tsx'
let provider = fs.readFileSync(providerPath, 'utf8')
provider = provider.replace(
  /\n      if \(payload\.callType === 'VIDEO'\) \{\n        socketRef\.current\?\.emit\('reject_call', \{\n          callId: payload\.callId,\n          reason: 'unsupported_video',\n        \}\)\n        presentError\('Video calls are not supported yet'\)\n        return\n      \}\n/g,
  '\n',
)
provider = provider.replace(/catch \{\}/g, "catch {\n        // Best-effort media cleanup; the native resource may already be closed.\n      }")
fs.writeFileSync(providerPath, provider)

const layoutPath = 'app/_layout.tsx'
let layout = fs.readFileSync(layoutPath, 'utf8')
layout = layout.replace("import { useQueryClient } from '@tanstack/react-query'\n", '')
layout = layout.replace("import { useEffect, useMemo, useState } from 'react'", "import { useEffect, useState } from 'react'")
layout = layout.replace("import { queryKeys } from '../src/constants/queryKeys'\n", '')
layout = layout.replace("\nimport type { Conversation } from '../src/types/conversation.types'\n", '\n')
const shortcutStart = layout.indexOf('const getConversationList =')
const bannerStart = layout.indexOf('function ActiveCallBanner()')
if (shortcutStart >= 0 && bannerStart > shortcutStart) {
  layout = layout.slice(0, shortcutStart) + layout.slice(bannerStart)
}
layout = layout.replace('      <ConversationVideoCallShortcut />\n', '')
fs.writeFileSync(layoutPath, layout)

console.log('Generated video-call integration hardened successfully')

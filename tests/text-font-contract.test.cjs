const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..')

// Text without a font falls back to Roboto on Android and SF on iOS instead of
// Inter, and a bare fontWeight on a single-weight custom family does the same
// on Android. Every text element must therefore name its font.
const FONT_CLASS = /\bfont-(sans|medium|semibold|bold|display|heading)\b/
const TEXT_TAG =
  /<(Text|AppText|Animated\.Text)\b((?:[^>{]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*)>/g
const OPEN_TAG = /<(?:Text|AppText|Animated\.Text)\b(?:[^>{]|\{(?:[^{}]|\{[^{}]*\})*\})*(?<!\/)>/g
const CLOSE_TAG = /<\/(?:Text|AppText|Animated\.Text)>/g

const listTsx = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return listTsx(fullPath)
    return entry.name.endsWith('.tsx') ? [fullPath] : []
  })

const literalClassParts = (attrs) => {
  const match = attrs.match(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{cn\(([^)]*)\)\})/)
  if (!match) return null
  if (match[1] !== undefined) return [match[1]]
  if (match[2] !== undefined) return [match[2].replace(/\$\{[^}]*\}/g, ' ')]
  return [...match[3].matchAll(/'([^']*)'|"([^"]*)"/g)].map((part) => part[1] ?? part[2])
}

const findUnfontedText = (source) => {
  const violations = []

  for (const match of source.matchAll(TEXT_TAG)) {
    const attrs = match[2]
    if (FONT_CLASS.test(attrs) || attrs.includes('fontFamily')) continue

    const before = source.slice(0, match.index)
    const isNested = (before.match(OPEN_TAG) ?? []).length > (before.match(CLOSE_TAG) ?? []).length
    if (isNested) continue

    const children = source.slice(match.index + match[0].length).split('<')[0]
    if (/emoji/i.test(children)) continue

    const inlineStyle = attrs.match(/style=\{\{([^]*?)\}\}/)
    const classParts = literalClassParts(attrs)
    const hasOpaqueStyle = /style=\{(?!\{)/.test(attrs) && !inlineStyle
    const hasOnlyOpaqueClass = /className=/.test(attrs) && (!classParts || classParts.length === 0)
    // StyleSheet references and computed class names cannot be resolved here.
    if (hasOpaqueStyle || hasOnlyOpaqueClass) continue

    violations.push(source.slice(0, match.index).split('\n').length)
  }

  return violations
}

test('every text element names an Inter or Space Grotesk font', () => {
  const offenders = [
    ...listTsx(path.join(root, 'app')),
    ...listTsx(path.join(root, 'src')),
  ].flatMap((file) =>
    findUnfontedText(fs.readFileSync(file, 'utf8')).map(
      (line) => `${path.relative(root, file)}:${line}`,
    ),
  )

  assert.deepEqual(offenders, [], `Add a font-* class or fontFamily to:\n${offenders.join('\n')}`)
})

test('the font guard flags unfonted text and accepts the allowed exceptions', () => {
  assert.equal(findUnfontedText('<Text className="text-sm text-text-muted">Hi</Text>').length, 1)
  assert.equal(
    findUnfontedText("<AppText style={{ color: 'red', fontWeight: '700' }}>Hi</AppText>").length,
    1,
  )
  assert.equal(findUnfontedText("<Text className={cn('mt-1 text-sm2', tone)}>Hi</Text>").length, 1)

  assert.equal(findUnfontedText('<Text className="font-sans text-sm">Hi</Text>').length, 0)
  assert.equal(
    findUnfontedText('<Text style={{ fontFamily: typography.fonts.body }}>Hi</Text>').length,
    0,
  )
  assert.equal(
    findUnfontedText(
      '<Text className="font-semibold">Hi <Text className="text-brand">there</Text></Text>',
    ).length,
    0,
  )
  assert.equal(findUnfontedText('<Text className="text-xl">{reaction.emoji}</Text>').length, 0)
  assert.equal(findUnfontedText('<Text style={styles.label}>Hi</Text>').length, 0)
})

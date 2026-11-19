const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const listSourceFiles = (dir) =>
  fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name)
    if (entry.isDirectory()) return listSourceFiles(relative)
    return /\.(ts|tsx)$/.test(entry.name) ? [relative] : []
  })

test('only the shared options define a fetcher for the conversation list query', () => {
  // Any observer that registers its own queryFn on this key overwrites the query's fetcher on every
  // render. A placeholder fetcher (resolving null) then fed `null` into the cache on the next
  // invalidate/refetch, which crashed the reel share sheet with "Cannot read property 'flatMap' of null".
  const offenders = [...listSourceFiles('src'), ...listSourceFiles('app')].filter((file) => {
    if (file === path.join('src', 'hooks', 'useConversations.ts')) return false
    const source = read(file)
    return /queryKey:\s*queryKeys\.conversations\.all,\s*\n\s*queryFn:/.test(source)
  })

  assert.deepEqual(offenders, [])
})

test('conversation metadata observes the list through the shared query options', () => {
  const source = read('src/hooks/conversation/useConversationMetadata.ts')

  assert.match(source, /\.\.\.getConversationsQueryOptions\(\)/)
  assert.match(source, /enabled: false/)
  assert.doesNotMatch(source, /queryFn:/)
})

test('a disabled observer with a null fetcher poisons the list; one with the real fetcher does not', async () => {
  const queryCorePath = require.resolve('@tanstack/query-core', {
    paths: [path.dirname(require.resolve('@tanstack/react-query/package.json'))],
  })
  const { QueryClient, QueryObserver } = await import(
    require('node:url').pathToFileURL(queryCorePath).href
  )
  const key = ['conversations']
  const realFetch = () => Promise.resolve([{ id: 'conversation-1' }])

  const run = async (metadataFetcher) => {
    const client = new QueryClient()
    const list = new QueryObserver(client, { queryKey: key, queryFn: realFetch, staleTime: 0 })
    const unsubscribeList = list.subscribe(() => {})
    await client.fetchQuery({ queryKey: key, queryFn: realFetch })

    const metadata = new QueryObserver(client, {
      queryKey: key,
      queryFn: metadataFetcher,
      enabled: false,
    })
    const unsubscribeMetadata = metadata.subscribe(() => {})
    await client.invalidateQueries({ queryKey: key })
    const data = client.getQueryData(key)
    unsubscribeMetadata()
    unsubscribeList()
    return data
  }

  assert.equal(await run(() => Promise.resolve(null)), null)
  assert.deepEqual(await run(realFetch), [{ id: 'conversation-1' }])
})

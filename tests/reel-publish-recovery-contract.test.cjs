const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const loadTypeScriptModule = (relativePath, mocks) => {
  const filePath = path.join(root, relativePath)
  const compiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
    },
    fileName: filePath,
  }).outputText
  const loadedModule = { exports: {} }
  const localRequire = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier]
    if (mocks.__fallback) return mocks.__fallback(specifier)
    return require(specifier)
  }
  new Function('require', 'module', 'exports', compiled)(
    localRequire,
    loadedModule,
    loadedModule.exports,
  )
  return loadedModule.exports
}

const createStorage = () => {
  const values = new Map()
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => values.set(key, value),
    removeItem: async (key) => values.delete(key),
    values,
  }
}

test('publish operation persistence keeps one intent and completed checkpoints across reloads', async () => {
  const storage = createStorage()
  const first = loadTypeScriptModule('src/lib/reelPublishPersistence.ts', {
    '@react-native-async-storage/async-storage': storage,
  })
  const payload = {
    title: 'same reel',
    description: 'caption',
    tags: ['velora'],
    visibility: 'private',
    clientObservedDurationMs: 4000,
    edit: { framing: 'fit' },
  }
  const source = {
    uri: 'file:///managed/source.mp4',
    fileName: 'source.mp4',
    mimeType: 'video/mp4',
  }
  const operation = first.createReelPublishOperation({
    deviceId: 'device-1',
    payload,
    publishIntentId: 'intent-1',
    source,
    userId: 'owner-1',
  })

  await first.saveReelPublishOperation({
    ...operation,
    completedSteps: ['source_prepared', 'media_uploaded'],
    mediaKey: 'reels/owner-1/intent-1.mp4',
    uploadedAt: Date.now(),
  })

  const second = loadTypeScriptModule('src/lib/reelPublishPersistence.ts', {
    '@react-native-async-storage/async-storage': storage,
  })
  const restored = await second.getPendingReelPublishOperation('owner-1')
  assert.equal(restored.publishIntentId, 'intent-1')
  assert.equal(restored.mediaKey, 'reels/owner-1/intent-1.mp4')
  assert.deepEqual(restored.completedSteps, ['source_prepared', 'media_uploaded'])
  assert.equal(second.isReelPublishPayloadCompatible(restored, payload, source.uri), true)

  await second.cancelReelPublishOperation('owner-1', 'intent-1')
  assert.equal(await second.getPendingReelPublishOperation('owner-1'), null)
  const retainedCancelled = await second.listReelPublishOperations('owner-1')
  assert.equal(retainedCancelled[0].state, 'cancelled')
})

test('different intentional publishes retain different intents without deduplication', async () => {
  const storage = createStorage()
  const persistence = loadTypeScriptModule('src/lib/reelPublishPersistence.ts', {
    '@react-native-async-storage/async-storage': storage,
  })
  const base = {
    deviceId: 'device-1',
    payload: {
      title: 'same',
      description: '',
      tags: [],
      visibility: 'public',
      edit: { framing: 'fit' },
    },
    source: { uri: 'file:///managed/source.mp4', fileName: 'source.mp4', mimeType: 'video/mp4' },
    userId: 'owner-1',
  }

  await persistence.saveReelPublishOperation(
    persistence.createReelPublishOperation({ ...base, publishIntentId: 'intent-a' }),
  )
  await persistence.saveReelPublishOperation(
    persistence.createReelPublishOperation({ ...base, publishIntentId: 'intent-b' }),
  )

  const operations = await persistence.listReelPublishOperations('owner-1')
  assert.deepEqual(operations.map((operation) => operation.publishIntentId).sort(), [
    'intent-a',
    'intent-b',
  ])
})

test('corrupted publish storage fails closed without creating a new intent', async () => {
  const storage = createStorage()
  const persistence = loadTypeScriptModule('src/lib/reelPublishPersistence.ts', {
    '@react-native-async-storage/async-storage': storage,
  })
  await storage.setItem('velora.reels.publish-operations:owner-1', '{not-json')

  await assert.rejects(
    () => persistence.getPendingReelPublishOperation('owner-1'),
    (error) => error.name === 'ReelPublishStorageError' && error.recoverable === true,
  )
  assert.equal(await storage.getItem('velora.reels.publish-operations:owner-1'), '{not-json')
  await assert.rejects(() => persistence.listReelPublishOperations('owner-1'))
})

test('upload DTO, 412 acknowledgement, source-miss recovery, and bounded fallback helpers are executable', () => {
  const recovery = loadTypeScriptModule('src/lib/reelPublishRecovery.ts', {})
  assert.deepEqual(
    recovery.buildReelUploadRequest({ fileType: 'video/mp4', publishIntentId: 'intent-1' }),
    { fileType: 'video/mp4', purpose: 'reel', publishIntentId: 'intent-1' },
  )
  assert.equal(recovery.isUploadAlreadyPresentStatus(412), true)
  assert.equal(recovery.isUploadAlreadyPresentStatus(200), false)
  assert.equal(
    recovery.shouldReuploadAfterCreateSourceMiss({
      alreadyUploaded: true,
      canonicalReelFound: false,
      error: { response: { status: 404, data: { message: 'media source missing' } } },
    }),
    true,
  )
  assert.equal(
    recovery.shouldReuploadAfterCreateSourceMiss({
      alreadyUploaded: true,
      canonicalReelFound: true,
      error: { response: { status: 404, data: { message: 'media source missing' } } },
    }),
    false,
  )
  const attempts = recovery.createPlaybackCandidateAttempts()
  assert.equal(recovery.tryPlaybackCandidate(attempts, 'remote'), true)
  assert.equal(recovery.tryPlaybackCandidate(attempts, 'remote'), false)
})

test('local playback resolves only for the authenticated owner and current device', async () => {
  const storage = createStorage()
  const files = new Map([['file:///picked/source.mp4', 'video']])
  const fileSystem = {
    documentDirectory: 'file:///document/',
    makeDirectoryAsync: async () => undefined,
    getInfoAsync: async (uri) => ({ exists: files.has(uri) }),
    copyAsync: async ({ from, to }) => files.set(to, files.get(from)),
    moveAsync: async ({ from, to }) => {
      files.set(to, files.get(from))
      files.delete(from)
    },
    deleteAsync: async (uri) => files.delete(uri),
  }
  const local = loadTypeScriptModule('src/lib/localReelPlayback.ts', {
    '@react-native-async-storage/async-storage': storage,
    'expo-file-system/legacy': fileSystem,
    './notifications/pushTokenOperationState': {
      getOrCreatePushTokenInstallationId: async () => 'device-1',
    },
  })
  local.beginLocalReelPlaybackAuthBoundary('owner-1')

  const prepared = await local.prepareLocalReelSource({
    ownerId: 'owner-1',
    publishIntentId: 'intent-1',
    source: { uri: 'file:///picked/source.mp4', fileName: 'source.mp4', mimeType: 'video/mp4' },
  })
  await local.commitLocalReelPlayback({
    localUri: prepared.localUri,
    ownerId: 'owner-1',
    publishIntentId: 'intent-1',
    reelId: 'reel-1',
    sourceWidth: 1080,
    sourceHeight: 1920,
  })

  assert.ok(
    await local.resolveAuthorizedLocalReelPlayback({ id: 'reel-1', userId: 'owner-1' }, 'owner-1'),
  )
  assert.equal(
    await local.resolveAuthorizedLocalReelPlayback(
      { id: 'reel-1', userId: 'owner-1' },
      'other-user',
    ),
    null,
  )
  local.beginLocalReelPlaybackAuthBoundary(null)
  assert.equal(
    await local.resolveAuthorizedLocalReelPlayback({ id: 'reel-1', userId: 'owner-1' }, 'owner-1'),
    null,
  )
})

test('creator and playback sources include idempotent checkpoints, owner gating, and stale callback guards', () => {
  const creator = read('src/hooks/useReelCreator.ts')
  const createHook = read('src/hooks/useReels.ts')
  const reelApi = read('src/api/reels.api.ts')
  const reelTypes = read('src/types/reel.types.ts')
  const localPlayback = read('src/lib/localReelPlayback.ts')
  const offlineHook = read('src/hooks/useOfflineReelVideoSource.ts')
  const reelFeedItem = read('src/components/reels/ReelFeedItem.tsx')
  const processing = read('src/lib/reelProcessing.ts')
  const reelsHook = read('src/hooks/useReels.ts')
  const trimmedVideo = read('src/components/reels/create/trimmed-reel-video.tsx')

  assert.match(creator, /publishLockRef/)
  assert.match(creator, /createPublishIntentId\(\)/)
  assert.match(creator, /from 'expo-crypto'/)
  assert.match(creator, /saveReelPublishOperation\(/)
  assert.match(creator, /commitLocalReelPlayback\(/)
  assert.match(creator, /cancelReelPublishOperation\(/)
  assert.match(createHook, /publishIntentId/)
  assert.match(createHook, /completedStep: 'media_uploaded'/)
  assert.match(createHook, /completedStep: 'reel_created'/)
  assert.match(createHook, /upload.key !== key/)
  assert.doesNotMatch(reelApi, /getCanonicalReelFromPublishConflict/)
  assert.match(reelTypes, /publishIntentId: string/)
  assert.match(localPlayback, /record\.ownerId !== ownerId/)
  assert.match(localPlayback, /record\.deviceId !== deviceId/)
  assert.match(offlineHook, /resolveAuthorizedLocalReelPlayback/)
  assert.match(reelFeedItem, /isCurrentReelPlayerCallback/)
  assert.match(reelFeedItem, /seekRelativeToTrim=\{Boolean\(localPlaybackEdit\?\.trim\)\}/)
  assert.match(reelFeedItem, /trim\.startMs \/ 1000/)
  assert.match(reelFeedItem, /TrimmedReelVideo/)
  assert.match(reelFeedItem, /CommittedCropPreview/)
  assert.match(trimmedVideo, /seekRelativeToTrim/)
  assert.match(processing, /export const isRemoteReelPlaybackReady/)
  assert.doesNotMatch(reelsHook, /releaseAuthorizedLocalReelPlayback\(viewerId, nextReel\.id\)/)
})

const publishHarness = ({ create, update, uploadStatus = 200 } = {}) => {
  const auth = { isAuthenticated: true, user: { id: 'owner-1' } }
  const calls = { puts: [], presigns: [], creates: [], updates: [], checkpoints: [] }
  const store = Object.assign((selector) => selector(auth), { getState: () => auth })
  const queryClient = { setQueryData: () => undefined }
  const canonical = { id: 'reel-1', userId: 'owner-1', visibility: 'public', tags: [] }
  const recovery = loadTypeScriptModule('src/lib/reelPublishRecovery.ts', {})
  const loaded = loadTypeScriptModule('src/hooks/useReels.ts', {
    __fallback: () => ({}),
    react: { useState: () => ['idle', () => undefined] },
    '@tanstack/react-query': {
      useQueryClient: () => queryClient,
      useMutation: (options) => options,
    },
    '../stores/authStore': { useAuthStore: store },
    '../constants/queryKeys': {
      queryKeys: { reels: { detail: () => [], pendingCreated: () => [] } },
    },
    '../lib/localReelPlayback': { getLocalReelPlaybackAuthGeneration: () => 1 },
    '../lib/reelPublishRecovery': recovery,
    '../api/media.api': {
      mediaApi: {
        getReelUploadUrl: async (request) => {
          calls.presigns.push(request)
          return {
            key: 'reels/owner-1/intent-1.mp4',
            uploadUrl: 'https://upload.test',
            expiresIn: 300,
          }
        },
      },
    },
    '../api/reels.api': {
      reelsApi: {
        create: async (request) => {
          calls.creates.push(request)
          return create ? create(request, auth) : canonical
        },
        update: async (id, data) => {
          calls.updates.push({ id, data })
          return update ? update(id, data) : { ...canonical, ...data }
        },
      },
    },
    'expo-file-system/legacy': {
      FileSystemUploadType: { BINARY_CONTENT: 0 },
      uploadAsync: async (...args) => {
        calls.puts.push(args)
        return { status: uploadStatus }
      },
    },
  })
  return {
    auth,
    calls,
    mutation: loaded.useCreateReel(),
    canonical,
    variables: {
      fileUri: 'file:///source.mp4',
      fileType: 'video/mp4',
      publishIntentId: 'intent-1',
      title: 'Reel',
      tags: [],
      visibility: 'public',
      edit: { framing: 'fit' },
      onCheckpoint: async (checkpoint) => calls.checkpoints.push(checkpoint),
    },
  }
}

test('a lost create response reuses the completed upload and logical intent', async () => {
  let first = true
  const harness = publishHarness({
    create: () => {
      if (first) {
        first = false
        throw new Error('response lost after commit')
      }
      return { id: 'reel-1', userId: 'owner-1', visibility: 'public' }
    },
  })
  await assert.rejects(harness.mutation.mutationFn(harness.variables), /response lost/)
  const uploaded = harness.calls.checkpoints.find((step) => step.completedStep === 'media_uploaded')
  const result = await harness.mutation.mutationFn({
    ...harness.variables,
    mediaKey: uploaded.mediaKey,
    alreadyUploaded: true,
  })
  assert.equal(result.id, 'reel-1')
  assert.equal(harness.calls.puts.length, 1)
  assert.equal(harness.calls.presigns.length, 1)
  assert.ok(harness.calls.creates.every((request) => request.publishIntentId === 'intent-1'))
  assert.equal(harness.calls.presigns[0].purpose, 'reel')
  assert.equal(harness.calls.puts[0][2].headers['If-None-Match'], '*')
})

test('412 upload acknowledgement and visibility recovery never create another Reel', async () => {
  let first = true
  const harness = publishHarness({
    uploadStatus: 412,
    create: () => ({ id: 'reel-1', userId: 'owner-1', visibility: 'private' }),
    update: () => {
      if (first) {
        first = false
        throw new Error('visibility network error')
      }
      return { id: 'reel-1', userId: 'owner-1', visibility: 'public' }
    },
  })
  await assert.rejects(harness.mutation.mutationFn(harness.variables), /visibility was not updated/)
  const created = harness.calls.checkpoints.find((step) => step.completedStep === 'reel_created')
  assert.equal(created.reelId, 'reel-1')
  await harness.mutation.mutationFn({
    ...harness.variables,
    mediaKey: created.mediaKey,
    alreadyUploaded: true,
    existingReel: created.canonicalReel,
  })
  assert.equal(harness.calls.creates.length, 1)
  assert.equal(harness.calls.puts.length, 1)
  assert.equal(harness.calls.updates.length, 2)
})

test('an account switch during create rejects the stale acknowledgement before preview or cache', async () => {
  const harness = publishHarness({
    create: (_request, auth) => {
      auth.user = { id: 'owner-2' }
      return { id: 'reel-1', userId: 'owner-1', visibility: 'public' }
    },
  })
  await assert.rejects(harness.mutation.mutationFn(harness.variables), /account changed/)
  assert.equal(
    harness.calls.checkpoints.some((step) => step.completedStep === 'reel_created'),
    false,
  )
})

test('a published trim applies the source offset exactly once and keeps a queued handoff seek', () => {
  const seeks = []
  const effects = []
  const native = { seekTo: (seconds) => seeks.push(seconds) }
  let firstRef = true
  const react = {
    forwardRef: (render) => render,
    useCallback: (fn) => fn,
    useRef: (initial) => {
      if (firstRef) {
        firstRef = false
        return { current: native }
      }
      return { current: initial }
    },
    useImperativeHandle: (ref, factory) => {
      ref.current = factory()
    },
    useEffect: (fn) => effects.push(fn),
    createElement: (_type, props) => props,
  }
  const loaded = loadTypeScriptModule('src/components/reels/create/trimmed-reel-video.tsx', {
    react,
    '../ReelVideo': { ReelVideo: () => null },
    '../../../lib/reel-trim-geometry': {},
  })
  const ref = { current: null }
  loaded.TrimmedReelVideo(
    {
      uri: 'file:///clip.mp4',
      playbackRange: { startMs: 2000, endMs: 6000 },
      seekRelativeToTrim: true,
    },
    ref,
  )
  ref.current.seekTo(1)
  effects.forEach((effect) => effect())
  assert.deepEqual(seeks, [3])
  ref.current.seekTo(99)
  assert.equal(seeks.at(-1), 6)
})

test('an interrupted retained copy is not published as complete and can resume safely', async () => {
  const storage = createStorage()
  const files = new Map([['file:///picked/source.mp4', 'complete video']])
  let interrupt = true
  const fileSystem = {
    documentDirectory: 'file:///document/',
    makeDirectoryAsync: async () => undefined,
    getInfoAsync: async (uri) => ({ exists: files.has(uri), size: files.get(uri)?.length }),
    copyAsync: async ({ from, to }) => {
      files.set(to, interrupt ? 'partial' : files.get(from))
      if (interrupt) throw new Error('interrupted')
    },
    moveAsync: async ({ from, to }) => {
      files.set(to, files.get(from))
      files.delete(from)
    },
    deleteAsync: async (uri) => files.delete(uri),
  }
  const local = loadTypeScriptModule('src/lib/localReelPlayback.ts', {
    '@react-native-async-storage/async-storage': storage,
    'expo-file-system/legacy': fileSystem,
    './notifications/pushTokenOperationState': {
      getOrCreatePushTokenInstallationId: async () => 'device-1',
    },
  })
  local.beginLocalReelPlaybackAuthBoundary('owner-1')
  const input = {
    ownerId: 'owner-1',
    publishIntentId: 'intent-1',
    source: { uri: 'file:///picked/source.mp4' },
  }
  await assert.rejects(local.prepareLocalReelSource(input), /interrupted/)
  assert.equal(
    [...files.keys()].some((uri) => uri.includes('publish-intent-1/source')),
    false,
  )
  interrupt = false
  const result = await local.prepareLocalReelSource(input)
  assert.equal(files.get(result.localUri), 'complete video')
})

test('legacy cached original URLs never become validated remote HLS sources', () => {
  const processing = loadTypeScriptModule('src/lib/reelProcessing.ts', {})
  const original = { id: 'reel', userId: 'owner', status: 'COMPLETED', mediaStatus: 'COMPLETED',
    indexStatus: 'PROCESSING', streamUrl: 'https://cdn.example/reels/original.mp4' }
  assert.equal(processing.isReelPlayable(original), false)
  assert.equal(processing.isRemoteReelPlaybackReady(original), false)
  const normalized = processing.normalizeReelApiResponse(original)
  assert.equal(normalized.streamUrl, '')
  assert.equal(normalized.hlsMasterUrl, undefined)
  assert.equal(processing.normalizeReelProcessingStatusResponse({ ...original, reelId: 'reel' }).streamUrl, '')
  const hls = { ...original, streamUrl: 'https://cdn.example/reels/master.m3u8?token=signed' }
  assert.equal(processing.isRemoteReelPlaybackReady(hls), true)
  assert.equal(processing.isReelPlayable(hls), true)
  assert.equal(processing.isRemoteReelPlaybackReady({ ...hls, mediaStatus: 'PENDING' }), false)
  assert.equal(processing.isRemoteReelPlaybackReady({ ...hls, streamUrl: 'file:///private/master.m3u8' }), false)
  assert.equal(processing.normalizeReelApiResponse({ ...hls, mediaStatus: 'PENDING' }).streamUrl, '')
})

test('source resolver rejects previous Reel local state and original-media cache on initial render', () => {
  const processing = loadTypeScriptModule('src/lib/reelProcessing.ts', {})
  let stateIndex = 0
  const oldPreview = { reelId: 'old-reel', ownerId: 'owner', localUri: 'file:///old.mp4' }
  const hook = loadTypeScriptModule('src/hooks/useOfflineReelVideoSource.ts', {
    react: {
      useEffect: () => undefined, useMemo: (fn) => fn(),
      useState: (initializer) => [stateIndex++ === 1 ? oldPreview : initializer(), () => undefined],
    },
    '../lib/localReelPlayback': {
      getSyncAuthorizedLocalReelPlayback: () => oldPreview,
      resolveAuthorizedLocalReelPlayback: async () => null,
    },
    '../lib/offlineReelVideoCache': {
      getSyncCachedTemporaryReelVideo: () => null,
      isHlsReelUrl: processing.isHlsReelUrl,
    },
    '../lib/reelProcessing': processing,
    '../providers/NetworkProvider': { useNetworkStatus: () => ({ isOnline: true }) },
    '../stores/authStore': { useAuthStore: (select) => select({ isAuthenticated: true, user: { id: 'owner' } }) },
  })
  const resolved = hook.useOfflineReelVideoSource({ id: 'new-reel', userId: 'owner', status: 'COMPLETED',
    mediaStatus: 'COMPLETED', streamUrl: 'https://cdn.example/original.mp4' })
  assert.equal(resolved.localVideoUri, null)
  assert.equal(resolved.isLocalVideoActive, false)
  assert.equal(resolved.isRemotePlaybackReady, false)
  assert.equal(resolved.uri, '')
})

test('expired publish and created Series checkpoints survive restart without new identities', async () => {
  const storage = createStorage()
  const persistence = loadTypeScriptModule('src/lib/reelPublishPersistence.ts', {
    '@react-native-async-storage/async-storage': storage,
  })
  const operation = persistence.createReelPublishOperation({ userId: 'owner', deviceId: 'device',
    publishIntentId: 'original-intent', payload: { visibility: 'public' },
    source: { uri: 'file:///retained/source.mp4' } })
  await persistence.saveReelPublishOperation({ ...operation, createdSeriesId: 'created-series',
    requiresCancellation: true, reelId: 'canonical-reel' })
  const reloaded = loadTypeScriptModule('src/lib/reelPublishPersistence.ts', {
    '@react-native-async-storage/async-storage': storage,
  })
  const restored = await reloaded.getPendingReelPublishOperation('owner')
  assert.equal(restored.publishIntentId, 'original-intent')
  assert.equal(restored.createdSeriesId, 'created-series')
  assert.equal(restored.reelId, 'canonical-reel')
  assert.equal(restored.requiresCancellation, true)
  const hook = read('src/hooks/useReelCreator.ts')
  assert.match(hook, /!operation \|\|\s*operation\.requiresCancellation \|\|/)
  assert.doesNotMatch(hook, /delete operationWithoutSeries\.createdSeriesId/)
})

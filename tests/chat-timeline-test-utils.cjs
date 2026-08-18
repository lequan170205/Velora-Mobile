const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')

const ts = require('typescript')

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key)

const loadTypeScriptModule = ({ filename, mocks = {} }) => {
  const source = fs.readFileSync(filename, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText

  const loadedModule = new Module(filename, module)
  loadedModule.filename = filename
  loadedModule.paths = Module._nodeModulePaths(path.dirname(filename))

  const originalLoad = Module._load
  Module._load = function loadWithMocks(request, parent, isMain) {
    if (hasOwn(mocks, request)) {
      return mocks[request]
    }

    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    loadedModule._compile(compiled, filename)
    return loadedModule.exports
  } finally {
    Module._load = originalLoad
  }
}

const createDeferred = () => {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, reject, resolve }
}

const makeMessage = (number, conversationId = 'conversation-1') => {
  const padded = String(number).padStart(3, '0')
  const timestamp = new Date(Date.UTC(2026, 0, 1, 0, number, 0)).toISOString()

  return {
    id: `m${padded}`,
    conversationId,
    senderId: number % 2 === 0 ? 'user-a' : 'user-b',
    sender: { id: number % 2 === 0 ? 'user-a' : 'user-b' },
    content: `message-${padded}`,
    type: 'text',
    status: 'SENT',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

const makeDescendingPage = (newestNumber, count, conversationId = 'conversation-1') =>
  Array.from({ length: count }, (_, index) =>
    makeMessage(newestNumber - index, conversationId),
  )

const mergeNewestFirst = (existing, incoming) => {
  const byId = new Map()

  for (const message of [...existing, ...incoming]) {
    byId.set(message.clientMessageId ?? message.id ?? message._id, message)
  }

  return [...byId.values()].sort((left, right) => {
    const createdAtDelta = Date.parse(right.createdAt) - Date.parse(left.createdAt)
    if (createdAtDelta !== 0) return createdAtDelta
    return String(right.id ?? '').localeCompare(String(left.id ?? ''))
  })
}

const waitForMicrotasks = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

module.exports = {
  createDeferred,
  loadTypeScriptModule,
  makeDescendingPage,
  makeMessage,
  mergeNewestFirst,
  waitForMicrotasks,
}

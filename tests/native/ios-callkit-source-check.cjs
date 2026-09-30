// Runs production Swift bodies with injected CallKit/observer boundaries, not a device.
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

test('iOS end failure and cold-start persistence execute the production Swift logic', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../modules/velora-system-calls/ios/VeloraSystemCallsModule.swift'),
    'utf8',
  )
  // Class members have two-space indentation; the next member ends this body.
  const member = (marker) => {
    const start = source.indexOf(`\n  ${marker}`)
    assert.notEqual(start, -1, marker)
    const end = source.indexOf('\n  }', start)
    assert.notEqual(end, -1, marker)
    return source.slice(start, end + 4)
  }
  const bodies = [
    'func endCall(callId:',
    'private func rememberLocalTerminalCall(',
    'private func storeRemoteCallStateUpdate(',
    'private func shouldReplaceRemoteCallStateUpdate(',
    'private func restoreRemoteCallStateUpdates(',
    'private func pruneRemoteCallStateUpdates(',
    'private func persistRemoteCallStateUpdates(',
    'private func validateCallStateUpdateLifecycleRevision(',
    'private func parseIso8601Date(',
    'private func nonEmptyString(',
    'private func isoTimestamp(',
  ]
    .map(member)
    .join('\n')
  const fixture = `
import Foundation
private let remoteCallStateUpdatesStorageKey = "remote-state"
private let remoteCallStateUpdateRetention: TimeInterval = 24 * 60 * 60
private struct CallOperationTiming {}
private struct PendingCallStateUpdate {
  let status: String
  let reason: String?
  let endedAt: Date
  var lifecycleRevision: Int? = nil
}
private struct CXEndCallAction { init(call: UUID) {} }
private struct CXTransaction { init(action: CXEndCallAction) {} }
private enum CXCallEndedReason { case failed }
private final class Controller {
  var error: Error? = NSError(domain: "injected", code: 1)
  var requests = 0
  func request(_ transaction: CXTransaction, completion: (Error?) -> Void) {
    requests += 1
    completion(error)
  }
}
private final class Provider {
  var ended = [UUID]()
  func reportCall(with uuid: UUID, endedAt: Date, reason: CXCallEndedReason) { ended.append(uuid) }
}
private final class Harness {
  let userDefaults: UserDefaults
  let callController = Controller()
  let provider = Provider()
  var uuidsByCallId = [String: UUID]()
  var programmaticEndingCallIds = Set<String>()
  var remoteCallStateUpdatesByCallId = [String: PendingCallStateUpdate]()
  var observerMissing = false
  init(_ defaults: UserDefaults) { userDefaults = defaults }
  func clearCall(callId: String) {
    uuidsByCallId.removeValue(forKey: callId)
    programmaticEndingCallIds.remove(callId)
  }
  func clearCallIfObserverConfirmsMissing(callId: String, uuid: UUID) -> Bool {
    if observerMissing { clearCall(callId: callId) }
    return observerMissing
  }
  func logPhaseEvent(layer: String, event: String, callId: String, callUuid: UUID? = nil,
                    success: Bool, errorCode: String? = nil, errorMessage: String? = nil,
                    elapsedMs: Int) {}
  func callKitErrorCode(_ error: Error, fallback: String) -> String { fallback }
  func sanitizedErrorMessage(_ error: Error, fallback: String) -> String { fallback }
  func elapsedMilliseconds(since: CallOperationTiming) -> Int { 0 }
  func makeCallResult(success: Bool, callId: String, callUuid: UUID? = nil,
                      errorCode: String? = nil, errorMessage: String? = nil) -> [String: Any] {
    ["success": success, "errorCode": errorCode ?? ""]
  }
  ${bodies}
  func check() {
    let callId = "mapped"
    let uuid = UUID()
    uuidsByCallId[callId] = uuid
    var results = [[String: Any]]()
    endCall(callId: callId) { results.append($0) }
    assert(results.count == 1 && results[0]["success"] as? Bool == false)
    assert(provider.ended == [uuid] && uuidsByCallId[callId] == nil)
    assert(!programmaticEndingCallIds.contains(callId))
    assert((userDefaults.dictionary(forKey: remoteCallStateUpdatesStorageKey)?[callId]
      as? [String: String])?["status"] == "ended")

    // Observer already confirms disappearance: no duplicate provider report.
    observerMissing = true
    uuidsByCallId["missing-in-observer"] = UUID()
    endCall(callId: "missing-in-observer") { results.append($0) }
    assert(provider.ended.count == 1 && uuidsByCallId["missing-in-observer"] == nil)

    // Cold JS terminal arrives before PushKit has allocated a UUID.
    let requestsBefore = callController.requests
    endCall(callId: "before-push") { results.append($0) }
    assert(callController.requests == requestsBefore)
    assert(results.last?["errorCode"] as? String == "call_not_found")
    let restored = Harness(userDefaults)
    restored.restoreRemoteCallStateUpdates()
    assert(restored.remoteCallStateUpdatesByCallId["before-push"]?.status == "ended")
    assert(!restored.storeRemoteCallStateUpdate(callId: "before-push",
      update: PendingCallStateUpdate(status: "active", reason: nil,
        endedAt: Date().addingTimeInterval(60), lifecycleRevision: 99)))
    assert(restored.remoteCallStateUpdatesByCallId["before-push"]?.status == "ended")
    assert(restored.storeRemoteCallStateUpdate(callId: "ordered",
      update: PendingCallStateUpdate(status: "ended", reason: nil, endedAt: Date(), lifecycleRevision: 4)))
    assert(!restored.storeRemoteCallStateUpdate(callId: "ordered",
      update: PendingCallStateUpdate(status: "ended", reason: nil,
        endedAt: Date().addingTimeInterval(60), lifecycleRevision: 3)))
    assert(!restored.validateCallStateUpdateLifecycleRevision(["lifecycleRevision": true]).accepted)
    assert(!restored.validateCallStateUpdateLifecycleRevision(["lifecycleRevision": "01"]).accepted)
    assert(restored.validateCallStateUpdateLifecycleRevision(["lifecycleRevision": "4"]).lifecycleRevision == 4)

    // Successful request still reports success exactly once.
    callController.error = nil
    uuidsByCallId["successful"] = UUID()
    let resultCount = results.count
    endCall(callId: "successful") { results.append($0) }
    assert(results.count == resultCount + 1 && results.last?["success"] as? Bool == true)
    print("production Swift end/persistence checks passed")
  }
}
let suite = "velora-source-check-" + UUID().uuidString
let defaults = UserDefaults(suiteName: suite)!
defer { defaults.removePersistentDomain(forName: suite) }
Harness(defaults).check()
`
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'velora-ios-source-'))
  try {
    const file = path.join(directory, 'check.swift')
    fs.writeFileSync(file, fixture)
    const result = spawnSync('xcrun', ['swift', file], { encoding: 'utf8', timeout: 60_000 })
    assert.equal(result.status, 0, result.error?.message ?? `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /production Swift end\/persistence checks passed/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

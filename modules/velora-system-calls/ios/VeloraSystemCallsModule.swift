import AVFoundation
import CallKit
import ExpoModulesCore
import OSLog
import PushKit
import UIKit
import WebRTC

private let callActionEvent = "onCallAction"
private let voipTokenEvent = "onVoipTokenUpdated"
private let audioSessionActivatedEvent = "onAudioSessionActivated"
private let audioSessionConfiguredEvent = "onAudioSessionConfigured"
private let authenticatedUserIdStorageKey = "velora.calls.authenticatedUserId"
private let pendingActionStorageKey = "velora.calls.pendingAction"
private let voipTokenStorageKey = "velora.calls.voipToken"
private let voipTokenUpdatedAtStorageKey = "velora.calls.voipTokenUpdatedAt"
private let voipTokenInvalidatedAtStorageKey = "velora.calls.voipTokenInvalidatedAt"
private let voipTokenInvalidatedValueStorageKey = "velora.calls.voipTokenInvalidatedValue"
private let callUuidStorageKey = "velora.calls.uuidByCallId"
private let reportedIncomingCallIdsStorageKey = "velora.calls.reportedIncomingCallIds"
private let incomingCallExpirationsStorageKey = "velora.calls.incomingCallExpirations"
private let remoteCallStateUpdatesStorageKey = "velora.calls.remoteCallStateUpdates"
private let remoteCallStateUpdateRetention: TimeInterval = 24 * 60 * 60
private let systemCallsLogger = Logger(subsystem: "com.quan.velora", category: "SystemCalls")

private enum ExistingIncomingCallState: Equatable {
  case none
  case active(uuid: UUID)
  case reporting(uuid: UUID?)
  case stale(uuid: UUID?)
}

private enum PushKitHandlingStrategy: Equatable {
  case reportValidatedIncomingCall
  case reportFallbackAndEnd
  case reuseExistingCall(uuid: UUID)
  case waitForInFlightReport
}

private enum CallStateUpdateHandlingStrategy: Equatable {
  case reportEndedCall
  case queueUntilIncomingCallReported
  case recordWithoutLocalCall
  case ignore
}

private struct PendingCallStateUpdate {
  let status: String
  let reason: String?
  let endedAt: Date
}

public class VeloraSystemCallsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VeloraSystemCalls")
    Events(callActionEvent, voipTokenEvent, audioSessionActivatedEvent, audioSessionConfiguredEvent)

    OnCreate {
      let callCenter = VeloraSystemCallCenter.shared
      callCenter.runOnMain {
        callCenter.eventSink = { [weak self] name, body in
          self?.sendEvent(name, body)
        }
        callCenter.start()
      }
    }

    OnDestroy {
      let callCenter = VeloraSystemCallCenter.shared
      callCenter.runOnMain {
        callCenter.eventSink = nil
      }
    }

    Function("setAuthenticatedUserId") { (userId: String?) in
      let callCenter = VeloraSystemCallCenter.shared
      callCenter.runOnMain {
        callCenter.setAuthenticatedUserId(userId)
      }
    }

    Function("getVoipRegistrationState") { () -> [String: Any] in
      let callCenter = VeloraSystemCallCenter.shared
      return callCenter.runOnMain {
        callCenter.ensureStarted()
        return callCenter.voipRegistrationState()
      }
    }

    Function("getVoipToken") { () -> String? in
      let callCenter = VeloraSystemCallCenter.shared
      return callCenter.runOnMain {
        callCenter.ensureStarted()
        return callCenter.voipToken
      }
    }

    Function("getPendingCallAction") { () -> [String: Any]? in
      let callCenter = VeloraSystemCallCenter.shared
      return callCenter.runOnMain {
        callCenter.pendingCallAction()
      }
    }

    Function("getAudioSessionConfigurationState") { () -> [String: Any] in
      let callCenter = VeloraSystemCallCenter.shared
      return callCenter.runOnMain {
        callCenter.audioSessionConfigurationState()
      }
    }

    AsyncFunction("getNativeAudioSessionState") { (promise: Promise) in
      let callCenter = VeloraSystemCallCenter.shared
      callCenter.runOnMain {
        promise.resolve(callCenter.nativeAudioSessionState())
      }
    }

    Function("clearPendingCallAction") { (actionId: String?) in
      let callCenter = VeloraSystemCallCenter.shared
      callCenter.runOnMain {
        callCenter.clearPendingCallAction(actionId: actionId)
      }
    }

    AsyncFunction("presentIncomingCall") { (payload: [String: Any], promise: Promise) in
      let callCenter = VeloraSystemCallCenter.shared
      callCenter.runOnMain {
        callCenter.presentIncomingCall(payload: payload) { result in
          promise.resolve(result)
        }
      }
    }

    AsyncFunction("registerOutgoingCall") { (payload: [String: Any], promise: Promise) in
      let callCenter = VeloraSystemCallCenter.shared
      callCenter.runOnMain {
        callCenter.registerOutgoingCall(payload: payload) { result in
          promise.resolve(result)
        }
      }
    }

    Function("setCallActive") { (callId: String) -> Bool in
      let callCenter = VeloraSystemCallCenter.shared
      return callCenter.runOnMain {
        callCenter.setCallActive(callId: callId)
      }
    }

    Function("setCallType") { (callId: String, callType: String) -> Bool in
      let callCenter = VeloraSystemCallCenter.shared
      return callCenter.runOnMain {
        callCenter.setCallType(callId: callId, callType: callType)
      }
    }

    Function("setSpeakerEnabled") { (enabled: Bool) -> Bool in
      let callCenter = VeloraSystemCallCenter.shared
      return callCenter.runOnMain {
        callCenter.setSpeakerEnabled(enabled)
      }
    }

    AsyncFunction("endCall") { (callId: String, promise: Promise) in
      let callCenter = VeloraSystemCallCenter.shared
      callCenter.runOnMain {
        callCenter.endCall(callId: callId) { result in
          promise.resolve(result)
        }
      }
    }

    AsyncFunction("dismissIncomingCall") { (callId: String, promise: Promise) in
      let callCenter = VeloraSystemCallCenter.shared
      callCenter.runOnMain {
        callCenter.endCall(callId: callId) { result in
          promise.resolve(result)
        }
      }
    }

    Function("activateSimulatorAudioSession") { (callId: String) -> Bool in
      let callCenter = VeloraSystemCallCenter.shared
      return callCenter.runOnMain { callCenter.activateSimulatorAudioSession(callId: callId) }
    }

    Function("deactivateSimulatorAudioSession") { (callId: String) -> Bool in
      let callCenter = VeloraSystemCallCenter.shared
      return callCenter.runOnMain { callCenter.deactivateSimulatorAudioSession(callId: callId) }
    }
  }
}

public class VeloraSystemCallsAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    
    let rtcAudioSession = RTCAudioSession.sharedInstance()
    rtcAudioSession.useManualAudio = true
    rtcAudioSession.isAudioEnabled = false

    VeloraSystemCallCenter.shared.start()
    return true
  }

  public func application(
    _ application: UIApplication,
    didReceiveRemoteNotification userInfo: [AnyHashable: Any],
    fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    let callCenter = VeloraSystemCallCenter.shared
    let handled = callCenter.runOnMain {
      callCenter.handleRemoteNotification(userInfo)
    }

    completionHandler(handled ? .newData : .noData)
  }
}

private final class VeloraSystemCallCenter: NSObject, PKPushRegistryDelegate, CXProviderDelegate, CXCallObserverDelegate {
  static let shared = VeloraSystemCallCenter()

  var eventSink: ((String, [String: Any]) -> Void)?
  private(set) var voipToken: String?

  private let userDefaults = UserDefaults.standard
  private let provider: CXProvider
  private let callController: CXCallController
  private let callObserver = CXCallObserver()
  private let processLaunchId = UUID().uuidString
  private var pushRegistry: PKPushRegistry?
  private var callIdsByUuid: [UUID: String] = [:]
  private var uuidsByCallId: [String: UUID] = [:]
  private var payloadsByCallId: [String: [String: Any]] = [:]
  private var programmaticEndingCallIds = Set<String>()
  private var activeCallIds = Set<String>()
  private var pendingAnswerCallIds = Set<String>()
  private var isAudioSessionConfigured = false
  private var audioSessionConfigurationErrorCode: String?
  private var lastAudioSessionConfiguration: [String: Any]?
  private var isNativeAudioSessionActivated = false
  private var nativeAudioSessionActivatedAt: Date?
  private var nativeAudioSessionDeactivatedAt: Date?
  private var nativeAudioSessionActivationSequence = 0
  private var nativeAudioSessionCallUuid: UUID?
  private var speakerOverrideEnabled = false
  private var reportingIncomingCallIds = Set<String>()
  private var reportedIncomingCallIds = Set<String>()
  private var queuedIncomingCallReportCompletionsById: [String: [([String: Any]) -> Void]] = [:]
  private var fallbackEndedIncomingCallReasonsById: [String: CXCallEndedReason] = [:]
  private var pendingCallStateUpdatesByCallId: [String: PendingCallStateUpdate] = [:]
  private var remoteCallStateUpdatesByCallId: [String: PendingCallStateUpdate] = [:]
  private var incomingCallExpirationWorkItemsByCallId: [String: DispatchWorkItem] = [:]
  private var incomingCallExpiresAtByCallId: [String: Date] = [:]

  private override init() {
    let configuration = CXProviderConfiguration()
    configuration.supportsVideo = true
    configuration.maximumCallsPerCallGroup = 1
    configuration.supportedHandleTypes = [.generic]
    configuration.includesCallsInRecents = false
    configuration.iconTemplateImageData = nil
    provider = CXProvider(configuration: configuration)
    callController = CXCallController(queue: .main)
    voipToken = userDefaults.string(forKey: voipTokenStorageKey)
    super.init()
    restoreCallUuidMappings()
    restoreReportedIncomingCallIds()
    restoreIncomingCallExpirations()
    restoreRemoteCallStateUpdates()
    provider.setDelegate(self, queue: .main)
    callObserver.setDelegate(self, queue: .main)
    #if DEBUG
    assertPushKitHandlingCoverage()
    #endif
  }

  func runOnMain<T>(_ operation: @escaping () -> T) -> T {
    if Thread.isMainThread {
      return operation()
    }

    return DispatchQueue.main.sync(execute: operation)
  }

  func start() {
    if pushRegistry != nil {
      return
    }

    let registry = PKPushRegistry(queue: .main)
    registry.delegate = self
    registry.desiredPushTypes = [.voIP]
    pushRegistry = registry
    logOperationalNotice(
      layer: "pushkit",
      event: "push_registry_initialized",
      success: true
    )
  }

  func ensureStarted() {
    if Thread.isMainThread {
      start()
      return
    }

    DispatchQueue.main.async { [weak self] in
      self?.start()
    }
  }

  func setAuthenticatedUserId(_ userId: String?) {
    ensureStarted()
    let previousUserId = userDefaults.string(forKey: authenticatedUserIdStorageKey)
    userDefaults.set(userId, forKey: authenticatedUserIdStorageKey)

    guard previousUserId != userId else {
      return
    }

    // A CallKit screen may have been reported before the JS call state exists.
    // Close it when the account changes, but do not store a reject/end action:
    // this is local account cleanup, not a user decision about the call.
    endCallsForAuthenticationTransition()
  }

  func handleRemoteNotification(_ payload: [AnyHashable: Any]) -> Bool {
    handleCallStateUpdate(payload: stringKeyedPayload(from: payload))
  }

  func pendingCallAction() -> [String: Any]? {
    userDefaults.dictionary(forKey: pendingActionStorageKey)
  }

  func voipRegistrationState() -> [String: Any] {
    [
      "token": voipToken ?? NSNull(),
      "bundleId": Bundle.main.bundleIdentifier ?? NSNull(),
      "apnsEnvironment": currentApnsEnvironment() ?? NSNull(),
      "updatedAt": userDefaults.string(forKey: voipTokenUpdatedAtStorageKey) ?? NSNull(),
      "invalidatedAt": userDefaults.string(forKey: voipTokenInvalidatedAtStorageKey) ?? NSNull(),
      "invalidatedToken": userDefaults.string(forKey: voipTokenInvalidatedValueStorageKey) ?? NSNull(),
    ]
  }

  func audioSessionConfigurationState() -> [String: Any] {
    var state: [String: Any] = ["configured": isAudioSessionConfigured]

    if let lastAudioSessionConfiguration {
      state.merge(lastAudioSessionConfiguration) { _, latest in latest }
    }

    if let audioSessionConfigurationErrorCode {
      state["errorCode"] = audioSessionConfigurationErrorCode
    }

    return state
  }

  func nativeAudioSessionState() -> [String: Any] {
    let audioSession = AVAudioSession.sharedInstance()
    let rtcAudioSession = RTCAudioSession.sharedInstance()
    let state: [String: Any] = [
      "isActivated": isNativeAudioSessionActivated,
      "isAudioEnabled": rtcAudioSession.isAudioEnabled,
      "activationSequence": nativeAudioSessionActivationSequence,
      "activatedAt": nativeAudioSessionActivatedAt.map { Int($0.timeIntervalSince1970 * 1000) } ?? NSNull(),
      "deactivatedAt": nativeAudioSessionDeactivatedAt.map { Int($0.timeIntervalSince1970 * 1000) } ?? NSNull(),
      "category": audioSession.category.rawValue,
      "mode": audioSession.mode.rawValue,
      "inputRouteTypes": audioSession.currentRoute.inputs.map(\.portType.rawValue),
      "outputRouteTypes": audioSession.currentRoute.outputs.map(\.portType.rawValue),
      "forcedSpeaker": speakerOverrideEnabled,
      "callUuid": nativeAudioSessionCallUuid?.uuidString ?? NSNull(),
      "errorCode": audioSessionConfigurationErrorCode ?? NSNull(),
    ]
    logOperationalNotice(
      layer: "callkit",
      event: "audio_snapshot_requested",
      callId: nativeAudioSessionCallUuid.flatMap { callIdsByUuid[$0] },
      callUuid: nativeAudioSessionCallUuid,
      success: isNativeAudioSessionActivated && rtcAudioSession.isAudioEnabled,
      errorCode: audioSessionConfigurationErrorCode
    )
    return state
  }

  func clearPendingCallAction(actionId: String?) {
    guard let actionId else {
      userDefaults.removeObject(forKey: pendingActionStorageKey)
      return
    }

    let pending = pendingCallAction()
    if pending?["actionId"] as? String == actionId {
      userDefaults.removeObject(forKey: pendingActionStorageKey)
    }
  }

  func presentIncomingCall(
    payload: [String: Any],
    completion: @escaping ([String: Any]) -> Void
  ) {
    reportIncomingCall(
      payload: payload,
      layer: "callkit",
      requiresCallKitFallbackOnInvalid: false,
      completion: completion
    )
  }

  private func reportIncomingCall(
    payload: [String: Any],
    layer: String,
    requiresCallKitFallbackOnInvalid: Bool,
    completion: @escaping ([String: Any]) -> Void
  ) {
    let startedAt = Date()
    let validation = validateIncomingPayload(payload)
    let existingState = validation.callId.map { currentIncomingCallState(for: $0) }

    if layer == "pushkit" {
      logOperationalNotice(
        layer: layer,
        event: validation.accepted ? "payload_validation_succeeded" : "payload_validation_failed",
        callId: validation.callId,
        success: validation.accepted,
        errorCode: validation.errorCode,
        elapsedMs: elapsedMilliseconds(since: startedAt)
      )
    }

    if (validation.accepted || requiresCallKitFallbackOnInvalid), let existingState {
      switch existingState {
      case .active(let uuid):
        if validation.accepted, let callId = validation.callId {
          payloadsByCallId[callId] = payload
        }
        logPhaseEvent(
          layer: layer,
          event: "incoming_call_deduplicated",
          callId: validation.callId,
          callUuid: uuid,
          success: true,
          errorCode: validation.accepted ? nil : validation.errorCode,
          errorMessage: validation.accepted ? nil : validation.errorMessage,
          elapsedMs: elapsedMilliseconds(since: startedAt)
        )
        completion(
          makeCallResult(
            success: true,
            callId: validation.callId,
            callUuid: uuid
          )
        )
        return

      case .reporting:
        guard let callId = validation.callId else {
          break
        }

        queueIncomingCallReportCompletion(callId: callId, completion: completion)
        logPhaseEvent(
          layer: layer,
          event: "incoming_call_duplicate_while_reporting",
          callId: callId,
          callUuid: uuidsByCallId[callId],
          success: true,
          elapsedMs: elapsedMilliseconds(since: startedAt)
        )
        return

      case .stale:
        if let callId = validation.callId {
          clearCall(callId: callId)
          logPhaseEvent(
            layer: layer,
            event: "incoming_call_stale_registry_cleared",
            callId: callId,
            success: true,
            elapsedMs: elapsedMilliseconds(since: startedAt)
          )
        }

      case .none:
        break
      }
    }

    guard validation.accepted else {
      if requiresCallKitFallbackOnInvalid {
        reportFallbackIncomingCall(
          originalPayload: payload,
          validation: validation,
          layer: layer,
          startedAt: startedAt,
          completion: completion
        )
        return
      }

      logPhaseEvent(
        layer: layer,
        event: "incoming_call_payload_rejected",
        callId: validation.callId,
        success: false,
        errorCode: validation.errorCode,
        errorMessage: validation.errorMessage,
        elapsedMs: elapsedMilliseconds(since: startedAt)
      )
      completion(
        makeCallResult(
          success: false,
          callId: validation.callId,
          errorCode: validation.errorCode,
          errorMessage: validation.errorMessage
        )
      )
      return
    }

    let callId = validation.callId ?? ""
    pruneRemoteCallStateUpdates()
    if let remoteCallStateUpdate = remoteCallStateUpdatesByCallId[callId] {
      logPhaseEvent(
        layer: layer,
        event: "incoming_call_suppressed_by_remote_call_state",
        callId: callId,
        success: true,
        elapsedMs: elapsedMilliseconds(since: startedAt),
        extra: [
          "status": remoteCallStateUpdate.status,
          "at": isoTimestamp(remoteCallStateUpdate.endedAt),
        ]
      )
      completion(
        makeCallResult(
          success: false,
          callId: callId,
          errorCode: "remote_call_state_already_received",
          errorMessage: "A newer remote call state was received before the incoming call."
        )
      )
      return
    }

    let uuid = uuidForCallId(callId)
    queueIncomingCallReportCompletion(callId: callId, completion: completion)
    payloadsByCallId[callId] = payload
    reportingIncomingCallIds.insert(callId)

    let update = callUpdate(
      displayName: callerName(from: payload),
      isVideo: nonEmptyString(payload["callType"]) == "VIDEO"
    )
    prepareWebRtcAudioSessionForCallKit(callId: callId, callUuid: uuid)
    logOperationalNotice(
      layer: layer,
      event: "report_new_incoming_call_started",
      callId: callId,
      callUuid: uuid,
      success: true,
      elapsedMs: elapsedMilliseconds(since: startedAt)
    )

    provider.reportNewIncomingCall(with: uuid, update: update) { error in
      self.reportingIncomingCallIds.remove(callId)

      if let error {
        self.clearCall(callId: callId)
        let errorCode = self.callKitErrorCode(error, fallback: "incoming_call_report_failed")
        let errorMessage = self.sanitizedErrorMessage(
          error,
          fallback: "Failed to report incoming call to CallKit."
        )
        self.logPhaseEvent(
          layer: layer,
          event: "incoming_call_report_failed",
          callId: callId,
          callUuid: uuid,
          success: false,
          errorCode: errorCode,
          errorMessage: errorMessage,
          elapsedMs: self.elapsedMilliseconds(since: startedAt)
        )
        self.logOperationalNotice(
          layer: layer,
          event: "report_new_incoming_call_failed",
          callId: callId,
          callUuid: uuid,
          success: false,
          errorCode: errorCode,
          elapsedMs: self.elapsedMilliseconds(since: startedAt)
        )
        self.finishIncomingCallReport(
          callId: callId,
          fallbackResult: self.makeCallResult(
            success: false,
            callId: callId,
            callUuid: uuid,
            errorCode: errorCode,
            errorMessage: errorMessage
          )
        )
        return
      }

      self.reportedIncomingCallIds.insert(callId)
      self.persistReportedIncomingCallIds()
      if let expirationDate = self.incomingCallExpirationDate(from: payload) {
        self.scheduleIncomingCallExpiration(
          callId: callId,
          uuid: uuid,
          expirationDate: expirationDate
        )
      }
      self.logPhaseEvent(
        layer: layer,
        event: "incoming_call_reported",
        callId: callId,
        callUuid: uuid,
        success: true,
        elapsedMs: self.elapsedMilliseconds(since: startedAt)
      )
      self.logOperationalNotice(
        layer: layer,
        event: "report_new_incoming_call_completed",
        callId: callId,
        callUuid: uuid,
        success: true,
        elapsedMs: self.elapsedMilliseconds(since: startedAt)
      )
      let pendingCallStateUpdate = self.pendingCallStateUpdatesByCallId.removeValue(forKey: callId)
      self.finishIncomingCallReport(
        callId: callId,
        fallbackResult: self.makeCallResult(
          success: true,
          callId: callId,
          callUuid: uuid
        )
      )

      if let pendingCallStateUpdate {
        self.applyCallStateUpdate(
          callId: callId,
          uuid: uuid,
          update: pendingCallStateUpdate,
          startedAt: startedAt
        )
      }
    }
  }

  func registerOutgoingCall(
    payload: [String: Any],
    completion: @escaping ([String: Any]) -> Void
  ) {
    let startedAt = Date()
    guard let callId = nonEmptyString(payload["callId"]) else {
      let errorCode = "missing_call_id"
      let errorMessage = "Outgoing call registration requires a non-empty callId."
      logPhaseEvent(
        layer: "callkit",
        event: "register_outgoing_rejected",
        success: false,
        errorCode: errorCode,
        errorMessage: errorMessage,
        elapsedMs: elapsedMilliseconds(since: startedAt)
      )
      completion(
        makeCallResult(
          success: false,
          errorCode: errorCode,
          errorMessage: errorMessage
        )
      )
      return
    }

    resetAudioConfigurationState()
    speakerOverrideEnabled = false
    let uuid = uuidForCallId(callId)
    payloadsByCallId[callId] = payload
    let action = CXStartCallAction(
      call: uuid,
      handle: CXHandle(type: .generic, value: peerName(from: payload))
    )
    action.isVideo = nonEmptyString(payload["callType"]) == "VIDEO"

    callController.request(CXTransaction(action: action)) { [weak self] error in
      guard let self else {
        completion([
          "success": false,
          "callId": callId,
          "callUuid": uuid.uuidString,
          "errorCode": "callkit_provider_unavailable",
          "errorMessage": "Call provider was released before the outgoing transaction completed.",
        ])
        return
      }

      if let error {
        let errorCode = self.callKitErrorCode(error, fallback: "callkit_start_transaction_failed")
        let errorMessage = self.sanitizedErrorMessage(
          error,
          fallback: "Failed to request the outgoing CallKit transaction."
        )
        _ = self.clearCallIfObserverConfirmsMissing(callId: callId, uuid: uuid)
        self.logPhaseEvent(
          layer: "callkit",
          event: "register_outgoing_failed",
          callId: callId,
          callUuid: uuid,
          success: false,
          errorCode: errorCode,
          errorMessage: errorMessage,
          elapsedMs: self.elapsedMilliseconds(since: startedAt)
        )
        completion(
          self.makeCallResult(
            success: false,
            callId: callId,
            callUuid: uuid,
            errorCode: errorCode,
            errorMessage: errorMessage
          )
        )
        return
      }

      self.logPhaseEvent(
        layer: "callkit",
        event: "register_outgoing_requested",
        callId: callId,
        callUuid: uuid,
        success: true,
        elapsedMs: self.elapsedMilliseconds(since: startedAt)
      )
      completion(
        self.makeCallResult(
          success: true,
          callId: callId,
          callUuid: uuid
        )
      )
    }
  }

  func setCallActive(callId: String) -> Bool {
    guard let uuid = uuidsByCallId[callId], payloadsByCallId[callId] != nil else {
      logPhaseEvent(
        layer: "callkit",
        event: "set_call_active_rejected",
        callId: callId,
        success: false,
        errorCode: "call_not_found",
        errorMessage: "setCallActive was invoked without a known native CallKit mapping."
      )
      return false
    }

    pendingAnswerCallIds.remove(callId)
    activeCallIds.insert(callId)
    cancelIncomingCallExpiration(callId: callId)

    if payloadsByCallId[callId]?["type"] as? String != "INCOMING_CALL" {
      provider.reportOutgoingCall(with: uuid, connectedAt: Date())
    }

    return true
  }

  func setCallType(callId: String, callType: String) -> Bool {
    guard (callType == "VOICE" || callType == "VIDEO"),
          let uuid = uuidsByCallId[callId],
          var payload = payloadsByCallId[callId] else {
      return false
    }

    payload["callType"] = callType
    payloadsByCallId[callId] = payload
    let displayName = payload["type"] as? String == "INCOMING_CALL"
      ? callerName(from: payload)
      : peerName(from: payload)
    provider.reportCall(
      with: uuid,
      updated: callUpdate(displayName: displayName, isVideo: callType == "VIDEO")
    )
    return true
  }

  func setSpeakerEnabled(_ enabled: Bool) -> Bool {
    guard isAudioSessionConfigured else {
      return false
    }

    let audioSession = AVAudioSession.sharedInstance()
    let rtcAudioSession = RTCAudioSession.sharedInstance()
    rtcAudioSession.lockForConfiguration()
    defer {
      rtcAudioSession.unlockForConfiguration()
    }

    do {
      try audioSession.overrideOutputAudioPort(enabled ? .speaker : .none)
      speakerOverrideEnabled = enabled
      emitAudioSessionConfigured(audioSession)
      return true
    } catch {
      NSLog("VeloraSystemCalls failed to change speaker route: \(error)")
      emitAudioSessionConfigured(
        audioSession,
        routeErrorCode: "audio_route_override_failed"
      )
      return false
    }
  }

  func endCall(callId: String, completion: @escaping ([String: Any]) -> Void) {
    let startedAt = Date()
    guard let uuid = uuidsByCallId[callId] else {
      let errorCode = "call_not_found"
      let errorMessage = "No native CallKit mapping exists for the provided callId."
      logPhaseEvent(
        layer: "callkit",
        event: "end_call_rejected",
        callId: callId,
        success: false,
        errorCode: errorCode,
        errorMessage: errorMessage,
        elapsedMs: elapsedMilliseconds(since: startedAt)
      )
      completion(
        makeCallResult(
          success: false,
          callId: callId,
          errorCode: errorCode,
          errorMessage: errorMessage
        )
      )
      return
    }

    programmaticEndingCallIds.insert(callId)
    let action = CXEndCallAction(call: uuid)
    callController.request(CXTransaction(action: action)) { [weak self] error in
      guard let self else {
        completion([
          "success": false,
          "callId": callId,
          "callUuid": uuid.uuidString,
          "errorCode": "callkit_provider_unavailable",
          "errorMessage": "Call provider was released before the end-call transaction completed.",
        ])
        return
      }

      if let error {
        self.programmaticEndingCallIds.remove(callId)
        let errorCode = self.callKitErrorCode(error, fallback: "callkit_end_transaction_failed")
        let errorMessage = self.sanitizedErrorMessage(
          error,
          fallback: "Failed to request the end-call CallKit transaction."
        )
        _ = self.clearCallIfObserverConfirmsMissing(callId: callId, uuid: uuid)
        self.logPhaseEvent(
          layer: "callkit",
          event: "end_call_request_failed",
          callId: callId,
          callUuid: uuid,
          success: false,
          errorCode: errorCode,
          errorMessage: errorMessage,
          elapsedMs: self.elapsedMilliseconds(since: startedAt)
        )
        completion(
          self.makeCallResult(
            success: false,
            callId: callId,
            callUuid: uuid,
            errorCode: errorCode,
            errorMessage: errorMessage
          )
        )
        return
      }

      self.logPhaseEvent(
        layer: "callkit",
        event: "end_call_requested",
        callId: callId,
        callUuid: uuid,
        success: true,
        elapsedMs: self.elapsedMilliseconds(since: startedAt)
      )
      completion(
        self.makeCallResult(
          success: true,
          callId: callId,
          callUuid: uuid
        )
      )
    }
  }

  func pushRegistry(
    _ registry: PKPushRegistry,
    didUpdate pushCredentials: PKPushCredentials,
    for type: PKPushType
  ) {
    guard type == .voIP else {
      return
    }

    let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
    voipToken = token
    userDefaults.set(token, forKey: voipTokenStorageKey)
    userDefaults.set(isoTimestamp(), forKey: voipTokenUpdatedAtStorageKey)
    userDefaults.removeObject(forKey: voipTokenInvalidatedAtStorageKey)
    userDefaults.removeObject(forKey: voipTokenInvalidatedValueStorageKey)

    var registrationState = voipRegistrationState()
    registrationState["invalidatedToken"] = NSNull()
    eventSink?(voipTokenEvent, registrationState)
    logPhaseEvent(
      layer: "pushkit",
      event: "voip_token_updated",
      success: true,
      extra: [
        "bundleId": registrationState["bundleId"] ?? NSNull(),
        "apnsEnvironment": registrationState["apnsEnvironment"] ?? NSNull(),
        "tokenPrefix": safeTokenPrefix(token),
      ]
    )
    logOperationalNotice(
      layer: "pushkit",
      event: "voip_token_updated",
      success: true,
      tokenPrefix: safeTokenPrefix(token)
    )
  }

  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    guard type == .voIP else {
      return
    }

    let previousToken = voipToken
    voipToken = nil
    userDefaults.removeObject(forKey: voipTokenStorageKey)
    userDefaults.set(isoTimestamp(), forKey: voipTokenInvalidatedAtStorageKey)
    if let previousToken {
      userDefaults.set(previousToken, forKey: voipTokenInvalidatedValueStorageKey)
    } else {
      userDefaults.removeObject(forKey: voipTokenInvalidatedValueStorageKey)
    }

    let registrationState = voipRegistrationState()
    eventSink?(voipTokenEvent, registrationState)
    logPhaseEvent(
      layer: "pushkit",
      event: "voip_token_invalidated",
      success: true,
      extra: [
        "bundleId": registrationState["bundleId"] ?? NSNull(),
        "apnsEnvironment": registrationState["apnsEnvironment"] ?? NSNull(),
        "tokenPrefix": safeTokenPrefix(previousToken),
      ]
    )
  }

  func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    guard type == .voIP else {
      completion()
      return
    }

    let normalizedPayload = stringKeyedPayload(from: payload.dictionaryPayload)
    logOperationalNotice(
      layer: "pushkit",
      event: "voip_push_received",
      callId: nonEmptyString(normalizedPayload["callId"]),
      success: true
    )
    reportIncomingCall(
      payload: normalizedPayload,
      layer: "pushkit",
      requiresCallKitFallbackOnInvalid: true
    ) { _ in
      completion()
    }
  }

  private func handleCallStateUpdate(payload: [String: Any]) -> Bool {
    let startedAt = Date()
    let validation = validateCallStateUpdatePayload(payload)
    let uuid = validation.callId.flatMap { uuidsByCallId[$0] }
    let isLocallyAnswering = validation.callId.map {
      pendingAnswerCallIds.contains($0) || activeCallIds.contains($0)
    } ?? false
    let isIncomingCallReportInFlight = validation.callId.map {
      reportingIncomingCallIds.contains($0) && payloadsByCallId[$0]?["type"] as? String == "INCOMING_CALL"
    } ?? false

    let strategy = callStateUpdateHandlingStrategy(
      validationAccepted: validation.accepted,
      status: validation.status,
      hasKnownCall: uuid != nil,
      isLocallyAnswering: isLocallyAnswering,
      isIncomingCallReportInFlight: isIncomingCallReportInFlight
    )

    guard let callId = validation.callId,
          let status = validation.status,
          let endedAt = validation.endedAt else {
      logPhaseEvent(
        layer: "remote-notification",
        event: "call_state_update_ignored",
        callId: validation.callId,
        callUuid: uuid,
        success: false,
        errorCode: validation.errorCode ?? (isLocallyAnswering ? "local_answer_in_progress" : "call_not_found"),
        errorMessage: validation.errorMessage ?? "Call state update was ignored by the native CallKit state.",
        elapsedMs: elapsedMilliseconds(since: startedAt)
      )
      return false
    }

    let update = PendingCallStateUpdate(
      status: status,
      reason: validation.reason,
      endedAt: endedAt
    )

    if strategy == .ignore {
      logPhaseEvent(
        layer: "remote-notification",
        event: "call_state_update_ignored",
        callId: callId,
        callUuid: uuid,
        success: false,
        errorCode: isLocallyAnswering ? "local_answer_in_progress" : "call_state_update_ignored",
        errorMessage: "Call state update was ignored by the native CallKit state.",
        elapsedMs: elapsedMilliseconds(since: startedAt)
      )
      return false
    }

    guard storeRemoteCallStateUpdate(callId: callId, update: update) else {
      logPhaseEvent(
        layer: "remote-notification",
        event: "call_state_update_superseded",
        callId: callId,
        callUuid: uuid,
        success: true,
        elapsedMs: elapsedMilliseconds(since: startedAt),
        extra: ["status": status]
      )
      return true
    }

    switch strategy {
    case .queueUntilIncomingCallReported:
      pendingCallStateUpdatesByCallId[callId] = update
      logPhaseEvent(
        layer: "remote-notification",
        event: "call_state_update_queued_until_incoming_call_reported",
        callId: callId,
        callUuid: uuid,
        success: true,
        elapsedMs: elapsedMilliseconds(since: startedAt),
        extra: ["status": status]
      )
      return true
    case .reportEndedCall:
      guard let uuid else {
        return true
      }
      applyCallStateUpdate(
        callId: callId,
        uuid: uuid,
        update: update,
        startedAt: startedAt
      )
      return true
    case .recordWithoutLocalCall:
      logPhaseEvent(
        layer: "remote-notification",
        event: "call_state_update_recorded_without_local_call",
        callId: callId,
        success: true,
        elapsedMs: elapsedMilliseconds(since: startedAt),
        extra: ["status": status]
      )
      return true
    case .ignore:
      return false
    }
  }

  private func applyCallStateUpdate(
    callId: String,
    uuid: UUID,
    update: PendingCallStateUpdate,
    startedAt: Date
  ) {
    let endReason = callStateUpdateEndedReason(
      status: update.status,
      reason: update.reason
    )
    provider.reportCall(with: uuid, endedAt: update.endedAt, reason: endReason)

    var actionExtra: [String: Any] = [
      "status": update.status,
      "at": isoTimestamp(update.endedAt),
    ]
    if let reason = update.reason {
      actionExtra["reason"] = reason
    }
    storePendingAction(action: "remote_end", callId: callId, extra: actionExtra)
    clearCall(callId: callId)
    logPhaseEvent(
      layer: "remote-notification",
      event: "call_state_update_ended_call",
      callId: callId,
      callUuid: uuid,
      success: true,
      elapsedMs: elapsedMilliseconds(since: startedAt),
      extra: [
        "status": update.status,
        "endReason": stringValue(for: endReason),
      ]
    )
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    guard let callId = callIdsByUuid[action.callUUID] else {
      action.fulfill()
      return
    }

    if let fallbackEndedReason = fallbackEndedIncomingCallReasonsById[callId] {
      provider.reportCall(with: action.callUUID, endedAt: Date(), reason: fallbackEndedReason)
      logPhaseEvent(
        layer: "callkit",
        event: "answer_action_rejected_for_fallback_call",
        callId: callId,
        callUuid: action.callUUID,
        success: false,
        errorCode: "fallback_incoming_call_not_answerable",
        errorMessage: "Fallback CallKit calls created for invalid VoIP pushes cannot be answered."
      )
      action.fail()
      return
    }

    resetAudioConfigurationState()
    speakerOverrideEnabled = false
    pendingAnswerCallIds.insert(callId)
    cancelIncomingCallExpiration(callId: callId)
    prepareWebRtcAudioSessionForCallKit(callId: callId, callUuid: action.callUUID)
    storePendingAction(action: "answer", callId: callId)
    let actionStartedAt = Date()
    logOperationalNotice(
      layer: "callkit",
      event: "callkit_answer_action_received",
      callId: callId,
      callUuid: action.callUUID,
      success: true
    )
    logPhaseEvent(
      layer: "callkit",
      event: "answer_action_fulfilled",
      callId: callId,
      callUuid: action.callUUID,
      success: true
    )
    action.fulfill()
    logOperationalNotice(
      layer: "callkit",
      event: "callkit_answer_action_fulfilled",
      callId: callId,
      callUuid: action.callUUID,
      success: true,
      elapsedMs: elapsedMilliseconds(since: actionStartedAt)
    )
  }

  func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
    guard callIdsByUuid[action.callUUID] != nil else {
      action.fulfill()
      return
    }

    provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: Date())
    if let callId = callIdsByUuid[action.callUUID] {
      logPhaseEvent(
        layer: "callkit",
        event: "start_action_fulfilled",
        callId: callId,
        callUuid: action.callUUID,
        success: true
      )
    }
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    guard let callId = callIdsByUuid[action.callUUID] else {
      action.fulfill()
      return
    }

    if let fallbackEndedReason = fallbackEndedIncomingCallReasonsById[callId] {
      provider.reportCall(with: action.callUUID, endedAt: Date(), reason: fallbackEndedReason)
      clearCall(callId: callId)
      logPhaseEvent(
        layer: "callkit",
        event: "fallback_end_action_fulfilled",
        callId: callId,
        callUuid: action.callUUID,
        success: true,
        extra: ["endReason": stringValue(for: fallbackEndedReason)]
      )
      action.fulfill()
      return
    }

    let nativeAction = callKitEndAction(
      isActiveCall: activeCallIds.contains(callId),
      isIncomingCall: payloadsByCallId[callId]?["type"] as? String == "INCOMING_CALL"
    )

    if programmaticEndingCallIds.remove(callId) == nil {
      storePendingAction(action: nativeAction, callId: callId)
    }
    clearCall(callId: callId)
    logPhaseEvent(
      layer: "callkit",
      event: "end_action_fulfilled",
      callId: callId,
      callUuid: action.callUUID,
      success: true
    )
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXSetHeldCallAction) {
    let callId = callIdsByUuid[action.callUUID]
    logPhaseEvent(
      layer: "callkit",
      event: "set_held_unsupported",
      callId: callId,
      callUuid: action.callUUID,
      success: false,
      errorCode: "callkit_hold_not_supported",
      errorMessage: "Hold is not supported for Velora voice calls."
    )
    action.fail()
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    resetAudioConfigurationState()
    let activatedAt = Date()
    isNativeAudioSessionActivated = true
    nativeAudioSessionActivatedAt = activatedAt
    nativeAudioSessionDeactivatedAt = nil
    nativeAudioSessionActivationSequence += 1
    nativeAudioSessionCallUuid = currentAudioSessionCallUuid()
    let callId = currentAudioSessionCallId()
    let activatedAtIso = ISO8601DateFormatter().string(from: activatedAt)
    #if DEBUG
    NSLog(
      "VeloraSystemCalls didActivate audioSession at=%@ category=%@ mode=%@ sampleRate=%.0f outputVolume=%.2f",
      activatedAtIso as NSString,
      audioSession.category.rawValue as NSString,
      audioSession.mode.rawValue as NSString,
      audioSession.sampleRate,
      audioSession.outputVolume
    )
    #endif
    logOperationalNotice(
      layer: "callkit",
      event: "audio_session_did_activate",
      callId: callId,
      callUuid: nativeAudioSessionCallUuid,
      success: true
    )
    eventSink?(
      audioSessionActivatedEvent,
      [
        "at": activatedAtIso,
        "timestampMs": Int(activatedAt.timeIntervalSince1970 * 1000),
        "category": audioSession.category.rawValue,
        "mode": audioSession.mode.rawValue,
      ]
    )
    configureWebRtcAudioSession(audioSession)
  }

  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    let rtcAudioSession = RTCAudioSession.sharedInstance()
    rtcAudioSession.audioSessionDidDeactivate(audioSession)
    rtcAudioSession.isAudioEnabled = false
    isNativeAudioSessionActivated = false
    nativeAudioSessionDeactivatedAt = Date()
    let callId = nativeAudioSessionCallUuid.flatMap { callIdsByUuid[$0] }
    logOperationalNotice(
      layer: "callkit",
      event: "audio_session_did_deactivate",
      callId: callId,
      callUuid: nativeAudioSessionCallUuid,
      success: true
    )
    resetAudioConfigurationState()
  }

  func providerDidReset(_ provider: CXProvider) {
    let trackedCallIds = Array(uuidsByCallId.keys)
    trackedCallIds.forEach { callId in
      if let nativeAction = callProviderResetAction(
        isActiveCall: activeCallIds.contains(callId)
      ) {
        storePendingAction(
          action: nativeAction,
          callId: callId,
          extra: ["reason": "provider_reset"]
        )
      }
      logPhaseEvent(
        layer: "callkit",
        event: "provider_reset",
        callId: callId,
        callUuid: uuidsByCallId[callId],
        success: false,
        errorCode: "callkit_provider_reset",
        errorMessage: "CallKit provider reset and native call state was cleared."
      )
    }

    callIdsByUuid.removeAll()
    uuidsByCallId.removeAll()
    payloadsByCallId.removeAll()
    programmaticEndingCallIds.removeAll()
    activeCallIds.removeAll()
    pendingAnswerCallIds.removeAll()
    speakerOverrideEnabled = false
    resetAudioConfigurationState()
    reportingIncomingCallIds.removeAll()
    reportedIncomingCallIds.removeAll()
    queuedIncomingCallReportCompletionsById.removeAll()
    fallbackEndedIncomingCallReasonsById.removeAll()
    pendingCallStateUpdatesByCallId.removeAll()
    resetNativeAudioSessionState()
    persistCallUuidMappings()
    persistReportedIncomingCallIds()
  }

  func callObserver(_ callObserver: CXCallObserver, callChanged call: CXCall) {
    guard call.hasEnded,
          let callId = callIdsByUuid[call.uuid] else {
      return
    }

    if let fallbackEndedReason = fallbackEndedIncomingCallReasonsById[callId] {
      logPhaseEvent(
        layer: "callkit",
        event: "fallback_incoming_call_end_confirmed",
        callId: callId,
        callUuid: call.uuid,
        success: true,
        extra: ["endReason": stringValue(for: fallbackEndedReason)]
      )
      clearCall(callId: callId)
      return
    }

    logPhaseEvent(
      layer: "callkit",
      event: "observer_call_ended",
      callId: callId,
      callUuid: call.uuid,
      success: true
    )
  }

  private func queueIncomingCallReportCompletion(
    callId: String,
    completion: @escaping ([String: Any]) -> Void
  ) {
    queuedIncomingCallReportCompletionsById[callId, default: []].append(completion)
  }

  private func finishIncomingCallReport(callId: String, fallbackResult: [String: Any]) {
    let queuedCompletions = queuedIncomingCallReportCompletionsById.removeValue(forKey: callId) ?? []
    if queuedCompletions.isEmpty {
      return
    }

    queuedCompletions.forEach { completion in
      completion(fallbackResult)
    }
  }

  private func currentIncomingCallState(for callId: String) -> ExistingIncomingCallState {
    incomingCallState(
      callId: callId,
      mappedUuid: uuidsByCallId[callId],
      isReported: reportedIncomingCallIds.contains(callId),
      isReporting: reportingIncomingCallIds.contains(callId),
      observedActiveCallUuids: activeObservedCallUuids()
    )
  }

  private func incomingCallState(
    callId: String,
    mappedUuid: UUID?,
    isReported: Bool,
    isReporting: Bool,
    observedActiveCallUuids: Set<UUID>
  ) -> ExistingIncomingCallState {
    if let mappedUuid, observedActiveCallUuids.contains(mappedUuid) {
      return .active(uuid: mappedUuid)
    }

    if isReporting {
      return .reporting(uuid: mappedUuid)
    }

    if isReported || mappedUuid != nil {
      return .stale(uuid: mappedUuid)
    }

    return .none
  }

  private func activeObservedCallUuids() -> Set<UUID> {
    Set(
      callObserver.calls.compactMap { call in
        call.hasEnded ? nil : call.uuid
      }
    )
  }

  private func reportFallbackIncomingCall(
    originalPayload: [String: Any],
    validation: (
      accepted: Bool,
      callId: String?,
      errorCode: String?,
      errorMessage: String?
    ),
    layer: String,
    startedAt: Date,
    completion: @escaping ([String: Any]) -> Void
  ) {
    let callId = validation.callId ?? "pushkit-fallback-\(UUID().uuidString)"
    let uuid = uuidForCallId(callId)
    let endReason = fallbackCallEndedReason(for: validation.errorCode)

    queueIncomingCallReportCompletion(callId: callId, completion: completion)
    payloadsByCallId[callId] = sanitizedFallbackPayload(
      callId: callId,
      validation: validation,
      endReason: endReason,
      originalPayload: originalPayload
    )
    reportingIncomingCallIds.insert(callId)
    fallbackEndedIncomingCallReasonsById[callId] = endReason

    let update = callUpdate(displayName: "Velora call", isVideo: false)
    logOperationalNotice(
      layer: layer,
      event: "report_new_incoming_call_started",
      callId: callId,
      callUuid: uuid,
      success: true,
      errorCode: validation.errorCode,
      elapsedMs: elapsedMilliseconds(since: startedAt)
    )

    provider.reportNewIncomingCall(with: uuid, update: update) { error in
      self.reportingIncomingCallIds.remove(callId)

      if let error {
        self.clearCall(callId: callId)
        let errorCode = self.callKitErrorCode(error, fallback: "fallback_incoming_call_report_failed")
        let errorMessage = self.sanitizedErrorMessage(
          error,
          fallback: "Failed to report fallback incoming call to CallKit."
        )
        self.logPhaseEvent(
          layer: layer,
          event: "fallback_incoming_call_report_failed",
          callId: callId,
          callUuid: uuid,
          success: false,
          errorCode: errorCode,
          errorMessage: errorMessage,
          elapsedMs: self.elapsedMilliseconds(since: startedAt),
          extra: [
            "diagnosticReason": validation.errorCode ?? "invalid_payload",
          ]
        )
        self.logOperationalNotice(
          layer: layer,
          event: "report_new_incoming_call_failed",
          callId: callId,
          callUuid: uuid,
          success: false,
          errorCode: errorCode,
          elapsedMs: self.elapsedMilliseconds(since: startedAt)
        )
        self.finishIncomingCallReport(
          callId: callId,
          fallbackResult: self.makeCallResult(
            success: false,
            callId: callId,
            callUuid: uuid,
            errorCode: validation.errorCode ?? errorCode,
            errorMessage: validation.errorMessage ?? errorMessage
          )
        )
        return
      }

      self.reportedIncomingCallIds.insert(callId)
      self.persistReportedIncomingCallIds()
      self.logPhaseEvent(
        layer: layer,
        event: "fallback_incoming_call_reported",
        callId: callId,
        callUuid: uuid,
        success: true,
        elapsedMs: self.elapsedMilliseconds(since: startedAt),
        extra: [
          "diagnosticReason": validation.errorCode ?? "invalid_payload",
          "endReason": self.stringValue(for: endReason),
        ]
      )
      self.logOperationalNotice(
        layer: layer,
        event: "report_new_incoming_call_completed",
        callId: callId,
        callUuid: uuid,
        success: true,
        errorCode: validation.errorCode,
        elapsedMs: self.elapsedMilliseconds(since: startedAt)
      )
      self.provider.reportCall(with: uuid, endedAt: Date(), reason: endReason)
      self.logPhaseEvent(
        layer: layer,
        event: "fallback_incoming_call_ended",
        callId: callId,
        callUuid: uuid,
        success: true,
        elapsedMs: self.elapsedMilliseconds(since: startedAt),
        extra: [
          "diagnosticReason": validation.errorCode ?? "invalid_payload",
          "endReason": self.stringValue(for: endReason),
        ]
      )
      self.finishIncomingCallReport(
        callId: callId,
        fallbackResult: self.makeCallResult(
          success: false,
          callId: callId,
          callUuid: uuid,
          errorCode: validation.errorCode,
          errorMessage: validation.errorMessage
        )
      )
    }
  }

  private func callUpdate(displayName: String, isVideo: Bool) -> CXCallUpdate {
    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: displayName)
    update.localizedCallerName = displayName
    update.hasVideo = isVideo
    update.supportsHolding = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    update.supportsDTMF = false
    return update
  }

  private func fallbackCallEndedReason(for errorCode: String?) -> CXCallEndedReason {
    switch errorCode {
    case "expired_incoming_call":
      return .remoteEnded
    default:
      return .failed
    }
  }

  private func sanitizedFallbackPayload(
    callId: String,
    validation: (
      accepted: Bool,
      callId: String?,
      errorCode: String?,
      errorMessage: String?
    ),
    endReason: CXCallEndedReason,
    originalPayload: [String: Any]
  ) -> [String: Any] {
    var payload: [String: Any] = [
      "callId": callId,
      "type": "PUSHKIT_FALLBACK_TERMINATED_CALL",
      "diagnosticReason": validation.errorCode ?? "invalid_payload",
      "diagnosticMessage": validation.errorMessage ?? "Incoming VoIP payload was rejected.",
      "fallbackEndReason": stringValue(for: endReason),
      "receivedAt": isoTimestamp(),
    ]

    if let receivedType = nonEmptyString(originalPayload["type"]) {
      payload["receivedType"] = receivedType
    }
    if let dedupeIdentifier = dedupeIdentifier(from: originalPayload) {
      payload["dedupeId"] = dedupeIdentifier
    }

    return payload
  }

  private func pushKitHandlingStrategy(
    validationAccepted: Bool,
    existingState: ExistingIncomingCallState?
  ) -> PushKitHandlingStrategy {
    if case .some(.active(let uuid)) = existingState {
      return .reuseExistingCall(uuid: uuid)
    }

    if case .some(.reporting(uuid: _)) = existingState {
      return .waitForInFlightReport
    }

    return validationAccepted ? .reportValidatedIncomingCall : .reportFallbackAndEnd
  }

  private func callStateUpdateHandlingStrategy(
    validationAccepted: Bool,
    status: String?,
    hasKnownCall: Bool,
    isLocallyAnswering: Bool,
    isIncomingCallReportInFlight: Bool
  ) -> CallStateUpdateHandlingStrategy {
    guard validationAccepted && hasKnownCall else {
      return validationAccepted ? .recordWithoutLocalCall : .ignore
    }

    if status == "active" && isLocallyAnswering {
      return .ignore
    }

    return isIncomingCallReportInFlight ? .queueUntilIncomingCallReported : .reportEndedCall
  }

  private func callStateUpdateEndedReason(
    status: String,
    reason: String?
  ) -> CXCallEndedReason {
    if status == "active" {
      return .answeredElsewhere
    }

    if reason == "no_answer" {
      return .unanswered
    }

    if status == "rejected" {
      return .declinedElsewhere
    }

    return .remoteEnded
  }

  private func callProviderResetAction(isActiveCall: Bool) -> String? {
    isActiveCall ? "end" : nil
  }

  private func callKitEndAction(isActiveCall: Bool, isIncomingCall: Bool) -> String {
    isActiveCall || !isIncomingCall ? "end" : "reject"
  }

  private func stringValue(for endedReason: CXCallEndedReason) -> String {
    switch endedReason {
    case .failed:
      return "failed"
    case .remoteEnded:
      return "remote_ended"
    case .unanswered:
      return "unanswered"
    case .answeredElsewhere:
      return "answered_elsewhere"
    case .declinedElsewhere:
      return "declined_elsewhere"
    @unknown default:
      return "unknown"
    }
  }

  #if DEBUG
    private func assertPushKitHandlingCoverage() {
      let validPayload: [String: Any] = [
        "type": "INCOMING_CALL",
        "callId": "debug-call",
        "recipientUserId": "debug-user",
        "callerId": "caller-1",
        "callerName": "Caller",
        "timestamp": "2026-07-11T00:00:00Z",
        "expiresAt": "2099-01-01T00:00:00Z",
      ]

      let valid = validateIncomingPayload(validPayload, authenticatedUserIdOverride: "debug-user")
      assert(valid.accepted)
      assert(incomingCallExpirationDate(from: validPayload) != nil)
      assert(shouldEndIncomingCallAtExpiration(isActive: false, isAnswerPending: false))
      assert(!shouldEndIncomingCallAtExpiration(isActive: true, isAnswerPending: false))
      assert(!shouldEndIncomingCallAtExpiration(isActive: false, isAnswerPending: true))
      assert(
        pushKitHandlingStrategy(
          validationAccepted: valid.accepted,
          existingState: ExistingIncomingCallState.none
        )
          == .reportValidatedIncomingCall
      )

      let missingCallId = validateIncomingPayload(
        validPayload.merging(["callId": "   "]) { _, latest in latest },
        authenticatedUserIdOverride: "debug-user"
      )
      assert(missingCallId.errorCode == "missing_call_id")
      assert(
        pushKitHandlingStrategy(validationAccepted: missingCallId.accepted, existingState: nil)
          == .reportFallbackAndEnd
      )

      let wrongType = validateIncomingPayload(
        validPayload.merging(["type": "CALL_STATE_UPDATE"]) { _, latest in latest },
        authenticatedUserIdOverride: "debug-user"
      )
      assert(wrongType.errorCode == "invalid_voip_event_type")
      assert(
        pushKitHandlingStrategy(validationAccepted: wrongType.accepted, existingState: nil)
          == .reportFallbackAndEnd
      )

      let validCallStatePayload: [String: Any] = [
        "type": "CALL_STATE_UPDATE",
        "callId": "debug-call",
        "recipientUserId": "debug-user",
        "status": "ended",
        "reason": "no_answer",
        "at": "2026-07-11T00:00:00Z",
      ]
      let validCallState = validateCallStateUpdatePayload(
        validCallStatePayload,
        authenticatedUserIdOverride: "debug-user"
      )
      assert(validCallState.accepted)
      assert(
        callStateUpdateHandlingStrategy(
          validationAccepted: validCallState.accepted,
          status: validCallState.status,
          hasKnownCall: true,
          isLocallyAnswering: false,
          isIncomingCallReportInFlight: false
        ) == .reportEndedCall
      )
      assert(
        callStateUpdateHandlingStrategy(
          validationAccepted: validCallState.accepted,
          status: validCallState.status,
          hasKnownCall: false,
          isLocallyAnswering: false,
          isIncomingCallReportInFlight: false
        ) == .recordWithoutLocalCall
      )
      assert(
        callStateUpdateHandlingStrategy(
          validationAccepted: validCallState.accepted,
          status: validCallState.status,
          hasKnownCall: true,
          isLocallyAnswering: false,
          isIncomingCallReportInFlight: true
        ) == .queueUntilIncomingCallReported
      )
      assert(
        callStateUpdateEndedReason(status: "ended", reason: "no_answer") == .unanswered
      )
      assert(
        callStateUpdateEndedReason(status: "rejected", reason: nil) == .declinedElsewhere
      )
      assert(callProviderResetAction(isActiveCall: false) == nil)
      assert(callProviderResetAction(isActiveCall: true) == "end")
      assert(callKitEndAction(isActiveCall: false, isIncomingCall: true) == "reject")
      assert(callKitEndAction(isActiveCall: false, isIncomingCall: false) == "end")
      assert(callKitEndAction(isActiveCall: true, isIncomingCall: true) == "end")
      assert(callKitEndAction(isActiveCall: true, isIncomingCall: false) == "end")
      assert(apnsEnvironment(isDebugBuild: true) == "development")
      assert(apnsEnvironment(isDebugBuild: false) == "production")

      let activeCallState = validateCallStateUpdatePayload(
        validCallStatePayload.merging(["status": "active"]) { _, latest in latest },
        authenticatedUserIdOverride: "debug-user"
      )
      assert(activeCallState.accepted)
      assert(
        callStateUpdateHandlingStrategy(
          validationAccepted: activeCallState.accepted,
          status: activeCallState.status,
          hasKnownCall: true,
          isLocallyAnswering: false,
          isIncomingCallReportInFlight: false
        ) == .reportEndedCall
      )
      assert(
        callStateUpdateHandlingStrategy(
          validationAccepted: activeCallState.accepted,
          status: activeCallState.status,
          hasKnownCall: true,
          isLocallyAnswering: true,
          isIncomingCallReportInFlight: false
        ) == .ignore
      )
      assert(
        callStateUpdateEndedReason(status: "active", reason: nil) == .answeredElsewhere
      )

      let callStateRecipientMismatch = validateCallStateUpdatePayload(
        validCallStatePayload,
        authenticatedUserIdOverride: "someone-else"
      )
      assert(callStateRecipientMismatch.errorCode == "recipient_user_mismatch")

      let invalidCallStateStatus = validateCallStateUpdatePayload(
        validCallStatePayload.merging(["status": "ringing"]) { _, latest in latest },
        authenticatedUserIdOverride: "debug-user"
      )
      assert(invalidCallStateStatus.errorCode == "invalid_call_state_update_status")

      let activeStateUpdate = PendingCallStateUpdate(
        status: "active",
        reason: nil,
        endedAt: Date(timeIntervalSince1970: 1)
      )
      let endedStateUpdate = PendingCallStateUpdate(
        status: "ended",
        reason: nil,
        endedAt: Date(timeIntervalSince1970: 2)
      )
      assert(shouldReplaceRemoteCallStateUpdate(endedStateUpdate, existing: activeStateUpdate))
      assert(!shouldReplaceRemoteCallStateUpdate(activeStateUpdate, existing: endedStateUpdate))

      let expired = validateIncomingPayload(
        validPayload.merging(["expiresAt": "2020-01-01T00:00:00Z"]) { _, latest in latest },
        authenticatedUserIdOverride: "debug-user"
      )
      assert(expired.errorCode == "expired_incoming_call")
      assert(
        pushKitHandlingStrategy(validationAccepted: expired.accepted, existingState: nil)
          == .reportFallbackAndEnd
      )

      let recipientMismatch = validateIncomingPayload(
        validPayload,
        authenticatedUserIdOverride: "someone-else"
      )
      assert(recipientMismatch.errorCode == "recipient_user_mismatch")
      assert(
        pushKitHandlingStrategy(validationAccepted: recipientMismatch.accepted, existingState: nil)
          == .reportFallbackAndEnd
      )

      let supportedVideo = validateIncomingPayload(
        validPayload.merging(["callType": "VIDEO"]) { _, latest in latest },
        authenticatedUserIdOverride: "debug-user"
      )
      assert(supportedVideo.accepted)
      assert(supportedVideo.errorCode == nil)
      assert(
        pushKitHandlingStrategy(validationAccepted: supportedVideo.accepted, existingState: nil)
          == .reportValidatedIncomingCall
      )

      let unsupportedCallType = validateIncomingPayload(
        validPayload.merging(["callType": "SCREEN_SHARE"]) { _, latest in latest },
        authenticatedUserIdOverride: "debug-user"
      )
      assert(unsupportedCallType.errorCode == "unsupported_call_type")

      let activeUuid = UUID()
      assert(
        incomingCallState(
          callId: "duplicate-active",
          mappedUuid: activeUuid,
          isReported: true,
          isReporting: false,
          observedActiveCallUuids: [activeUuid]
        ) == .active(uuid: activeUuid)
      )
      assert(
        pushKitHandlingStrategy(
          validationAccepted: true,
          existingState: .active(uuid: activeUuid)
        ) == .reuseExistingCall(uuid: activeUuid)
      )

      let relaunchUuid = UUID()
      assert(
        incomingCallState(
          callId: "duplicate-after-relaunch",
          mappedUuid: relaunchUuid,
          isReported: true,
          isReporting: false,
          observedActiveCallUuids: [relaunchUuid]
        ) == .active(uuid: relaunchUuid)
      )

      let inFlightUuid = UUID()
      assert(
        incomingCallState(
          callId: "in-flight",
          mappedUuid: inFlightUuid,
          isReported: false,
          isReporting: true,
          observedActiveCallUuids: []
        ) == .reporting(uuid: inFlightUuid)
      )
      assert(
        pushKitHandlingStrategy(
          validationAccepted: true,
          existingState: .reporting(uuid: inFlightUuid)
        ) == .waitForInFlightReport
      )
    }
  #endif

  private func storePendingAction(action: String, callId: String, extra: [String: Any] = [:]) {
    let payload = payloadsByCallId[callId] ?? ["callId": callId]
    var record = payload
    record["action"] = action
    record["actionId"] = UUID().uuidString
    record["callId"] = callId
    if let uuid = uuidsByCallId[callId] {
      record["callUuid"] = uuid.uuidString
    }
    extra.forEach { key, value in
      record[key] = value
    }
    userDefaults.set(record, forKey: pendingActionStorageKey)
    eventSink?(callActionEvent, record)
  }

  private func validateIncomingPayload(_ payload: [String: Any]) -> (
    accepted: Bool,
    callId: String?,
    errorCode: String?,
    errorMessage: String?
  ) {
    validateIncomingPayload(payload, authenticatedUserIdOverride: nil)
  }

  private func validateIncomingPayload(
    _ payload: [String: Any],
    authenticatedUserIdOverride: String?
  ) -> (
    accepted: Bool,
    callId: String?,
    errorCode: String?,
    errorMessage: String?
  ) {
    guard payload["type"] as? String == "INCOMING_CALL" else {
      return (
        false,
        nonEmptyString(payload["callId"]),
        "invalid_voip_event_type",
        "VoIP pushes must contain an INCOMING_CALL event type."
      )
    }

    guard let callId = nonEmptyString(payload["callId"]) else {
      return (
        false,
        nil,
        "missing_call_id",
        "Incoming VoIP payload is missing a non-empty callId."
      )
    }

    if let callType = nonEmptyString(payload["callType"]),
       callType != "VOICE" && callType != "VIDEO" {
      return (
        false,
        callId,
        "unsupported_call_type",
        "VoIP incoming call reporting only supports VOICE or VIDEO calls."
      )
    }

    let callerId = nonEmptyString(payload["callerId"]) ?? nonEmptyString(payload["initiatorId"])
    let callerName = nonEmptyString(payload["callerName"])
      ?? nonEmptyString(payload["initiatorDisplayName"])

    if callerId == nil && callerName == nil {
      return (
        false,
        callId,
        "missing_caller_identity",
        "Incoming VoIP payload requires callerId or callerName."
      )
    }

    guard let recipientUserId = nonEmptyString(payload["recipientUserId"]) else {
      return (
        false,
        callId,
        "missing_recipient_user_id",
        "Incoming VoIP payload is missing recipientUserId."
      )
    }

    let authenticatedUserId = authenticatedUserIdOverride
      ?? userDefaults.string(forKey: authenticatedUserIdStorageKey)

    guard let authenticatedUserId else {
      return (
        false,
        callId,
        "missing_authenticated_user",
        "Incoming VoIP payload was received before the authenticated user was known."
      )
    }

    guard recipientUserId == authenticatedUserId else {
      return (
        false,
        callId,
        "recipient_user_mismatch",
        "Incoming VoIP payload recipientUserId did not match the authenticated user."
      )
    }

    let timestamp = nonEmptyString(payload["timestamp"]) ?? nonEmptyString(payload["sentAt"])
    let expiresAt = nonEmptyString(payload["expiresAt"])

    if timestamp == nil && expiresAt == nil {
      return (
        false,
        callId,
        "missing_timestamp",
        "Incoming VoIP payload requires timestamp or expiresAt."
      )
    }

    if let timestamp, parseIso8601Date(timestamp) == nil {
      return (
        false,
        callId,
        "invalid_timestamp",
        "Incoming VoIP payload timestamp was not a valid ISO-8601 date."
      )
    }

    if let expiresAt {
      guard let expirationDate = parseIso8601Date(expiresAt) else {
        return (
          false,
          callId,
          "invalid_expires_at",
          "Incoming VoIP payload expiresAt was not a valid ISO-8601 date."
        )
      }

      if expirationDate <= Date() {
        return (
          false,
          callId,
          "expired_incoming_call",
          "Incoming VoIP payload was already expired."
        )
      }
    }

    if payload.keys.contains(where: { $0 == "dedupeId" || $0 == "notificationId" || $0 == "pushId" }),
       dedupeIdentifier(from: payload) == nil {
      return (
        false,
        callId,
        "invalid_dedupe_identifier",
        "Incoming VoIP payload contained an empty dedupe identifier."
      )
    }

    return (true, callId, nil, nil)
  }

  private func validateCallStateUpdatePayload(
    _ payload: [String: Any],
    authenticatedUserIdOverride: String? = nil
  ) -> (
    accepted: Bool,
    callId: String?,
    status: String?,
    reason: String?,
    endedAt: Date?,
    errorCode: String?,
    errorMessage: String?
  ) {
    guard payload["type"] as? String == "CALL_STATE_UPDATE" else {
      return (
        false,
        nonEmptyString(payload["callId"]),
        nil,
        nil,
        nil,
        "invalid_call_state_update_type",
        "Remote call state updates must contain a CALL_STATE_UPDATE event type."
      )
    }

    guard let callId = nonEmptyString(payload["callId"]) else {
      return (
        false,
        nil,
        nil,
        nil,
        nil,
        "missing_call_id",
        "Remote call state update is missing a non-empty callId."
      )
    }

    guard let recipientUserId = nonEmptyString(payload["recipientUserId"]) else {
      return (
        false,
        callId,
        nil,
        nil,
        nil,
        "missing_recipient_user_id",
        "Remote call state update is missing recipientUserId."
      )
    }

    let authenticatedUserId = authenticatedUserIdOverride
      ?? userDefaults.string(forKey: authenticatedUserIdStorageKey)

    guard let authenticatedUserId else {
      return (
        false,
        callId,
        nil,
        nil,
        nil,
        "missing_authenticated_user",
        "Remote call state update was received before the authenticated user was known."
      )
    }

    guard recipientUserId == authenticatedUserId else {
      return (
        false,
        callId,
        nil,
        nil,
        nil,
        "recipient_user_mismatch",
        "Remote call state update recipientUserId did not match the authenticated user."
      )
    }

    guard let status = nonEmptyString(payload["status"]),
          ["active", "rejected", "ended", "cancelled"].contains(status) else {
      return (
        false,
        callId,
        nil,
        nil,
        nil,
        "invalid_call_state_update_status",
        "Remote call state update contained an unsupported call status."
      )
    }

    guard let at = nonEmptyString(payload["at"]),
          let endedAt = parseIso8601Date(at) else {
      return (
        false,
        callId,
        status,
        nonEmptyString(payload["reason"]),
        nil,
        "invalid_call_state_update_timestamp",
        "Remote call state update must contain a valid ISO-8601 at timestamp."
      )
    }

    return (
      true,
      callId,
      status,
      nonEmptyString(payload["reason"]),
      endedAt,
      nil,
      nil
    )
  }

  private func parseIso8601Date(_ value: String) -> Date? {
    let fractionalFormatter = ISO8601DateFormatter()
    fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

    if let date = fractionalFormatter.date(from: value) {
      return date
    }

    return ISO8601DateFormatter().date(from: value)
  }

  private func stringKeyedPayload(from payload: [AnyHashable: Any]) -> [String: Any] {
    var normalized: [String: Any] = [:]
    payload.forEach { key, value in
      if let stringKey = key as? String {
        normalized[stringKey] = value
      }
    }
    return normalized
  }

  private func callerName(from payload: [String: Any]) -> String {
    if let displayName = nonEmptyString(payload["callerName"])
      ?? nonEmptyString(payload["initiatorDisplayName"]) {
      return displayName
    }

    return "Velora call"
  }

  private func peerName(from payload: [String: Any]) -> String {
    if let peerName = payload["peerName"] as? String,
       !peerName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      return peerName
    }

    return "Velora call"
  }

  private func uuidForCallId(_ callId: String) -> UUID {
    if let uuid = uuidsByCallId[callId] {
      return uuid
    }

    let uuid = UUID()
    uuidsByCallId[callId] = uuid
    callIdsByUuid[uuid] = callId
    persistCallUuidMappings()
    return uuid
  }

  private func clearCall(callId: String) {
    cancelIncomingCallExpiration(callId: callId)
    if let uuid = uuidsByCallId.removeValue(forKey: callId) {
      callIdsByUuid.removeValue(forKey: uuid)
    }
    payloadsByCallId.removeValue(forKey: callId)
    programmaticEndingCallIds.remove(callId)
    activeCallIds.remove(callId)
    pendingAnswerCallIds.remove(callId)
    if activeCallIds.isEmpty {
      speakerOverrideEnabled = false
    }
    reportingIncomingCallIds.remove(callId)
    reportedIncomingCallIds.remove(callId)
    queuedIncomingCallReportCompletionsById.removeValue(forKey: callId)
    fallbackEndedIncomingCallReasonsById.removeValue(forKey: callId)
    pendingCallStateUpdatesByCallId.removeValue(forKey: callId)
    persistCallUuidMappings()
    persistReportedIncomingCallIds()
  }

  private func incomingCallExpirationDate(from payload: [String: Any]) -> Date? {
    guard let expiresAt = nonEmptyString(payload["expiresAt"]) else {
      return nil
    }

    return parseIso8601Date(expiresAt)
  }

  private func shouldEndIncomingCallAtExpiration(
    isActive: Bool,
    isAnswerPending: Bool
  ) -> Bool {
    !isActive && !isAnswerPending
  }

  private func scheduleIncomingCallExpiration(
    callId: String,
    uuid: UUID,
    expirationDate: Date
  ) {
    incomingCallExpirationWorkItemsByCallId.removeValue(forKey: callId)?.cancel()
    incomingCallExpiresAtByCallId[callId] = expirationDate
    persistIncomingCallExpirations()

    let workItem = DispatchWorkItem { [weak self] in
      self?.expireIncomingCall(
        callId: callId,
        uuid: uuid,
        expirationDate: expirationDate
      )
    }
    incomingCallExpirationWorkItemsByCallId[callId] = workItem
    DispatchQueue.main.asyncAfter(
      deadline: .now() + max(0, expirationDate.timeIntervalSinceNow),
      execute: workItem
    )
  }

  private func cancelIncomingCallExpiration(callId: String) {
    incomingCallExpirationWorkItemsByCallId.removeValue(forKey: callId)?.cancel()
    guard incomingCallExpiresAtByCallId.removeValue(forKey: callId) != nil else {
      return
    }
    persistIncomingCallExpirations()
  }

  private func expireIncomingCall(
    callId: String,
    uuid: UUID,
    expirationDate: Date
  ) {
    guard uuidsByCallId[callId] == uuid else {
      cancelIncomingCallExpiration(callId: callId)
      return
    }

    guard shouldEndIncomingCallAtExpiration(
      isActive: activeCallIds.contains(callId),
      isAnswerPending: pendingAnswerCallIds.contains(callId)
    ) else {
      cancelIncomingCallExpiration(callId: callId)
      return
    }

    let update = PendingCallStateUpdate(
      status: "ended",
      reason: "no_answer",
      endedAt: expirationDate
    )
    _ = storeRemoteCallStateUpdate(callId: callId, update: update)
    provider.reportCall(
      with: uuid,
      endedAt: expirationDate,
      reason: callStateUpdateEndedReason(status: update.status, reason: update.reason)
    )
    storePendingAction(
      action: "remote_end",
      callId: callId,
      extra: [
        "status": update.status,
        "reason": update.reason ?? "no_answer",
        "at": isoTimestamp(update.endedAt),
      ]
    )
    clearCall(callId: callId)
    logPhaseEvent(
      layer: "callkit",
      event: "incoming_call_expired_locally",
      callId: callId,
      callUuid: uuid,
      success: true,
      extra: ["endReason": stringValue(for: .unanswered)]
    )
  }

  private func restoreIncomingCallExpirations() {
    guard let storedExpirations = userDefaults.dictionary(
      forKey: incomingCallExpirationsStorageKey
    ) as? [String: String] else {
      return
    }

    storedExpirations.forEach { callId, expiresAt in
      guard let uuid = uuidsByCallId[callId],
            let expirationDate = parseIso8601Date(expiresAt) else {
        return
      }
      scheduleIncomingCallExpiration(
        callId: callId,
        uuid: uuid,
        expirationDate: expirationDate
      )
    }
  }

  private func persistIncomingCallExpirations() {
    if incomingCallExpiresAtByCallId.isEmpty {
      userDefaults.removeObject(forKey: incomingCallExpirationsStorageKey)
      return
    }

    let storedExpirations = incomingCallExpiresAtByCallId.mapValues(isoTimestamp)
    userDefaults.set(storedExpirations, forKey: incomingCallExpirationsStorageKey)
  }

  private func endCallsForAuthenticationTransition() {
    let activeNativeCalls = callIdsByUuid.map { (uuid: $0.key, callId: $0.value) }
    guard !activeNativeCalls.isEmpty else {
      return
    }

    activeNativeCalls.forEach { call in
      provider.reportCall(with: call.uuid, endedAt: Date(), reason: .remoteEnded)
      clearCall(callId: call.callId)
    }

    logPhaseEvent(
      layer: "callkit",
      event: "calls_ended_for_authentication_transition",
      success: true,
      extra: ["count": activeNativeCalls.count]
    )
  }

  private func storeRemoteCallStateUpdate(callId: String, update: PendingCallStateUpdate) -> Bool {
    pruneRemoteCallStateUpdates()
    if let existing = remoteCallStateUpdatesByCallId[callId],
       !shouldReplaceRemoteCallStateUpdate(update, existing: existing) {
      return false
    }

    remoteCallStateUpdatesByCallId[callId] = update
    persistRemoteCallStateUpdates()
    return true
  }

  private func shouldReplaceRemoteCallStateUpdate(
    _ candidate: PendingCallStateUpdate,
    existing: PendingCallStateUpdate
  ) -> Bool {
    if candidate.endedAt != existing.endedAt {
      return candidate.endedAt > existing.endedAt
    }

    return existing.status == "active" && candidate.status != "active"
  }

  private func restoreRemoteCallStateUpdates() {
    guard let storedUpdates = userDefaults.dictionary(forKey: remoteCallStateUpdatesStorageKey) else {
      return
    }

    storedUpdates.forEach { callId, value in
      guard let storedUpdate = value as? [String: Any],
            let status = nonEmptyString(storedUpdate["status"]),
            let at = nonEmptyString(storedUpdate["at"]),
            let endedAt = parseIso8601Date(at) else {
        return
      }

      remoteCallStateUpdatesByCallId[callId] = PendingCallStateUpdate(
        status: status,
        reason: nonEmptyString(storedUpdate["reason"]),
        endedAt: endedAt
      )
    }
    pruneRemoteCallStateUpdates()
  }

  private func pruneRemoteCallStateUpdates() {
    let cutoff = Date().addingTimeInterval(-remoteCallStateUpdateRetention)
    let staleCallIds = remoteCallStateUpdatesByCallId.compactMap { callId, update in
      update.endedAt < cutoff ? callId : nil
    }
    guard !staleCallIds.isEmpty else {
      return
    }

    staleCallIds.forEach { remoteCallStateUpdatesByCallId.removeValue(forKey: $0) }
    persistRemoteCallStateUpdates()
  }

  private func persistRemoteCallStateUpdates() {
    if remoteCallStateUpdatesByCallId.isEmpty {
      userDefaults.removeObject(forKey: remoteCallStateUpdatesStorageKey)
      return
    }

    let storedUpdates = remoteCallStateUpdatesByCallId.reduce(into: [String: [String: String]]()) {
      result,
      entry in
      var storedUpdate = [
        "status": entry.value.status,
        "at": isoTimestamp(entry.value.endedAt),
      ]
      if let reason = entry.value.reason {
        storedUpdate["reason"] = reason
      }
      result[entry.key] = storedUpdate
    }
    userDefaults.set(storedUpdates, forKey: remoteCallStateUpdatesStorageKey)
  }

  private func restoreCallUuidMappings() {
    guard let storedMappings = userDefaults.dictionary(forKey: callUuidStorageKey) as? [String: String]
    else {
      return
    }

    storedMappings.forEach { callId, uuidString in
      guard let uuid = UUID(uuidString: uuidString) else {
        return
      }

      uuidsByCallId[callId] = uuid
      callIdsByUuid[uuid] = callId
    }
  }

  private func persistCallUuidMappings() {
    if uuidsByCallId.isEmpty {
      userDefaults.removeObject(forKey: callUuidStorageKey)
      return
    }

    let storedMappings = uuidsByCallId.reduce(into: [String: String]()) { result, entry in
      result[entry.key] = entry.value.uuidString
    }
    userDefaults.set(storedMappings, forKey: callUuidStorageKey)
  }

  private func restoreReportedIncomingCallIds() {
    guard let storedCallIds = userDefaults.array(forKey: reportedIncomingCallIdsStorageKey) as? [String]
    else {
      return
    }

    reportedIncomingCallIds = Set(
      storedCallIds.filter { callId in
        uuidsByCallId[callId] != nil
      }
    )
    persistReportedIncomingCallIds()
  }

  private func persistReportedIncomingCallIds() {
    if reportedIncomingCallIds.isEmpty {
      userDefaults.removeObject(forKey: reportedIncomingCallIdsStorageKey)
      return
    }

    userDefaults.set(Array(reportedIncomingCallIds), forKey: reportedIncomingCallIdsStorageKey)
  }

  private func nonEmptyString(_ value: Any?) -> String? {
    guard let stringValue = value as? String else {
      return nil
    }

    let trimmed = stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  private func dedupeIdentifier(from payload: [String: Any]) -> String? {
    nonEmptyString(payload["dedupeId"])
      ?? nonEmptyString(payload["notificationId"])
      ?? nonEmptyString(payload["pushId"])
  }

  private func makeCallResult(
    success: Bool,
    callId: String? = nil,
    callUuid: UUID? = nil,
    errorCode: String? = nil,
    errorMessage: String? = nil
  ) -> [String: Any] {
    [
      "success": success,
      "callId": callId ?? NSNull(),
      "callUuid": callUuid?.uuidString ?? NSNull(),
      "errorCode": errorCode ?? NSNull(),
      "errorMessage": errorMessage ?? NSNull(),
    ]
  }

  private func clearCallIfObserverConfirmsMissing(callId: String, uuid: UUID) -> Bool {
    if callObserver.calls.contains(where: { $0.uuid == uuid && $0.hasEnded == false }) {
      return false
    }

    clearCall(callId: callId)
    logPhaseEvent(
      layer: "callkit",
      event: "stale_call_registry_cleared",
      callId: callId,
      callUuid: uuid,
      success: true
    )
    return true
  }

  private func callKitErrorCode(_ error: Error, fallback: String) -> String {
    let nsError = error as NSError
    if nsError.domain == CXErrorDomainRequestTransaction {
      switch nsError.code {
      case CXErrorCodeRequestTransactionError.unknownCallProvider.rawValue:
        return "callkit_unknown_call_provider"
      case CXErrorCodeRequestTransactionError.unentitled.rawValue:
        return "callkit_unentitled"
      case CXErrorCodeRequestTransactionError.unknownCallUUID.rawValue:
        return "callkit_unknown_call_uuid"
      case CXErrorCodeRequestTransactionError.callUUIDAlreadyExists.rawValue:
        return "callkit_call_uuid_exists"
      case CXErrorCodeRequestTransactionError.invalidAction.rawValue:
        return "callkit_invalid_action"
      case CXErrorCodeRequestTransactionError.maximumCallGroupsReached.rawValue:
        return "callkit_maximum_call_groups_reached"
      default:
        return fallback
      }
    }

    return fallback
  }

  private func sanitizedErrorMessage(_ error: Error, fallback: String) -> String {
    let message = (error as NSError).localizedDescription.trimmingCharacters(
      in: .whitespacesAndNewlines
    )
    return message.isEmpty ? fallback : message
  }

  private func elapsedMilliseconds(since startedAt: Date) -> Int {
    max(0, Int(Date().timeIntervalSince(startedAt) * 1000))
  }

  private func isoTimestamp(_ date: Date = Date()) -> String {
    ISO8601DateFormatter().string(from: date)
  }

  private func safeTokenPrefix(_ token: String?) -> String {
    guard let token else {
      return "none"
    }

    let prefix = String(token.prefix(12))
    return prefix.isEmpty ? "empty" : prefix
  }

  private func currentApnsEnvironment() -> String? {
    #if DEBUG
      return apnsEnvironment(isDebugBuild: true)
    #else
      return apnsEnvironment(isDebugBuild: false)
    #endif
  }

  private func apnsEnvironment(isDebugBuild: Bool) -> String {
    isDebugBuild ? "development" : "production"
  }

  private func currentAppState() -> String {
    switch UIApplication.shared.applicationState {
    case .active:
      return "active"
    case .inactive:
      return "inactive"
    case .background:
      return "background"
    @unknown default:
      return "unknown"
    }
  }

  private func logOperationalNotice(
    layer: String,
    event: String,
    callId: String? = nil,
    callUuid: UUID? = nil,
    success: Bool? = nil,
    errorCode: String? = nil,
    elapsedMs: Int? = nil,
    tokenPrefix: String? = nil
  ) {
    let bundleId = Bundle.main.bundleIdentifier ?? "unknown"
    let callIdValue = callId ?? "none"
    let callUuidValue = callUuid?.uuidString ?? "none"
    let successValue = success.map(String.init) ?? "unknown"
    let errorCodeValue = errorCode ?? "none"
    let elapsedValue = elapsedMs.map(String.init) ?? "none"
    let tokenPrefixValue = tokenPrefix ?? "none"
    let apnsEnvironment = currentApnsEnvironment() ?? "unknown"

    systemCallsLogger.notice(
      "layer=\(layer, privacy: .public) event=\(event, privacy: .public) callId=\(callIdValue, privacy: .public) callUuid=\(callUuidValue, privacy: .public) success=\(successValue, privacy: .public) errorCode=\(errorCodeValue, privacy: .public) elapsedMs=\(elapsedValue, privacy: .public) appState=\(self.currentAppState(), privacy: .public) processLaunchId=\(self.processLaunchId, privacy: .public) bundleId=\(bundleId, privacy: .public) apnsEnvironment=\(apnsEnvironment, privacy: .public) tokenPrefix=\(tokenPrefixValue, privacy: .public)"
    )
  }

  private func logPhaseEvent(
    layer: String,
    event: String,
    callId: String? = nil,
    callUuid: UUID? = nil,
    success: Bool? = nil,
    errorCode: String? = nil,
    errorMessage: String? = nil,
    elapsedMs: Int? = nil,
    extra: [String: Any] = [:]
  ) {
    var payload: [String: Any] = [
      "layer": layer,
      "event": event,
      "callId": callId ?? NSNull(),
      "callUuid": callUuid?.uuidString ?? NSNull(),
      "appState": currentAppState(),
      "processLaunchId": processLaunchId,
    ]

    if let success {
      payload["success"] = success
    }
    if let errorCode {
      payload["errorCode"] = errorCode
    }
    if let errorMessage {
      payload["errorMessage"] = errorMessage
    }
    if let elapsedMs {
      payload["elapsedMs"] = elapsedMs
    }
    extra.forEach { key, value in
      payload[key] = value
    }

    guard JSONSerialization.isValidJSONObject(payload),
          let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
          let encoded = String(data: data, encoding: .utf8) else {
      NSLog("VeloraSystemCalls %@", "\(payload)")
      return
    }

    NSLog("VeloraSystemCalls %@", encoded)
  }

  func activateSimulatorAudioSession(callId: String) -> Bool {
    #if targetEnvironment(simulator)
      let audioSession = AVAudioSession.sharedInstance()
      resetAudioConfigurationState()
      speakerOverrideEnabled = false
      do {
        try audioSession.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP, .allowBluetoothA2DP])
        try audioSession.setActive(true)
        isNativeAudioSessionActivated = true
        nativeAudioSessionActivatedAt = Date()
        nativeAudioSessionDeactivatedAt = nil
        nativeAudioSessionActivationSequence += 1
        nativeAudioSessionCallUuid = uuidsByCallId[callId]
        configureWebRtcAudioSession(audioSession)
        logOperationalNotice(layer: "simulator", event: "simulator_audio_session_activated", callId: callId, success: isAudioSessionConfigured)
        return isAudioSessionConfigured
      } catch {
        audioSessionConfigurationErrorCode = "simulator_audio_session_activation_failed"
        logOperationalNotice(layer: "simulator", event: "simulator_audio_session_activation_failed", callId: callId, success: false, errorCode: audioSessionConfigurationErrorCode)
        return false
      }
    #else
      return false
    #endif
  }

  func deactivateSimulatorAudioSession(callId: String) -> Bool {
    #if targetEnvironment(simulator)
      let audioSession = AVAudioSession.sharedInstance()
      RTCAudioSession.sharedInstance().isAudioEnabled = false
      do {
        try audioSession.setActive(false, options: .notifyOthersOnDeactivation)
      } catch {
        logOperationalNotice(layer: "simulator", event: "simulator_audio_session_deactivation_failed", callId: callId, success: false, errorCode: "simulator_audio_session_deactivation_failed")
        return false
      }
      isNativeAudioSessionActivated = false
      nativeAudioSessionDeactivatedAt = Date()
      nativeAudioSessionCallUuid = nil
      resetAudioConfigurationState()
      logOperationalNotice(layer: "simulator", event: "simulator_audio_session_deactivated", callId: callId, success: true)
      return true
    #else
      return false
    #endif
  }

  private func prepareWebRtcAudioSessionForCallKit(callId: String?, callUuid: UUID?) {
    let rtcAudioSession = RTCAudioSession.sharedInstance()
    rtcAudioSession.lockForConfiguration()
    defer {
      rtcAudioSession.unlockForConfiguration()
    }

    let configuration = RTCAudioSessionConfiguration.webRTC()
    configuration.category = AVAudioSession.Category.playAndRecord.rawValue
    configuration.mode = AVAudioSession.Mode.voiceChat.rawValue
    configuration.categoryOptions = [.allowBluetoothHFP, .allowBluetoothA2DP]

    do {
      _ = try rtcAudioSession.setConfiguration(configuration)
      logOperationalNotice(
        layer: "callkit",
        event: "audio_session_prepared_for_callkit",
        callId: callId,
        callUuid: callUuid,
        success: true
      )
    } catch {
      audioSessionConfigurationErrorCode = "audio_session_preparation_failed"
      logOperationalNotice(
        layer: "callkit",
        event: "audio_session_prepare_failed",
        callId: callId,
        callUuid: callUuid,
        success: false,
        errorCode: audioSessionConfigurationErrorCode
      )
      NSLog("VeloraSystemCalls failed to prepare WebRTC audio session for CallKit: \(error)")
    }
  }

  private func configureWebRtcAudioSession(_ audioSession: AVAudioSession) {
    let rtcAudioSession = RTCAudioSession.sharedInstance()
    rtcAudioSession.audioSessionDidActivate(audioSession)
    rtcAudioSession.lockForConfiguration()
    defer {
      rtcAudioSession.unlockForConfiguration()
    }

    let configuration = RTCAudioSessionConfiguration.webRTC()
    configuration.category = AVAudioSession.Category.playAndRecord.rawValue
    configuration.mode = AVAudioSession.Mode.voiceChat.rawValue
    configuration.categoryOptions = [.allowBluetoothHFP, .allowBluetoothA2DP]

    do {
      _ = try rtcAudioSession.setConfiguration(configuration)
    } catch {
      audioSessionConfigurationErrorCode = "audio_session_configuration_failed"
      NSLog("VeloraSystemCalls failed to configure WebRTC audio session: \(error)")
      emitAudioSessionConfigured(
        audioSession,
        errorCode: audioSessionConfigurationErrorCode
      )
      return
    }

    var routeErrorCode: String?
    if speakerOverrideEnabled {
      do {
        try audioSession.overrideOutputAudioPort(.speaker)
      } catch {
        routeErrorCode = "audio_route_override_failed"
        NSLog("VeloraSystemCalls failed to restore speaker route: \(error)")
      }
    }

    rtcAudioSession.isAudioEnabled = true
    isAudioSessionConfigured = true
    emitAudioSessionConfigured(audioSession, routeErrorCode: routeErrorCode)
  }

  private func resetAudioConfigurationState() {
    isAudioSessionConfigured = false
    audioSessionConfigurationErrorCode = nil
    lastAudioSessionConfiguration = nil
  }

  private func resetNativeAudioSessionState() {
    isNativeAudioSessionActivated = false
    nativeAudioSessionActivatedAt = nil
    nativeAudioSessionDeactivatedAt = nil
    nativeAudioSessionActivationSequence = 0
    nativeAudioSessionCallUuid = nil
  }

  private func currentAudioSessionCallUuid() -> UUID? {
    currentAudioSessionCallId().flatMap { uuidsByCallId[$0] }
  }

  private func currentAudioSessionCallId() -> String? {
    pendingAnswerCallIds.first ?? activeCallIds.first
  }

  private func emitAudioSessionConfigured(
    _ audioSession: AVAudioSession,
    errorCode: String? = nil,
    routeErrorCode: String? = nil
  ) {
    let configuredAt = Date()
    let configuredAtIso = ISO8601DateFormatter().string(from: configuredAt)
    let outputRouteTypes = audioSession.currentRoute.outputs.map(\.portType.rawValue)
    let inputRouteTypes = audioSession.currentRoute.inputs.map(\.portType.rawValue)

    var payload: [String: Any] = [
      "at": configuredAtIso,
      "timestampMs": Int(configuredAt.timeIntervalSince1970 * 1000),
      "category": audioSession.category.rawValue,
      "mode": audioSession.mode.rawValue,
      "outputRouteTypes": outputRouteTypes,
      "inputRouteTypes": inputRouteTypes,
      "forcedSpeaker": speakerOverrideEnabled,
    ]

    if let errorCode {
      payload["errorCode"] = errorCode
    }
    if let routeErrorCode {
      payload["routeErrorCode"] = routeErrorCode
    }

    lastAudioSessionConfiguration = payload
    eventSink?(audioSessionConfiguredEvent, payload)
  }
}

import AVFoundation
import CallKit
import ExpoModulesCore
import PushKit
import UIKit
import WebRTC

private let callActionEvent = "onCallAction"
private let voipTokenEvent = "onVoipTokenUpdated"
private let audioSessionActivatedEvent = "onAudioSessionActivated"
private let audioSessionConfiguredEvent = "onAudioSessionConfigured"
private let voipTokenStorageKey = "velora.calls.voipToken"
private let callUuidStorageKey = "velora.calls.uuidByCallId"
private let reportedIncomingCallIdsStorageKey = "velora.calls.reportedIncomingCallIds"
private let suppressedIncomingCallDeadlineStorageKey = "velora.calls.terminalDeadlines"
private let suppressedIncomingCallRetentionSeconds: TimeInterval = 10 * 60

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

    Function("clearPendingCallAction") { (actionId: String?) in
      let callCenter = VeloraSystemCallCenter.shared
      callCenter.runOnMain {
        callCenter.clearPendingCallAction(actionId: actionId)
      }
    }

    Function("presentIncomingCall") { (payload: [String: Any]) in
      let callCenter = VeloraSystemCallCenter.shared
      callCenter.runOnMain {
        callCenter.presentIncomingCall(payload: payload)
      }
    }

    Function("registerOutgoingCall") { (payload: [String: Any]) in
      let callCenter = VeloraSystemCallCenter.shared
      callCenter.runOnMain {
        callCenter.registerOutgoingCall(payload: payload)
      }
    }

    Function("setCallActive") { (callId: String) -> Bool in
      let callCenter = VeloraSystemCallCenter.shared
      return callCenter.runOnMain {
        callCenter.setCallActive(callId: callId)
      }
    }

    Function("endCall") { (callId: String) in
      let callCenter = VeloraSystemCallCenter.shared
      callCenter.runOnMain {
        callCenter.endCall(callId: callId)
      }
    }

    Function("dismissIncomingCall") { (callId: String) in
      let callCenter = VeloraSystemCallCenter.shared
      callCenter.runOnMain {
        callCenter.endCall(callId: callId)
      }
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
}

private final class VeloraSystemCallCenter: NSObject, PKPushRegistryDelegate, CXProviderDelegate {
  static let shared = VeloraSystemCallCenter()

  var eventSink: ((String, [String: Any]) -> Void)?
  private(set) var voipToken: String?

  private let userDefaults = UserDefaults.standard
  private let provider: CXProvider
  private let callController: CXCallController
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
  private var reportingIncomingCallIds = Set<String>()
  private var reportedIncomingCallIds = Set<String>()
  private var suppressedIncomingCallDeadlinesById: [String: TimeInterval] = [:]

  private override init() {
    let configuration = CXProviderConfiguration()
    configuration.supportsVideo = false
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
    restoreSuppressedIncomingCallDeadlines()
    provider.setDelegate(self, queue: .main)
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
    userDefaults.set(userId, forKey: "velora.calls.authenticatedUserId")
  }

  func pendingCallAction() -> [String: Any]? {
    userDefaults.dictionary(forKey: "velora.calls.pendingAction")
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

  func clearPendingCallAction(actionId: String?) {
    guard let actionId else {
      userDefaults.removeObject(forKey: "velora.calls.pendingAction")
      return
    }

    let pending = pendingCallAction()
    if pending?["actionId"] as? String == actionId {
      userDefaults.removeObject(forKey: "velora.calls.pendingAction")
    }
  }

  func presentIncomingCall(payload: [String: Any]) {
    reportIncomingCall(payload: payload, completion: nil)
  }

  private func reportIncomingCall(payload: [String: Any], completion: (() -> Void)?) {
    guard shouldAcceptIncomingPayload(payload),
          let callId = payload["callId"] as? String else {
      completion?()
      return
    }

    if reportedIncomingCallIds.contains(callId) || reportingIncomingCallIds.contains(callId) {
      payloadsByCallId[callId] = payload
      completion?()
      return
    }

    let uuid = uuidForCallId(callId)
    payloadsByCallId[callId] = payload
    reportingIncomingCallIds.insert(callId)

    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: callerName(from: payload))
    update.localizedCallerName = callerName(from: payload)
    update.hasVideo = false
    update.supportsHolding = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    update.supportsDTMF = false

    provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
      self?.reportingIncomingCallIds.remove(callId)

      if error != nil {
        self?.clearCall(callId: callId)
      } else {
        self?.reportedIncomingCallIds.insert(callId)
        self?.persistReportedIncomingCallIds()
      }

      completion?()
    }
  }

  func registerOutgoingCall(payload: [String: Any]) {
    guard let callId = payload["callId"] as? String else {
      return
    }

    resetAudioConfigurationState()
    let uuid = uuidForCallId(callId)
    payloadsByCallId[callId] = payload
    let action = CXStartCallAction(
      call: uuid,
      handle: CXHandle(type: .generic, value: peerName(from: payload))
    )
    action.isVideo = false

    callController.request(CXTransaction(action: action)) { [weak self] error in
      if error != nil {
        self?.clearCall(callId: callId)
      }
    }
  }

  func setCallActive(callId: String) -> Bool {
    guard let uuid = uuidsByCallId[callId], payloadsByCallId[callId] != nil else {
      NSLog("VeloraSystemCalls ignored setCallActive for unknown callId=%@", callId)
      return false
    }

    pendingAnswerCallIds.remove(callId)
    activeCallIds.insert(callId)

    if payloadsByCallId[callId]?["type"] as? String != "INCOMING_CALL" {
      provider.reportOutgoingCall(with: uuid, connectedAt: Date())
    }

    return true
  }

  func endCall(callId: String) {
    guard let uuid = uuidsByCallId[callId] else {
      return
    }

    programmaticEndingCallIds.insert(callId)
    let action = CXEndCallAction(call: uuid)
    callController.request(CXTransaction(action: action)) { [weak self] _ in
      self?.clearCall(callId: callId)
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

    eventSink?(voipTokenEvent, ["token": token])
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

    if normalizedPayload["type"] as? String == "CALL_STATE_UPDATE" {
      handleCallStateUpdate(payload: normalizedPayload)
      completion()
      return
    }

    reportIncomingCall(payload: normalizedPayload) {
      completion()
    }
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    guard let callId = callIdsByUuid[action.callUUID] else {
      action.fulfill()
      return
    }

    resetAudioConfigurationState()
    pendingAnswerCallIds.insert(callId)
    storePendingAction(action: "answer", callId: callId)
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
    guard callIdsByUuid[action.callUUID] != nil else {
      action.fulfill()
      return
    }

    provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: Date())
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    guard let callId = callIdsByUuid[action.callUUID] else {
      action.fulfill()
      return
    }

    let nativeAction = activeCallIds.contains(callId) ? "end" : "reject"

    if programmaticEndingCallIds.remove(callId) == nil {
      storePendingAction(action: nativeAction, callId: callId)
    }
    clearCall(callId: callId)
    action.fulfill()
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    resetAudioConfigurationState()
    let activatedAt = Date()
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
    resetAudioConfigurationState()
  }

  func providerDidReset(_ provider: CXProvider) {
    callIdsByUuid.removeAll()
    uuidsByCallId.removeAll()
    payloadsByCallId.removeAll()
    programmaticEndingCallIds.removeAll()
    activeCallIds.removeAll()
    pendingAnswerCallIds.removeAll()
    resetAudioConfigurationState()
    reportingIncomingCallIds.removeAll()
    reportedIncomingCallIds.removeAll()
    persistCallUuidMappings()
    persistReportedIncomingCallIds()
  }

  private func storePendingAction(action: String, callId: String) {
    let payload = payloadsByCallId[callId] ?? ["callId": callId]
    var record = payload
    record["action"] = action
    record["actionId"] = UUID().uuidString
    record["callId"] = callId
    userDefaults.set(record, forKey: "velora.calls.pendingAction")
    eventSink?(callActionEvent, record)
  }

  private func shouldAcceptIncomingPayload(_ payload: [String: Any]) -> Bool {
    guard payload["type"] as? String == "INCOMING_CALL",
          let callId = payload["callId"] as? String,
          payload["callType"] as? String != "VIDEO",
          let recipientUserId = payload["recipientUserId"] as? String,
          let authenticatedUserId = userDefaults.string(
            forKey: "velora.calls.authenticatedUserId"
          ),
          recipientUserId == authenticatedUserId else {
      return false
    }

    if isSuppressedIncomingCall(callId: callId) {
      return false
    }

    if let expiresAt = payload["expiresAt"] as? String,
       let expirationDate = parseIso8601Date(expiresAt),
       expirationDate <= Date() {
      return false
    }

    return true
  }

  private func handleCallStateUpdate(payload: [String: Any]) {
    guard let callId = payload["callId"] as? String,
          let status = payload["status"] as? String else {
      return
    }

    if status == "ended" || status == "rejected" || status == "cancelled" {
      markSuppressedIncomingCall(callId: callId)
      endCall(callId: callId)
      return
    }

    if status == "active" {
      markSuppressedIncomingCall(callId: callId)

      if activeCallIds.contains(callId) == false,
         payloadsByCallId[callId]?["type"] as? String == "INCOMING_CALL" {
        if pendingAnswerCallIds.remove(callId) != nil {
          activeCallIds.insert(callId)
          return
        }

        endCall(callId: callId)
      }
    }
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
    if let displayName = payload["initiatorDisplayName"] as? String,
       !displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
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
    if let uuid = uuidsByCallId.removeValue(forKey: callId) {
      callIdsByUuid.removeValue(forKey: uuid)
    }
    payloadsByCallId.removeValue(forKey: callId)
    programmaticEndingCallIds.remove(callId)
    activeCallIds.remove(callId)
    pendingAnswerCallIds.remove(callId)
    reportingIncomingCallIds.remove(callId)
    reportedIncomingCallIds.remove(callId)
    persistCallUuidMappings()
    persistReportedIncomingCallIds()
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

  private func restoreSuppressedIncomingCallDeadlines() {
    guard let storedDeadlines = userDefaults.dictionary(forKey: suppressedIncomingCallDeadlineStorageKey)
            as? [String: TimeInterval]
    else {
      return
    }

    suppressedIncomingCallDeadlinesById = storedDeadlines
    pruneExpiredSuppressedIncomingCalls()
  }

  private func persistSuppressedIncomingCallDeadlines() {
    if suppressedIncomingCallDeadlinesById.isEmpty {
      userDefaults.removeObject(forKey: suppressedIncomingCallDeadlineStorageKey)
      return
    }

    userDefaults.set(
      suppressedIncomingCallDeadlinesById,
      forKey: suppressedIncomingCallDeadlineStorageKey
    )
  }

  private func pruneExpiredSuppressedIncomingCalls(now: Date = Date()) {
    let nowInterval = now.timeIntervalSince1970
    suppressedIncomingCallDeadlinesById = suppressedIncomingCallDeadlinesById.filter {
      _, deadline in
      deadline > nowInterval
    }
    persistSuppressedIncomingCallDeadlines()
  }

  private func markSuppressedIncomingCall(callId: String, now: Date = Date()) {
    pruneExpiredSuppressedIncomingCalls(now: now)
    suppressedIncomingCallDeadlinesById[callId] = now
      .addingTimeInterval(suppressedIncomingCallRetentionSeconds)
      .timeIntervalSince1970
    persistSuppressedIncomingCallDeadlines()
  }

  private func isSuppressedIncomingCall(callId: String, now: Date = Date()) -> Bool {
    pruneExpiredSuppressedIncomingCalls(now: now)
    return suppressedIncomingCallDeadlinesById[callId] != nil
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

    rtcAudioSession.isAudioEnabled = true
    isAudioSessionConfigured = true
    emitAudioSessionConfigured(audioSession)
  }

  private func resetAudioConfigurationState() {
    isAudioSessionConfigured = false
    audioSessionConfigurationErrorCode = nil
    lastAudioSessionConfiguration = nil
  }

  private func emitAudioSessionConfigured(
    _ audioSession: AVAudioSession,
    errorCode: String? = nil
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
      "forcedSpeaker": false,
    ]

    if let errorCode {
      payload["errorCode"] = errorCode
    }

    lastAudioSessionConfiguration = payload
    eventSink?(audioSessionConfiguredEvent, payload)
  }
}

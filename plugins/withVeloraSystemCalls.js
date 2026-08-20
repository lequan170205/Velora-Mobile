const fs = require('fs')
const path = require('path')
const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withDangerousMod,
  withInfoPlist,
} = require('expo/config-plugins')

const ANDROID_PERMISSIONS = [
  'android.permission.MANAGE_OWN_CALLS',
  'android.permission.USE_FULL_SCREEN_INTENT',
  'android.permission.FOREGROUND_SERVICE_PHONE_CALL',
  'android.permission.VIBRATE',
]

const ensurePermission = (manifest, permissionName) => {
  manifest['uses-permission'] = manifest['uses-permission'] ?? []
  const exists = manifest['uses-permission'].some(
    (permission) => permission.$?.['android:name'] === permissionName,
  )

  if (!exists) {
    manifest['uses-permission'].push({
      $: {
        'android:name': permissionName,
      },
    })
  }
}

const ensureApplicationChild = (application, key, name, value) => {
  application[key] = application[key] ?? []
  const existing = application[key].find((entry) => entry.$?.['android:name'] === name)

  if (existing) {
    Object.assign(existing, value)
    return
  }

  application[key].push(value)
}

const removeApplicationChild = (application, key, name) => {
  if (!application[key]) return
  application[key] = application[key].filter((entry) => entry.$?.['android:name'] !== name)
}

const replaceRequired = (source, before, after, label) => {
  if (source.includes(after)) return source
  if (!source.includes(before)) {
    throw new Error(`withVeloraSystemCalls could not patch ${label}; expected source was not found`)
  }
  return source.replace(before, after)
}

const patchIosSystemCallsForVideo = (projectRoot) => {
  const swiftPath = path.join(
    projectRoot,
    'modules',
    'velora-system-calls',
    'ios',
    'VeloraSystemCallsModule.swift',
  )
  let source = fs.readFileSync(swiftPath, 'utf8')

  source = replaceRequired(
    source,
    'configuration.supportsVideo = false',
    'configuration.supportsVideo = true',
    'CXProviderConfiguration.supportsVideo',
  )
  source = replaceRequired(
    source,
    'let update = callUpdate(displayName: callerName(from: payload))',
    'let update = callUpdate(\n      displayName: callerName(from: payload),\n      isVideo: nonEmptyString(payload["callType"]) == "VIDEO"\n    )',
    'incoming CXCallUpdate call type',
  )
  source = replaceRequired(
    source,
    'action.isVideo = false',
    'action.isVideo = nonEmptyString(payload["callType"]) == "VIDEO"',
    'outgoing CXStartCallAction.isVideo',
  )
  source = replaceRequired(
    source,
    'private func callUpdate(displayName: String) -> CXCallUpdate {',
    'private func callUpdate(displayName: String, isVideo: Bool) -> CXCallUpdate {',
    'callUpdate signature',
  )
  source = replaceRequired(
    source,
    'update.hasVideo = false',
    'update.hasVideo = isVideo',
    'incoming CXCallUpdate.hasVideo',
  )

  fs.writeFileSync(swiftPath, source)
}

const withVeloraSystemCalls = (config) => {
  config = withInfoPlist(config, (plistConfig) => {
    const modes = new Set(plistConfig.modResults.UIBackgroundModes ?? [])
    modes.add('audio')
    modes.add('voip')
    modes.add('remote-notification')
    plistConfig.modResults.UIBackgroundModes = [...modes]
    return plistConfig
  })

  config = withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      patchIosSystemCallsForVideo(modConfig.modRequest.projectRoot)
      return modConfig
    },
  ])

  config = withAndroidManifest(config, (manifestConfig) => {
    const manifest = manifestConfig.modResults.manifest
    ANDROID_PERMISSIONS.forEach((permission) => ensurePermission(manifest, permission))

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifestConfig.modResults)

    removeApplicationChild(application, 'service', '.VeloraFirebaseMessagingService')
    removeApplicationChild(
      application,
      'service',
      'expo.modules.velorasystemcalls.VeloraFirebaseMessagingService',
    )
    ensureApplicationChild(
      application,
      'receiver',
      'expo.modules.velorasystemcalls.VeloraFirebaseMessagingReceiver',
      {
        $: {
          'android:name': 'expo.modules.velorasystemcalls.VeloraFirebaseMessagingReceiver',
          'android:exported': 'true',
          'android:permission': 'com.google.android.c2dm.permission.SEND',
        },
        'intent-filter': [
          {
            action: [
              {
                $: {
                  'android:name': 'com.google.android.c2dm.intent.RECEIVE',
                },
              },
            ],
          },
        ],
      },
    )

    ensureApplicationChild(
      application,
      'service',
      'expo.modules.velorasystemcalls.VeloraCallForegroundService',
      {
        $: {
          'android:name': 'expo.modules.velorasystemcalls.VeloraCallForegroundService',
          'android:exported': 'false',
          'android:foregroundServiceType': 'phoneCall|microphone',
        },
      },
    )

    ensureApplicationChild(
      application,
      'receiver',
      'expo.modules.velorasystemcalls.VeloraCallActionReceiver',
      {
        $: {
          'android:name': 'expo.modules.velorasystemcalls.VeloraCallActionReceiver',
          'android:exported': 'false',
        },
      },
    )

    ensureApplicationChild(
      application,
      'receiver',
      'expo.modules.velorasystemcalls.VeloraCallExpirationReceiver',
      {
        $: {
          'android:name': 'expo.modules.velorasystemcalls.VeloraCallExpirationReceiver',
          'android:exported': 'false',
        },
      },
    )

    ensureApplicationChild(
      application,
      'activity',
      'expo.modules.velorasystemcalls.VeloraIncomingCallActivity',
      {
        $: {
          'android:name': 'expo.modules.velorasystemcalls.VeloraIncomingCallActivity',
          'android:excludeFromRecents': 'true',
          'android:exported': 'false',
          'android:noHistory': 'true',
          'android:showOnLockScreen': 'true',
          'android:turnScreenOn': 'true',
        },
      },
    )

    return manifestConfig
  })

  return config
}

module.exports = createRunOncePlugin(withVeloraSystemCalls, 'with-velora-system-calls', '1.4.0')

const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withMainActivity,
} = require('expo/config-plugins')

const CHANNEL_ID = 'velora_messages'
const CHANNEL_NAME = 'Messages'
const CHANNEL_DESCRIPTION = 'Message notifications'

const addKotlinImport = (contents, importLine) => {
  if (contents.includes(importLine)) {
    return contents
  }

  return contents.replace(/^package .+\n/, (match) => `${match}\n${importLine}\n`)
}

const addCreateChannelCall = (contents) => {
  if (contents.includes('createVeloraNotificationChannel()')) {
    return contents
  }

  return contents.replace(
    /super\.onCreate\(null\)/,
    'super.onCreate(null)\n    createVeloraNotificationChannel()',
  )
}

const addCreateChannelMethod = (contents) => {
  if (contents.includes('private fun createVeloraNotificationChannel()')) {
    return contents
  }

  const method = `
  private fun createVeloraNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        "${CHANNEL_ID}",
        "${CHANNEL_NAME}",
        NotificationManager.IMPORTANCE_HIGH
      ).apply {
        description = "${CHANNEL_DESCRIPTION}"
        enableVibration(true)
      }

      val notificationManager =
        getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      notificationManager.createNotificationChannel(channel)
    }
  }
`

  return contents.replace(/\n}\s*$/, `${method}\n}`)
}

const withVeloraNotificationChannel = (config) => {
  config = withAndroidManifest(config, (manifestConfig) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(
      manifestConfig.modResults,
    )

    AndroidConfig.Manifest.addMetaDataItemToMainApplication(
      mainApplication,
      'com.google.firebase.messaging.default_notification_channel_id',
      CHANNEL_ID,
    )

    const channelMetaDataIndex = AndroidConfig.Manifest.findMetaDataItem(
      mainApplication,
      'com.google.firebase.messaging.default_notification_channel_id',
    )
    const channelMetaData =
      typeof channelMetaDataIndex === 'number'
        ? mainApplication['meta-data']?.[channelMetaDataIndex]
        : undefined

    if (channelMetaData?.$) {
      channelMetaData.$['tools:replace'] = 'android:value'
    }

    return manifestConfig
  })

  config = withMainActivity(config, (activityConfig) => {
    if (activityConfig.modResults.language !== 'kt') {
      throw new Error('Velora notification channel plugin only supports Kotlin MainActivity.')
    }

    let contents = activityConfig.modResults.contents

    contents = addKotlinImport(contents, 'import android.app.NotificationChannel')
    contents = addKotlinImport(contents, 'import android.app.NotificationManager')
    contents = addKotlinImport(contents, 'import android.content.Context')
    contents = addCreateChannelCall(contents)
    contents = addCreateChannelMethod(contents)

    activityConfig.modResults.contents = contents

    return activityConfig
  })

  return config
}

module.exports = createRunOncePlugin(
  withVeloraNotificationChannel,
  'with-velora-notification-channel',
  '1.0.0',
)

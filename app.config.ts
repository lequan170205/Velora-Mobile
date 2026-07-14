import appJson from './app.json'

type AppConfigWithIosOverrides = typeof appJson.expo & {
  ios?: {
    infoPlist?: Record<string, unknown>
    entitlements?: Record<string, unknown>
  }
}

const resolveApnsEnvironment = () => {
  const buildProfile = process.env.EAS_BUILD_PROFILE ?? 'development'
  return buildProfile === 'development' ? 'development' : 'production'
}

export default () => {
  const baseConfig = appJson.expo as AppConfigWithIosOverrides
  const apnsEnvironment = resolveApnsEnvironment()

  return {
    ...baseConfig,
    ios: {
      ...baseConfig.ios,
      infoPlist: {
        ...(baseConfig.ios?.infoPlist ?? {}),
        VeloraApnsEnvironment: apnsEnvironment,
      },
      entitlements: {
        ...(baseConfig.ios?.entitlements ?? {}),
        'aps-environment': apnsEnvironment,
      },
    },
  }
}

const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')

const config = getDefaultConfig(__dirname)

// react-native-webrtc imports the legacy `event-target-shim/index` subpath,
// which is not exposed by that package's modern `exports` map.
config.resolver.unstable_enablePackageExports = false

module.exports = withNativeWind(config, { input: './src/global.css' })

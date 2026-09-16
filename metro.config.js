const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')
const path = require('path')

const config = getDefaultConfig(__dirname)

// pnpm keeps app dependencies behind symlinks in its virtual store. Metro
// must follow those links when bundling in a clean CI checkout.
config.resolver.unstable_enableSymlinks = true
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')]

module.exports = withNativeWind(config, { input: './src/global.css' })

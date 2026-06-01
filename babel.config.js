module.exports = function (api) {
  api.cache(true)

  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }]],
    plugins: [
      ['@babel/plugin-transform-flow-strip-types', { allowDeclareFields: true }],
      ['@babel/plugin-proposal-decorators', { legacy: true }],
      'react-native-reanimated/plugin',
    ],
  }
}

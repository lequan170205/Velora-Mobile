const fs = require('fs')
const path = require('path')

const { withDangerousMod } = require('@expo/config-plugins')

const OLD_BLOCK = `installer.pods_project.targets.each do |target|
      if target.respond_to?(:product_type) and target.product_type == "com.apple.product-type.framework"
        target.build_configurations.each do |config|
          config.build_settings['CODE_SIGN_IDENTITY'] = ''
        end
      end
    end`

const NEW_BLOCK = `installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['CODE_SIGN_IDENTITY'] = ''
        config.build_settings['CODE_SIGNING_REQUIRED'] = 'NO'
        config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
      end
    end`

const MARKER = '# withPodfileCodeSign: broadened code signing fix applied'

const withPodfileCodeSign = (config) => {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile')

      if (!fs.existsSync(podfilePath)) {
        console.warn('[withPodfileCodeSign] Podfile not found, skipping.')
        return config
      }

      let contents = fs.readFileSync(podfilePath, 'utf-8')

      if (contents.includes(MARKER)) {
        return config
      }

      if (contents.includes(OLD_BLOCK)) {
        contents = contents.replace(OLD_BLOCK, `${MARKER}\n    ${NEW_BLOCK}`)
        fs.writeFileSync(podfilePath, contents, 'utf-8')
        console.log('[withPodfileCodeSign] Patched Podfile code signing block.')
      } else {
        console.warn(
          '[withPodfileCodeSign] Expected code signing block not found in Podfile. ' +
            'The React Native template may have changed — please check manually.',
        )
      }

      return config
    },
  ])
}

module.exports = withPodfileCodeSign

require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'VeloraSystemCalls'
  s.version        = package['version']
  s.summary        = 'Velora native system call bridge'
  s.description    = 'Native PushKit, CallKit, and Android system-call bridge for Velora.'
  s.author         = 'Velora'
  s.homepage       = 'https://github.com/velora/velora-mobile'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => 'https://github.com/velora/velora-mobile' }
  s.swift_version  = '5.9'
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'JitsiWebRTC', '~> 124.0.0'
  s.source_files = '**/*.{h,m,mm,swift}'
end

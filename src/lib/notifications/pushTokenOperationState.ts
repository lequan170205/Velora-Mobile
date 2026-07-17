import { deleteValueFor, getValueFor, save } from '../../utils/storage'

const INSTALLATION_ID_STORAGE_KEY = 'velora.notifications.installation-id'
const LEGACY_VOIP_INSTALLATION_ID_STORAGE_KEY = 'velora.calls.voipInstallationId'
const LIFECYCLE_VERSION_STORAGE_KEY = 'velora.notifications.lifecycle-version'
const REGISTRATION_BLOCK_STORAGE_KEY = 'velora.notifications.registration-blocked'
const MAX_LIFECYCLE_VERSION = 2_147_483_647

let lifecycleOperationQueue = Promise.resolve()
let registrationBlocked: boolean | null = null

const createInstallationId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`

const parseLifecycleVersion = (value: string | null) => {
  if (!value || !/^\d+$/.test(value)) {
    return 0
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

export const getOrCreatePushTokenInstallationId = async () => {
  const stored = await getValueFor(INSTALLATION_ID_STORAGE_KEY)
  if (stored) {
    return stored
  }

  const legacyVoipInstallationId = await getValueFor(LEGACY_VOIP_INSTALLATION_ID_STORAGE_KEY)
  if (legacyVoipInstallationId) {
    await save(INSTALLATION_ID_STORAGE_KEY, legacyVoipInstallationId)
    return legacyVoipInstallationId
  }

  const installationId = createInstallationId()
  await save(INSTALLATION_ID_STORAGE_KEY, installationId)
  return installationId
}

export const nextPushTokenLifecycleVersion = async () => {
  let nextVersion = 0
  const operation = lifecycleOperationQueue.then(async () => {
    const currentVersion = parseLifecycleVersion(await getValueFor(LIFECYCLE_VERSION_STORAGE_KEY))

    if (currentVersion >= MAX_LIFECYCLE_VERSION) {
      throw new Error('Push token lifecycle version exhausted')
    }

    nextVersion = currentVersion + 1
    await save(LIFECYCLE_VERSION_STORAGE_KEY, String(nextVersion))
  })

  lifecycleOperationQueue = operation.catch(() => undefined)
  await operation
  return nextVersion
}

export const blockPushTokenRegistration = async () => {
  registrationBlocked = true
  await save(REGISTRATION_BLOCK_STORAGE_KEY, '1')
}

export const resumePushTokenRegistration = async () => {
  registrationBlocked = false
  try {
    await deleteValueFor(REGISTRATION_BLOCK_STORAGE_KEY)
  } catch {
    // The in-memory state still lets this explicit new login register a token.
  }
}

export const isPushTokenRegistrationBlocked = async () => {
  if (registrationBlocked !== null) {
    return registrationBlocked
  }

  registrationBlocked = (await getValueFor(REGISTRATION_BLOCK_STORAGE_KEY)) === '1'
  return registrationBlocked
}

export const MAX_FULL_NAME_LENGTH = 80
export const MAX_USERNAME_LENGTH = 31
export const USERNAME_PATTERN = /^[A-Za-z0-9._]+$/

export const normalizeUsername = (value: string) =>
  value.replace(/^@+/, '').replace(/\s+/g, '').slice(0, MAX_USERNAME_LENGTH)

export const getUsernameError = (username: string) => {
  if (!username.trim()) return 'Choose a username.'
  if (!USERNAME_PATTERN.test(username)) return 'Use letters, numbers, periods, or underscores only.'
  return ''
}

export const getFullNameError = (fullName: string) => {
  if (!fullName.trim()) return 'Enter your full name.'
  if (fullName.trim().length > MAX_FULL_NAME_LENGTH) {
    return `Full name must be ${MAX_FULL_NAME_LENGTH} characters or less.`
  }

  return ''
}

export const getProfileHandle = (email?: string, username?: string | null) => {
  const normalizedUsername = username?.trim()

  if (normalizedUsername) {
    return normalizedUsername.replace(/^@+/, '')
  }

  const [localPart] = (email || '').trim().toLowerCase().split('@')
  return localPart || 'profile'
}

export const getDisplayName = ({
  email,
  firstName,
  fullName,
  lastName,
}: {
  email?: string | undefined
  firstName?: string | undefined
  fullName?: string | undefined
  lastName?: string | undefined
}) => {
  const normalizedFullName = fullName?.trim()

  if (normalizedFullName) {
    return normalizedFullName
  }

  const fallbackName = [firstName, lastName].filter(Boolean).join(' ').trim()
  if (fallbackName) {
    return fallbackName
  }

  return getProfileHandle(email)
}

export const getInitials = (value?: string | null) => {
  const tokens = value?.trim().split(/\s+/).filter(Boolean) || []

  if (tokens.length === 0) {
    return 'U'
  }

  if (tokens.length === 1) {
    return tokens[0].slice(0, 1).toUpperCase()
  }

  return `${tokens[0].slice(0, 1)}${tokens[tokens.length - 1].slice(0, 1)}`.toUpperCase()
}

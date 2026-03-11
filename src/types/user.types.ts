export interface UserSession {
  id: string
  email: string
  firstName: string
  lastName: string
  avatar?: string
  role: 'USER' | 'ADMIN'
  isEmailVerified: boolean
  createdAt: string
}

export interface UserSummary {
  id: string
  firstName: string
  lastName: string
  avatar?: string
}

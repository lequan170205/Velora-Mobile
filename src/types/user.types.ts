export interface UserSession {
  id: string
  email: string
  firstName: string
  lastName: string
  picture?: string
  role: 'USER' | 'ADMIN'
  isEmailVerified: boolean
  createdAt: string
}

export interface UserSummary {
  id: string
  email: string
  picture?: string
}

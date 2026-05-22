export const queryKeys = {
  conversations: {
    all: ['conversations'] as const,
    detail: (id: string) => ['conversations', id] as const,
    messages: (id: string) => ['conversations', id, 'messages'] as const,
    members: (id: string) => ['conversations', id, 'members'] as const,
  },
  friends: {
    all: ['friends'] as const,
    list: (userId?: string | null) => ['friends', 'list', userId ?? 'anonymous'] as const,
    incoming: (userId?: string | null) =>
      ['friends', 'incoming', 'pages', userId ?? 'anonymous'] as const,
    outgoing: (userId?: string | null) =>
      ['friends', 'outgoing', 'pages', userId ?? 'anonymous'] as const,
    status: (userId: string) => ['friends', 'status', userId] as const,
  },
  reels: {
    all: ['reels'] as const,
    list: (params?: Record<string, unknown>) => ['reels', 'list', params ?? {}] as const,
    detail: (id: string) => ['reels', id] as const,
  },
  users: {
    all: ['users'] as const,
    detail: (id: string) => ['users', id] as const,
    discover: (query: string) => ['users', 'discover', query] as const,
    publicProfile: (username: string) => ['users', 'public', username] as const,
    usernameAvailability: (username: string) =>
      ['users', 'username-availability', username] as const,
  },
}

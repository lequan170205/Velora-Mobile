export const queryKeys = {
  conversations: {
    all: ['conversations'] as const,
    detail: (id: string) => ['conversations', id] as const,
    messages: (id: string) => ['conversations', id, 'messages'] as const,
    members: (id: string) => ['conversations', id, 'members'] as const,
  },
  friends: {
    all: ['friends'] as const,
    list: () => ['friends', 'list'] as const,
    incoming: () => ['friends', 'incoming'] as const,
    outgoing: () => ['friends', 'outgoing'] as const,
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
    usernameAvailability: (username: string) =>
      ['users', 'username-availability', username] as const,
  },
}

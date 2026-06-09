export const queryKeys = {
  conversations: {
    all: ['conversations'] as const,
    detail: (id: string) => ['conversations', id] as const,
    messages: (id: string) => ['conversations', id, 'messages'] as const,
    messagesAroundRoot: (id: string) => ['conversations', id, 'messagesAround'] as const,
    messagesAround: (id: string, anchorMessageId: string) =>
      ['conversations', id, 'messagesAround', anchorMessageId] as const,
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
    lists: () => ['reels', 'list'] as const,
    list: (params?: Record<string, unknown>) => ['reels', 'list', params ?? {}] as const,
    contexts: () => ['reels', 'context'] as const,
    context: (id: string, params?: Record<string, unknown>) =>
      ['reels', 'context', id, params ?? {}] as const,
    pendingCreated: () => ['reels', 'pending-created'] as const,
    detail: (id: string) => ['reels', id] as const,
    status: (id: string) => ['reels', id, 'status'] as const,
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

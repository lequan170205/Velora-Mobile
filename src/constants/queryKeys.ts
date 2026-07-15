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
    viewer: (viewerId: string) => ['friends', viewerId] as const,
    list: (viewerId: string, targetUserId: string) =>
      ['friends', viewerId, 'list', targetUserId] as const,
    incoming: (viewerId: string) => ['friends', viewerId, 'incoming', 'pages'] as const,
    outgoing: (viewerId: string) => ['friends', viewerId, 'outgoing', 'pages'] as const,
    status: (viewerId: string, targetUserId: string) =>
      ['friends', viewerId, 'status', targetUserId] as const,
  },
  reels: {
    all: ['reels'] as const,
    viewerFeeds: (viewerId: string) => ['reels', viewerId] as const,
    friends: (viewerId: string) => ['reels', viewerId, 'friends'] as const,
    lists: () => ['reels', 'list'] as const,
    list: (params?: Record<string, unknown>) => ['reels', 'list', params ?? {}] as const,
    recommended: (viewerId: string, feedSessionId?: string) =>
      ['reels', viewerId, 'for-you', feedSessionId ?? 'new'] as const,
    contexts: () => ['reels', 'context'] as const,
    context: (id: string, params?: Record<string, unknown>) =>
      ['reels', 'context', id, params ?? {}] as const,
    pendingCreated: () => ['reels', 'pending-created'] as const,
    detail: (id: string) => ['reels', id] as const,
    status: (id: string) => ['reels', id, 'status'] as const,
  },
  search: {
    all: ['search'] as const,
    global: (q: string, type: 'all' | 'users' | 'reels', limit?: number) =>
      ['search', 'global', { q, type, limit: limit ?? null }] as const,
    suggestions: (type: 'all' | 'users' | 'reels', limit?: number) =>
      ['search', 'suggestions', { type, limit: limit ?? null }] as const,
  },
  users: {
    all: ['users'] as const,
    detail: (id: string) => ['users', id] as const,
    discover: (query: string) => ['users', 'discover', query] as const,
    recommended: (params: { userId?: string | null; feedSessionId: string; limit: number }) =>
      [
        'users',
        'recommended',
        {
          userId: params.userId ?? 'anonymous',
          feedSessionId: params.feedSessionId,
          limit: params.limit,
        },
      ] as const,
    publicProfile: (username: string) => ['users', 'public', username] as const,
    usernameAvailability: (username: string) =>
      ['users', 'username-availability', username] as const,
  },
}

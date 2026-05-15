export const queryKeys = {
  conversations: {
    all: ['conversations'] as const,
    detail: (id: string) => ['conversations', id] as const,
    messages: (id: string) => ['conversations', id, 'messages'] as const,
    members: (id: string) => ['conversations', id, 'members'] as const,
  },
  reels: {
    all: ['reels'] as const,
    list: (params?: Record<string, unknown>) => ['reels', 'list', params ?? {}] as const,
    detail: (id: string) => ['reels', id] as const,
  },
  users: {
    all: ['users'] as const,
    detail: (id: string) => ['users', id] as const,
  },
}

import type { MaterialIcons } from '@expo/vector-icons'

import { colors } from '../../../constants/theme'

import type { MD3Theme } from 'react-native-paper'

export type MessageContextActionId = 'reply' | 'copy' | 'save' | 'forward' | 'recall'

export interface MessageContextActionConfig {
  id: MessageContextActionId
  icon: React.ComponentProps<typeof MaterialIcons>['name']
  label: string
  destructive: boolean
}

export interface MessageContextMenuTokens {
  backdrop: string
  surface: string
  surfacePressed: string
  border: string
  divider: string
  textPrimary: string
  textSecondary: string
  textInverse: string
  accent: string
  danger: string
  dangerSoft: string
  incomingBubble: string
  metaChip: string
  shadow: string
}

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢'] as const

export const EXTENDED_EMOJIS = [
  '😀',
  '😃',
  '😄',
  '😁',
  '😆',
  '😅',
  '😂',
  '🤣',
  '😊',
  '😇',
  '🙂',
  '🙃',
  '😉',
  '😌',
  '😍',
  '🥰',
  '😘',
  '😗',
  '😙',
  '😚',
  '😋',
  '😛',
  '😝',
  '😜',
  '🤪',
  '🤨',
  '🧐',
  '🤓',
  '😎',
  '🤩',
  '🥳',
  '😏',
  '😒',
  '😞',
  '😔',
  '😟',
  '😕',
  '🙁',
  '☹️',
  '😣',
  '😖',
  '😫',
  '😩',
  '🥺',
  '😢',
  '😭',
  '😤',
  '😠',
  '😡',
  '🤬',
  '🤯',
  '😳',
  '🥵',
  '🥶',
  '😱',
  '😨',
  '😰',
  '😥',
  '😓',
  '🤗',
  '🤔',
  '🤭',
  '🤫',
  '🤥',
  '😶',
  '😐',
  '😑',
  '😬',
  '🙄',
  '😯',
  '😦',
  '😧',
  '😮',
  '😲',
  '🥱',
  '😴',
  '🤤',
  '😪',
  '😵',
  '🤐',
  '👍',
  '👎',
  '👏',
  '🙌',
  '👐',
  '🤲',
  '🤝',
  '🙏',
  '✌️',
  '🤞',
  '❤️',
  '💔',
  '🔥',
  '💯',
  '✨',
  '⭐',
  '🌟',
  '🎉',
  '🎊',
  '🎈',
] as const

export const MESSAGE_CONTEXT_ACTIONS: readonly MessageContextActionConfig[] = [
  {
    id: 'reply',
    icon: 'reply',
    label: 'Trả lời',
    destructive: false,
  },
  {
    id: 'copy',
    icon: 'content-copy',
    label: 'Sao chép',
    destructive: false,
  },
  {
    id: 'save',
    icon: 'file-download',
    label: 'Lưu vào thiết bị',
    destructive: false,
  },
  {
    id: 'forward',
    icon: 'forward',
    label: 'Chuyển tiếp',
    destructive: false,
  },
  {
    id: 'recall',
    icon: 'delete-outline',
    label: 'Thu hồi',
    destructive: true,
  },
] as const

export const RECALL_WINDOW_MS = 24 * 60 * 60 * 1000
export const RESTRICTED_MESSAGE_TYPES = ['system', 'call', 'call_log'] as const

export const EDGE_MARGIN = 16
export const SAFE_VERTICAL = 48
export const GAP = 10
export const REACTION_BAR_H = 48
export const ACTION_ROW_H = 44
export const MENU_MIN_W = 280
export const MENU_MAX_W = 340

export const IOS_MENU_SPRING = { damping: 16, stiffness: 320, mass: 0.6 } as const
export const PICKER_SPRING = { damping: 22, stiffness: 260, mass: 0.6 } as const

export function getMessageContextMenuTokens(theme: MD3Theme): MessageContextMenuTokens {
  return {
    backdrop: 'rgba(0,0,0,0.22)',
    surface: theme.colors.elevation.level1,
    surfacePressed: colors.bg.glassBorder,
    border: theme.colors.outline,
    divider: theme.colors.outline,
    textPrimary: theme.colors.onSurface,
    textSecondary: theme.colors.onSurfaceVariant,
    textInverse: theme.colors.onPrimary,
    accent: theme.colors.primary,
    danger: theme.colors.error,
    dangerSoft: 'rgba(255,59,48,0.12)',
    incomingBubble: colors.bubble.incoming,
    metaChip: theme.colors.surfaceVariant,
    shadow: '#000000',
  }
}

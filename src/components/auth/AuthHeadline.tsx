import { Text } from 'react-native'

import { cn } from '../../lib/cn'

type AuthHeadlineSize = 'hero' | 'section'

// Single source for auth display headings. Hero marks the two primary screens
// (login, register); section is every secondary flow screen behind
// AuthFlowLayout. Values are fixed here so screens cannot drift apart.
const SIZE_CLASS: Record<AuthHeadlineSize, string> = {
  // 38px keeps "Back to the group?" on one line down to 393pt-wide screens.
  hero: 'font-heading text-[38px] leading-[42px] tracking-[-1.1px] text-text-primary',
  section: 'font-heading text-[32px] leading-[38px] tracking-[-0.6px] text-text-primary',
}

export function AuthHeadline({
  size = 'section',
  title,
  className,
}: {
  size?: AuthHeadlineSize
  title: string
  className?: string
}) {
  return <Text className={cn(SIZE_CLASS[size], className)}>{title}</Text>
}

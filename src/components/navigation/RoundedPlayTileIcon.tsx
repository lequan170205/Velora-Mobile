import React from 'react'
import Svg, { Path, Rect } from 'react-native-svg'

type RoundedPlayTileIconProps = {
  active: boolean
  color: string
  size: number
}

export const RoundedPlayTileIcon = React.memo(function RoundedPlayTileIcon({
  active,
  color,
  size,
}: RoundedPlayTileIconProps) {
  const strokeWidth = active ? 2.1 : 1.75

  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Rect
        fill="none"
        height={18}
        rx={5}
        stroke={color}
        strokeWidth={strokeWidth}
        width={18}
        x={3}
        y={3}
      />
      <Path
        d="M10 8.7v6.6l5.5-3.3z"
        fill="none"
        stroke={color}
        strokeLinejoin="round"
        strokeWidth={1.8}
      />
    </Svg>
  )
})

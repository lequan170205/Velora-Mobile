import { Children, isValidElement, type ReactNode } from 'react'
import { View } from 'react-native'

export function VideoParticipantGrid({
  children,
  isLandscape,
}: {
  children: ReactNode
  isLandscape: boolean
}) {
  const tiles = Children.toArray(children)
  const columns = Math.max(1, tiles.length === 2 && !isLandscape ? 1 : Math.min(2, tiles.length))
  const rows = Array.from({ length: Math.ceil(tiles.length / columns) }, (_, rowIndex) =>
    tiles.slice(rowIndex * columns, (rowIndex + 1) * columns),
  )

  return (
    <View className="flex-1" style={{ gap: 3 }}>
      {rows.map((row, rowIndex) => (
        <View key={`video-row-${rowIndex}`} className="flex-1 flex-row" style={{ gap: 3 }}>
          {row.map((tile, tileIndex) => (
            <View
              key={
                isValidElement(tile) && tile.key !== null
                  ? String(tile.key)
                  : `video-tile-${rowIndex}-${tileIndex}`
              }
              className="flex-1"
            >
              {tile}
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}

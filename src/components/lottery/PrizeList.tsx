import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useTranslations } from '@/i18n'
import type { Prize } from '@/types'
import { cn } from '@/lib/utils'

interface PrizeListProps {
  prizes: Prize[]
  className?: string
}

export function PrizeList({ prizes, className }: PrizeListProps) {
  const t = useTranslations()

  if (prizes.length === 0) {
    return (
      <div className={cn('text-center py-8', className)}>
        <p className="text-muted-foreground">{t.admin.prizes.noPrizes}</p>
      </div>
    )
  }

  // Sort prizes by sortOrder
  const sortedPrizes = [...prizes].sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <div className={cn('space-y-2', className)}>
      {sortedPrizes.map((prize) => (
        <Card key={prize.id}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-muted-foreground">
                    #{prize.sortOrder}
                  </span>
                  <h3 className="font-semibold">{prize.name}</h3>
                </div>
                {prize.description && (
                  <p className="text-sm text-muted-foreground">
                    {prize.description}
                  </p>
                )}
                {prize.winnerId && (
                  <Badge variant="secondary" className="mt-2">
                    {t.participant.drawing.winner}
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

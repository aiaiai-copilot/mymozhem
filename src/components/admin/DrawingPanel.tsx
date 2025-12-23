import { DrawingControls } from '@/components/lottery/DrawingControls'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTranslations } from '@/i18n'
import type { Room, Prize, Participant } from '@/types'
import { cn } from '@/lib/utils'

interface DrawingPanelProps {
  room: Room
  prizes: Prize[]
  participants: Participant[]
  onStartDrawing: () => void
  className?: string
}

export function DrawingPanel({
  room,
  prizes,
  participants,
  onStartDrawing,
  className,
}: DrawingPanelProps) {
  const t = useTranslations()

  const getStatusBadge = () => {
    switch (room.status) {
      case 'waiting':
        return (
          <Badge variant="outline">
            {t.participant.waiting.title}
          </Badge>
        )
      case 'drawing':
        return (
          <Badge variant="default">
            {t.participant.drawing.title}
          </Badge>
        )
      case 'finished':
        return (
          <Badge variant="secondary">
            {t.participant.finished.title}
          </Badge>
        )
    }
  }

  const winnerPrizes = prizes.filter(p => p.winnerId)

  return (
    <div className={cn('space-y-4', className)}>
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>{t.admin.dashboard.roomStatus}</CardTitle>
            {getStatusBadge()}
          </div>
        </CardHeader>
        <CardContent>
          <DrawingControls
            room={room}
            prizes={prizes}
            participants={participants}
            onStartDrawing={onStartDrawing}
          />
        </CardContent>
      </Card>

      {room.status === 'finished' && winnerPrizes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t.participant.finished.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {winnerPrizes.map((prize) => {
                const winner = participants.find(p => p.id === prize.winnerId)
                return (
                  <div
                    key={prize.id}
                    className="flex justify-between items-center p-3 border rounded-lg"
                  >
                    <div>
                      <p className="font-semibold">{prize.name}</p>
                      {prize.description && (
                        <p className="text-sm text-muted-foreground">
                          {prize.description}
                        </p>
                      )}
                    </div>
                    <Badge variant="default">
                      {winner?.name || '—'}
                    </Badge>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

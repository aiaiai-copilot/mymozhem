import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useTranslations } from '@/i18n'
import type { Room, Prize, Participant } from '@/types'
import { cn } from '@/lib/utils'

interface DrawingControlsProps {
  room: Room
  prizes: Prize[]
  participants: Participant[]
  onStartDrawing: () => void
  className?: string
}

export function DrawingControls({
  room,
  prizes,
  participants,
  onStartDrawing,
  className,
}: DrawingControlsProps) {
  const t = useTranslations()

  const errors: string[] = []

  if (prizes.length === 0) {
    errors.push(t.admin.errors.noPrizes)
  }

  if (participants.length === 0) {
    errors.push(t.admin.errors.notEnoughParticipants)
  }

  if (room.registrationOpen) {
    errors.push(t.admin.errors.registrationStillOpen)
  }

  const canStartDrawing = errors.length === 0 && room.status === 'waiting'
  const isDrawing = room.status === 'drawing'

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center gap-4 flex-wrap">
        <Badge variant="outline">
          {t.admin.prizes.title}: {prizes.length}
        </Badge>
        <Badge variant="outline">
          {t.admin.dashboard.participants}: {participants.length}
        </Badge>
        <Badge variant={room.registrationOpen ? 'default' : 'secondary'}>
          {room.registrationOpen
            ? t.admin.dashboard.registrationOpen
            : t.admin.dashboard.registrationClosed
          }
        </Badge>
      </div>

      {errors.length > 0 && (
        <div className="space-y-1">
          {errors.map((error, index) => (
            <p key={index} className="text-sm text-destructive">
              • {error}
            </p>
          ))}
        </div>
      )}

      <Button
        onClick={onStartDrawing}
        disabled={!canStartDrawing || isDrawing}
        size="lg"
        className="w-full md:w-auto"
      >
        {isDrawing ? t.participant.drawing.title : t.admin.dashboard.startDrawing}
      </Button>
    </div>
  )
}

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useTranslations } from '@/i18n'
import type { Participant } from '@/types'
import { cn } from '@/lib/utils'

interface ParticipantListProps {
  participants: Participant[]
  className?: string
}

export function ParticipantList({ participants, className }: ParticipantListProps) {
  const t = useTranslations()

  if (participants.length === 0) {
    return (
      <div className={cn('text-center py-8', className)}>
        <p className="text-muted-foreground">{t.admin.participants.noParticipants}</p>
      </div>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="mb-4">
        <Badge variant="outline">
          {t.admin.dashboard.participants}: {participants.length}
        </Badge>
      </div>

      {participants.map((participant) => (
        <Card key={participant.id}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {participant.hasWon && (
                  <span className="text-xl" aria-label={t.admin.participants.winner}>
                    🏆
                  </span>
                )}
                <span className="font-medium">{participant.name}</span>
              </div>
              <Badge variant={participant.hasWon ? 'default' : 'secondary'}>
                {participant.hasWon ? t.admin.participants.winner : t.admin.participants.waiting}
              </Badge>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

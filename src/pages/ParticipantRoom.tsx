import { useParams } from 'react-router-dom'
import { useTranslations } from '@/i18n'
import { useRoomByPublicId } from '@/hooks/useRoomByPublicId'
import { usePrizes } from '@/hooks/usePrizes'
import { useParticipants } from '@/hooks/useParticipants'
import {
  ParticipantRegistration,
  WinnerDisplay,
  PrizeList,
  ParticipantList,
} from '@/components/lottery'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export function ParticipantRoom() {
  const { publicId } = useParams<{ publicId: string }>()
  const t = useTranslations()

  const { room, loading: roomLoading, error: roomError } = useRoomByPublicId(publicId || '')
  const { prizes, loading: prizesLoading } = usePrizes(room?.id)
  const { participants, loading: participantsLoading } = useParticipants(room?.id)

  // Loading state
  if (roomLoading || prizesLoading || participantsLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    )
  }

  // Error state
  if (roomError || !room) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="text-destructive text-center">
              {t.errors.roomNotFound}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-center">
              {t.errors.general}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // State machine based on room status
  const renderContent = () => {
    switch (room.status) {
      case 'waiting':
        if (room.registrationOpen) {
          return (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-center">
                    {t.participant.join.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ParticipantRegistration roomId={room.id} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t.admin.participants.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ParticipantList participants={participants || []} />
                </CardContent>
              </Card>
            </div>
          )
        } else {
          return (
            <Card>
              <CardHeader>
                <CardTitle className="text-center">
                  {t.participant.waiting.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-center space-y-4">
                <p className="text-lg text-muted-foreground">
                  {t.participant.waiting.registrationClosed}
                </p>
                <p className="text-base text-muted-foreground">
                  {t.participant.waiting.drawingStartsSoon}
                </p>
                <div className="pt-4">
                  <p className="text-sm text-muted-foreground">
                    {t.participant.waiting.participants}: {participants?.length || 0}
                  </p>
                </div>
              </CardContent>
            </Card>
          )
        }

      case 'drawing': {
        const currentPrize = prizes?.find((_, idx) => idx === room.currentPrizeIndex)
        const winner = currentPrize
          ? participants?.find(p => p.prizeId === currentPrize.id)
          : undefined

        if (currentPrize && winner) {
          return <WinnerDisplay prize={currentPrize} winner={winner} />
        }

        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-center">
                {t.participant.drawing.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-lg text-muted-foreground">
                {t.participant.waiting.drawingStartsSoon}
              </p>
            </CardContent>
          </Card>
        )
      }

      case 'finished':
        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-center">
                {t.participant.finished.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PrizeList prizes={prizes || []} />
            </CardContent>
          </Card>
        )

      default:
        return null
    }
  }

  return (
    <div className={cn(
      'min-h-screen flex items-center justify-center p-4',
      'bg-gradient-to-b from-blue-50 to-indigo-100'
    )}>
      <div className="max-w-md w-full space-y-6">
        <h1 className="text-3xl md:text-4xl font-bold text-center text-primary">
          {room.name}
        </h1>
        {renderContent()}
      </div>
    </div>
  )
}

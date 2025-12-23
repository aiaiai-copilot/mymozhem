import { useParams } from 'react-router-dom'
import { useTranslations } from '@/i18n'
import { useRoomBySecretId } from '@/hooks/useRoomBySecretId'
import { usePrizes } from '@/hooks/usePrizes'
import { useParticipants } from '@/hooks/useParticipants'
import {
  DashboardLayout,
  DashboardSection,
  PrizeManagement,
  ParticipantManagement,
  DrawingPanel,
} from '@/components/admin'
import { RoomInfoCard } from '@/components/lottery'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export function AdminDashboard() {
  const { secretId } = useParams<{ secretId: string }>()
  const t = useTranslations()

  const { room, loading: roomLoading, error: roomError } = useRoomBySecretId(secretId || '')
  const { prizes, loading: prizesLoading } = usePrizes(room?.id)
  const { participants, loading: participantsLoading } = useParticipants(room?.id)

  const handleStartDrawing = () => {
    // TODO: Implement drawing logic in Phase 5
    console.log('Starting drawing...', { room, prizes, participants })
  }

  // Loading state
  if (roomLoading) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="container mx-auto space-y-6">
          <Skeleton className="h-12 w-64" />
          <div className="grid gap-6 md:gap-8">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        </div>
      </div>
    )
  }

  // Error state
  if (roomError || !room) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="text-destructive">
              {t.errors.roomNotFound}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              {t.errors.general}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <DashboardLayout roomName={room.name}>
      <DashboardSection title={t.admin.dashboard.roomStatus}>
        {roomLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <RoomInfoCard room={room} />
        )}
      </DashboardSection>

      <DashboardSection title={t.admin.prizes.title}>
        {prizesLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <PrizeManagement roomId={room.id} prizes={prizes || []} />
        )}
      </DashboardSection>

      <DashboardSection title={t.admin.participants.title}>
        {participantsLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <ParticipantManagement room={room} participants={participants || []} />
        )}
      </DashboardSection>

      <DashboardSection title={t.admin.dashboard.startDrawing}>
        <DrawingPanel
          room={room}
          prizes={prizes || []}
          participants={participants || []}
          onStartDrawing={handleStartDrawing}
        />
      </DashboardSection>
    </DashboardLayout>
  )
}

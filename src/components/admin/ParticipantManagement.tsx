import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useTranslations } from '@/i18n'
import { useRoomActions } from '@/hooks/useRoomActions'
import { ParticipantList } from '@/components/lottery/ParticipantList'
import type { Room, Participant } from '@/types'
import { cn } from '@/lib/utils'

interface ParticipantManagementProps {
  room: Room
  participants: Participant[]
  onRoomUpdated?: () => void
  className?: string
}

export function ParticipantManagement({
  room,
  participants,
  onRoomUpdated,
  className,
}: ParticipantManagementProps) {
  const t = useTranslations()
  const { updateRoom, loading } = useRoomActions()

  const handleToggleRegistration = async () => {
    try {
      await updateRoom(room.id, {
        registrationOpen: !room.registrationOpen,
      })
      onRoomUpdated?.()
    } catch (err) {
      console.error('Failed to toggle registration:', err)
    }
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold">{t.admin.participants.title}</h3>
          <Badge variant={room.registrationOpen ? 'default' : 'secondary'}>
            {room.registrationOpen
              ? t.admin.dashboard.registrationOpen
              : t.admin.dashboard.registrationClosed
            }
          </Badge>
        </div>

        <Button
          onClick={handleToggleRegistration}
          variant="outline"
          disabled={loading}
        >
          {loading
            ? t.common.loading
            : room.registrationOpen
            ? t.common.close + ' ' + t.admin.dashboard.registration
            : t.common.open + ' ' + t.admin.dashboard.registration
          }
        </Button>
      </div>

      <ParticipantList participants={participants} />
    </div>
  )
}

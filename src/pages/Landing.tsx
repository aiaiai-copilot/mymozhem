import { useNavigate } from 'react-router-dom'
import { useTranslations } from '@/i18n'
import { RoomCreationForm } from '@/components/lottery'
import type { Room } from '@/types'
import { cn } from '@/lib/utils'

export function Landing() {
  const t = useTranslations()
  const navigate = useNavigate()

  const handleRoomCreated = (room: Room) => {
    navigate(`/admin/${room.secretId}`)
  }

  return (
    <div className={cn(
      'min-h-screen flex flex-col items-center justify-center p-4',
      'bg-gradient-to-b from-blue-50 to-indigo-100'
    )}>
      <div className="max-w-md w-full space-y-8">
        <div className="text-center space-y-4">
          <h1 className="text-4xl md:text-5xl font-bold text-primary">
            {t.landing.title}
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground">
            {t.landing.subtitle}
          </p>
          <p className="text-base text-muted-foreground">
            {t.landing.description}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-6 md:p-8">
          <h2 className="text-2xl font-semibold mb-6 text-center">
            {t.room.create.title}
          </h2>
          <RoomCreationForm onSuccess={handleRoomCreated} />
        </div>
      </div>
    </div>
  )
}

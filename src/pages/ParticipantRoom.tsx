import { useParams } from 'react-router-dom'
import { useTranslations } from '@/i18n'

export function ParticipantRoom() {
  const { publicId } = useParams<{ publicId: string }>()
  const t = useTranslations()

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-6">
        <h1 className="text-3xl font-bold text-center">
          {t.participant.join.title}
        </h1>
        <div className="text-center text-muted-foreground">
          Room: {publicId}
        </div>
        <div className="p-6 border rounded-lg">
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium">{t.participant.join.enterName}</span>
              <input
                type="text"
                placeholder={t.participant.join.namePlaceholder}
                className="mt-2 w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
            <button className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg font-semibold hover:opacity-90 transition-opacity">
              {t.participant.join.submit}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

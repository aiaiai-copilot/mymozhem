import { useParams } from 'react-router-dom'
import { useTranslations } from '@/i18n'

export function AdminDashboard() {
  const { secretId } = useParams<{ secretId: string }>()
  const t = useTranslations()

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold">
          {t.admin.dashboard.title}
        </h1>
        <div className="text-muted-foreground">
          Secret ID: {secretId}
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="p-6 border rounded-lg">
            <h2 className="text-xl font-semibold mb-4">{t.admin.prizes.title}</h2>
            <p className="text-muted-foreground">{t.admin.prizes.noPrizes}</p>
          </div>
          <div className="p-6 border rounded-lg">
            <h2 className="text-xl font-semibold mb-4">{t.admin.participants.title}</h2>
            <p className="text-muted-foreground">{t.admin.participants.noParticipants}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

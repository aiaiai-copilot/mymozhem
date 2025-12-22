import { useTranslations } from '@/i18n'

export function Landing() {
  const t = useTranslations()

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="max-w-2xl w-full text-center space-y-8">
        <h1 className="text-4xl md:text-6xl font-bold">
          {t.landing.title}
        </h1>
        <p className="text-xl text-muted-foreground">
          {t.landing.subtitle}
        </p>
        <p className="text-lg text-muted-foreground">
          {t.landing.description}
        </p>
        <div>
          <button className="px-8 py-4 bg-primary text-primary-foreground rounded-lg text-lg font-semibold hover:opacity-90 transition-opacity">
            {t.landing.createLottery}
          </button>
        </div>
      </div>
    </div>
  )
}

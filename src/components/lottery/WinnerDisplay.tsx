import { motion } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTranslations } from '@/i18n'
import type { Prize, Participant } from '@/types'
import { cn } from '@/lib/utils'

interface WinnerDisplayProps {
  prize: Prize
  winner: Participant
  className?: string
}

export function WinnerDisplay({ prize, winner, className }: WinnerDisplayProps) {
  const t = useTranslations()

  return (
    <Card className={cn('', className)}>
      <CardHeader>
        <CardTitle>{t.participant.drawing.currentPrize}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="text-center space-y-2">
          <h3 className="text-2xl font-bold">{prize.name}</h3>
          {prize.description && (
            <p className="text-muted-foreground">{prize.description}</p>
          )}
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            duration: 0.8,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="relative"
        >
          <div className="text-center space-y-4">
            <motion.div
              initial={{ y: 20 }}
              animate={{ y: 0 }}
              transition={{
                delay: 0.3,
                duration: 0.6,
              }}
            >
              <p className="text-sm text-muted-foreground uppercase tracking-wide">
                {t.participant.drawing.winner}
              </p>
              <p className="text-4xl font-bold text-primary mt-2">
                {winner.name}
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{
                delay: 0.6,
                duration: 0.5,
              }}
              className="text-6xl"
            >
              🎉
            </motion.div>
          </div>

          {/* Particle effects */}
          <motion.div
            className="absolute inset-0 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            transition={{
              duration: 2,
              ease: "easeInOut",
            }}
          >
            {[...Array(8)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute w-2 h-2 bg-primary rounded-full"
                initial={{
                  x: '50%',
                  y: '50%',
                }}
                animate={{
                  x: `${50 + Math.cos((i / 8) * Math.PI * 2) * 150}%`,
                  y: `${50 + Math.sin((i / 8) * Math.PI * 2) * 150}%`,
                  opacity: 0,
                }}
                transition={{
                  duration: 1.5,
                  delay: 0.5,
                }}
              />
            ))}
          </motion.div>
        </motion.div>
      </CardContent>
    </Card>
  )
}

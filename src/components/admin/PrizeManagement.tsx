import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import { PrizeList } from '@/components/lottery/PrizeList'
import { PrizeForm } from '@/components/lottery/PrizeForm'
import type { Prize } from '@/types'
import { cn } from '@/lib/utils'

interface PrizeManagementProps {
  roomId: string
  prizes: Prize[]
  onPrizeUpdated?: () => void
  className?: string
}

export function PrizeManagement({
  roomId,
  prizes,
  onPrizeUpdated,
  className,
}: PrizeManagementProps) {
  const t = useTranslations()
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [selectedPrize, setSelectedPrize] = useState<Prize | undefined>()

  const handleAddPrize = () => {
    setSelectedPrize(undefined)
    setIsFormOpen(true)
  }

  const handleFormSuccess = () => {
    setIsFormOpen(false)
    setSelectedPrize(undefined)
    onPrizeUpdated?.()
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">{t.admin.prizes.title}</h3>
        <Button onClick={handleAddPrize}>
          {t.admin.prizes.add}
        </Button>
      </div>

      <PrizeList prizes={prizes} />

      <PrizeForm
        roomId={roomId}
        prize={selectedPrize}
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        onSuccess={handleFormSuccess}
      />
    </div>
  )
}

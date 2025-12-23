import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTranslations } from '@/i18n'
import { usePrizeActions } from '@/hooks/usePrizeActions'
import type { Prize } from '@/types'

interface PrizeFormProps {
  roomId: string
  prize?: Prize
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function PrizeForm({
  roomId,
  prize,
  open,
  onOpenChange,
  onSuccess
}: PrizeFormProps) {
  const t = useTranslations()
  const { addPrize, updatePrize, loading } = usePrizeActions()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const isEditing = !!prize

  useEffect(() => {
    if (prize) {
      setName(prize.name)
      setDescription(prize.description || '')
    } else {
      setName('')
      setDescription('')
    }
    setError(null)
  }, [prize, open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError(t.errors.invalidInput)
      return
    }

    try {
      if (isEditing) {
        await updatePrize(prize.id, {
          name: name.trim(),
          description: description.trim() || undefined,
        })
      } else {
        await addPrize(roomId, name.trim(), description.trim() || undefined)
      }
      onOpenChange(false)
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.error)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t.common.edit : t.admin.prizes.add}
          </DialogTitle>
          <DialogDescription>
            {isEditing ? '' : t.admin.prizes.title}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="prize-name">{t.admin.prizes.name}</Label>
            <Input
              id="prize-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.admin.prizes.namePlaceholder}
              disabled={loading}
              aria-invalid={!!error}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="prize-description">{t.admin.prizes.description}</Label>
            <Input
              id="prize-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.admin.prizes.descriptionPlaceholder}
              disabled={loading}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading ? t.common.loading : t.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

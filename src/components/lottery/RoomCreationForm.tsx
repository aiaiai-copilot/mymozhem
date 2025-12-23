import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTranslations } from '@/i18n'
import { useRoomActions } from '@/hooks/useRoomActions'
import type { Room } from '@/types'

interface RoomCreationFormProps {
  onSuccess?: (room: Room) => void
  disabled?: boolean
}

export function RoomCreationForm({ onSuccess, disabled }: RoomCreationFormProps) {
  const t = useTranslations()
  const { createRoom, loading } = useRoomActions()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError(t.errors.invalidInput)
      return
    }

    if (name.trim().length < 3) {
      setError(t.errors.invalidInput)
      return
    }

    try {
      const room = await createRoom({ name: name.trim() })
      setName('')
      onSuccess?.(room)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.error)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="room-name">{t.room.create.roomName}</Label>
        <Input
          id="room-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.room.create.roomNamePlaceholder}
          disabled={loading || disabled}
          aria-invalid={!!error}
          aria-describedby={error ? 'room-name-error' : undefined}
          className="w-full"
        />
        {error && (
          <p id="room-name-error" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <Button
        type="submit"
        disabled={loading || disabled || !name.trim()}
        className="w-full"
      >
        {loading ? t.common.loading : t.common.create}
      </Button>
    </form>
  )
}

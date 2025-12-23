import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTranslations } from '@/i18n'
import { useParticipantActions } from '@/hooks/useParticipantActions'
import type { Participant } from '@/types'

interface ParticipantRegistrationProps {
  roomId: string
  onSuccess?: (participant: Participant) => void
  disabled?: boolean
}

export function ParticipantRegistration({
  roomId,
  onSuccess,
  disabled
}: ParticipantRegistrationProps) {
  const t = useTranslations()
  const { addParticipant, loading } = useParticipantActions()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError(t.errors.invalidInput)
      return
    }

    try {
      const participant = await addParticipant(roomId, name.trim())
      setName('')
      onSuccess?.(participant)
    } catch (err) {
      // Handle duplicate name error
      if (err instanceof Error && err.message.includes('duplicate')) {
        setError(t.errors.nameTaken)
      } else {
        setError(err instanceof Error ? err.message : t.common.error)
      }
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="participant-name">{t.participant.join.enterName}</Label>
        <Input
          id="participant-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.participant.join.namePlaceholder}
          disabled={loading || disabled}
          aria-invalid={!!error}
          aria-describedby={error ? 'participant-name-error' : undefined}
          className="w-full"
        />
        {error && (
          <p id="participant-name-error" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <Button
        type="submit"
        disabled={loading || disabled || !name.trim()}
        className="w-full"
      >
        {loading ? t.common.loading : t.participant.join.submit}
      </Button>
    </form>
  )
}

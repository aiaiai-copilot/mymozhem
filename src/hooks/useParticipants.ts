import { useState, useEffect } from 'react'
import { lotteryRepository } from '../repositories/supabase.lottery.repository'
import type { Participant } from '../types'

export function useParticipants(roomId: string | undefined) {
  const [participants, setParticipants] = useState<Participant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!roomId) {
      setLoading(false)
      return
    }

    setLoading(true)
    lotteryRepository
      .getParticipants(roomId)
      .then(setParticipants)
      .catch(setError)
      .finally(() => setLoading(false))

    const unsub = lotteryRepository.subscribeToParticipants(roomId, setParticipants)
    return unsub
  }, [roomId])

  return { participants, loading, error }
}

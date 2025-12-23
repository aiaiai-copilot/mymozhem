import { useState, useCallback } from 'react'
import { lotteryRepository } from '../repositories/supabase.lottery.repository'
import type { Participant } from '../types'

export function useParticipantActions() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const addParticipant = useCallback(async (roomId: string, name: string) => {
    setLoading(true)
    setError(null)
    try {
      return await lotteryRepository.addParticipant(roomId, name)
    } catch (err) {
      setError(err as Error)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const updateParticipant = useCallback(async (id: string, updates: Partial<Participant>) => {
    setLoading(true)
    setError(null)
    try {
      return await lotteryRepository.updateParticipant(id, updates)
    } catch (err) {
      setError(err as Error)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  return { addParticipant, updateParticipant, loading, error }
}

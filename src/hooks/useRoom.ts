import { useState, useEffect } from 'react'
import { lotteryRepository } from '../repositories/supabase.lottery.repository'
import type { Room } from '../types'

export function useRoom(roomId: string | undefined) {
  const [room, setRoom] = useState<Room | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!roomId) {
      setLoading(false)
      return
    }

    setLoading(true)
    lotteryRepository
      .getRoom(roomId)
      .then(setRoom)
      .catch(setError)
      .finally(() => setLoading(false))

    const unsub = lotteryRepository.subscribeToRoom(roomId, setRoom)
    return unsub
  }, [roomId])

  return { room, loading, error }
}

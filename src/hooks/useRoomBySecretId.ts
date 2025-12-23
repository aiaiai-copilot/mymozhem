import { useState, useEffect } from 'react'
import { lotteryRepository } from '../repositories/supabase.lottery.repository'
import type { Room } from '../types'

export function useRoomBySecretId(secretId: string | undefined) {
  const [room, setRoom] = useState<Room | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!secretId) {
      setLoading(false)
      return
    }

    setLoading(true)
    lotteryRepository
      .getRoomBySecretId(secretId)
      .then(setRoom)
      .catch(setError)
      .finally(() => setLoading(false))

    // Subscribe to room updates once we have the room ID
    let unsub: (() => void) | undefined

    lotteryRepository.getRoomBySecretId(secretId).then((fetchedRoom) => {
      if (fetchedRoom) {
        unsub = lotteryRepository.subscribeToRoom(fetchedRoom.id, setRoom)
      }
    })

    return () => {
      if (unsub) unsub()
    }
  }, [secretId])

  return { room, loading, error }
}

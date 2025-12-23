import { useState, useEffect } from 'react'
import { lotteryRepository } from '../repositories/supabase.lottery.repository'
import type { Prize } from '../types'

export function usePrizes(roomId: string | undefined) {
  const [prizes, setPrizes] = useState<Prize[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!roomId) {
      setLoading(false)
      return
    }

    setLoading(true)
    lotteryRepository
      .getPrizes(roomId)
      .then(setPrizes)
      .catch(setError)
      .finally(() => setLoading(false))

    const unsub = lotteryRepository.subscribeToPrizes(roomId, setPrizes)
    return unsub
  }, [roomId])

  return { prizes, loading, error }
}

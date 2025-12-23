import { useState, useCallback } from 'react'
import { lotteryRepository } from '../repositories/supabase.lottery.repository'
import type { Prize } from '../types'

export function usePrizeActions() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const addPrize = useCallback(async (
    roomId: string,
    name: string,
    description?: string,
    order?: number
  ) => {
    setLoading(true)
    setError(null)
    try {
      return await lotteryRepository.addPrize(roomId, name, description, order)
    } catch (err) {
      setError(err as Error)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const updatePrize = useCallback(async (id: string, updates: Partial<Prize>) => {
    setLoading(true)
    setError(null)
    try {
      return await lotteryRepository.updatePrize(id, updates)
    } catch (err) {
      setError(err as Error)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const deletePrize = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      await lotteryRepository.deletePrize(id)
    } catch (err) {
      setError(err as Error)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  return { addPrize, updatePrize, deletePrize, loading, error }
}

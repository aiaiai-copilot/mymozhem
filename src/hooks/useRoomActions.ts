import { useState, useCallback } from 'react'
import { lotteryRepository } from '../repositories/supabase.lottery.repository'
import type { CreateRoomData, Room } from '../types'

export function useRoomActions() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const createRoom = useCallback(async (data: CreateRoomData) => {
    setLoading(true)
    setError(null)
    try {
      return await lotteryRepository.createRoom(data)
    } catch (err) {
      setError(err as Error)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const updateRoom = useCallback(async (id: string, data: Partial<Room>) => {
    setLoading(true)
    setError(null)
    try {
      return await lotteryRepository.updateRoom(id, data)
    } catch (err) {
      setError(err as Error)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const deleteRoom = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      await lotteryRepository.deleteRoom(id)
    } catch (err) {
      setError(err as Error)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  return { createRoom, updateRoom, deleteRoom, loading, error }
}

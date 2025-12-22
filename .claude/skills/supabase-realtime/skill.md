---
name: supabase-realtime
description: Supabase Realtime subscription patterns for MyMozhem. Use when implementing live updates, participant synchronization, or database subscriptions. Includes hooks and broadcast patterns.
---

# Supabase Realtime Skill

Patterns for real-time synchronization in MyMozhem.

## Basic Subscription Hook

```typescript
// src/hooks/useRealtimeSubscription.ts
import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'

interface UseRealtimeOptions<T> {
  table: string
  filter?: { column: string; value: string }
  onInsert?: (record: T) => void
  onUpdate?: (record: T) => void
  onDelete?: (oldRecord: { id: string }) => void
}

export function useRealtimeSubscription<T extends { id: string }>({
  table,
  filter,
  onInsert,
  onUpdate,
  onDelete,
}: UseRealtimeOptions<T>) {
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    const channel = supabase
      .channel(`${table}-${filter?.value ?? 'all'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter: filter ? `${filter.column}=eq.${filter.value}` : undefined,
        },
        (payload: RealtimePostgresChangesPayload<T>) => {
          switch (payload.eventType) {
            case 'INSERT':
              onInsert?.(payload.new as T)
              break
            case 'UPDATE':
              onUpdate?.(payload.new as T)
              break
            case 'DELETE':
              onDelete?.(payload.old as { id: string })
              break
          }
        }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      channel.unsubscribe()
    }
  }, [table, filter?.column, filter?.value, onInsert, onUpdate, onDelete])

  return channelRef.current
}
```

## Room-Specific Hook

```typescript
// src/hooks/useRoomRealtime.ts
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Room, Participant, Prize } from '@/types'

interface RoomState {
  room: Room | null
  participants: Participant[]
  prizes: Prize[]
  isLoading: boolean
  error: Error | null
}

export function useRoomRealtime(roomId: string): RoomState {
  const [state, setState] = useState<RoomState>({
    room: null,
    participants: [],
    prizes: [],
    isLoading: true,
    error: null,
  })

  // Initial fetch
  useEffect(() => {
    async function fetchInitialData() {
      try {
        const [roomRes, participantsRes, prizesRes] = await Promise.all([
          supabase.from('rooms').select('*').eq('id', roomId).single(),
          supabase.from('participants').select('*').eq('room_id', roomId),
          supabase.from('prizes').select('*').eq('room_id', roomId).order('sort_order'),
        ])

        if (roomRes.error) throw roomRes.error

        setState({
          room: roomRes.data,
          participants: participantsRes.data ?? [],
          prizes: prizesRes.data ?? [],
          isLoading: false,
          error: null,
        })
      } catch (err) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: err instanceof Error ? err : new Error('Failed to fetch room data'),
        }))
      }
    }

    fetchInitialData()
  }, [roomId])

  // Real-time subscriptions
  useEffect(() => {
    const channel = supabase
      .channel(`room-${roomId}`)
      // Room changes
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        (payload) => {
          setState(prev => ({ ...prev, room: payload.new as Room }))
        }
      )
      // Participant INSERT
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'participants', filter: `room_id=eq.${roomId}` },
        (payload) => {
          setState(prev => ({
            ...prev,
            participants: [...prev.participants, payload.new as Participant],
          }))
        }
      )
      // Participant UPDATE
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'participants', filter: `room_id=eq.${roomId}` },
        (payload) => {
          setState(prev => ({
            ...prev,
            participants: prev.participants.map(p =>
              p.id === payload.new.id ? (payload.new as Participant) : p
            ),
          }))
        }
      )
      // Prize UPDATE
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'prizes', filter: `room_id=eq.${roomId}` },
        (payload) => {
          setState(prev => ({
            ...prev,
            prizes: prev.prizes.map(p =>
              p.id === payload.new.id ? (payload.new as Prize) : p
            ),
          }))
        }
      )
      .subscribe()

    return () => {
      channel.unsubscribe()
    }
  }, [roomId])

  return state
}
```

## Broadcast (Ephemeral Events)

For events that don't need database persistence (like animations):

```typescript
// src/hooks/useDrawingBroadcast.ts
import { useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'

type DrawingEvent =
  | { type: 'DRAWING_STARTED' }
  | { type: 'WINNER_REVEALED'; prizeId: string; winnerId: string; winnerName: string; prizeName: string }
  | { type: 'DRAWING_COMPLETE' }

export function useDrawingBroadcast(
  roomId: string,
  onEvent: (event: DrawingEvent) => void
) {
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    const channel = supabase
      .channel(`drawing-${roomId}`)
      .on('broadcast', { event: 'drawing' }, ({ payload }) => {
        onEvent(payload as DrawingEvent)
      })
      .subscribe()

    channelRef.current = channel

    return () => {
      channel.unsubscribe()
    }
  }, [roomId, onEvent])

  const broadcast = useCallback(
    async (event: DrawingEvent) => {
      if (channelRef.current) {
        await channelRef.current.send({
          type: 'broadcast',
          event: 'drawing',
          payload: event,
        })
      }
    },
    []
  )

  return { broadcast }
}
```

## Error Handling

```typescript
// Always handle subscription errors
channel.subscribe((status, err) => {
  if (status === 'CHANNEL_ERROR') {
    console.error('Realtime subscription error:', err)
    // Show user-friendly error message
    // Consider retry logic
  }
  if (status === 'TIMED_OUT') {
    console.warn('Realtime subscription timed out, retrying...')
    // Channel will auto-retry
  }
})
```

## Performance Tips

1. **Filter subscriptions** — Always use filters to reduce payload
2. **Unsubscribe on unmount** — Prevent memory leaks
3. **Debounce rapid updates** — For high-frequency changes
4. **Use broadcast for ephemeral data** — Don't persist animation events
5. **Batch state updates** — Use functional setState to prevent stale closures

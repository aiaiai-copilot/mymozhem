import { useRoomByPublicId } from '../../hooks/useRoomByPublicId'
import { usePrizes } from '../../hooks/usePrizes'
import { useParticipants } from '../../hooks/useParticipants'
import { useRoomActions } from '../../hooks/useRoomActions'

export function HookTest() {
  const { room, loading: roomLoading, error: roomError } = useRoomByPublicId('NY2025-001')
  const { prizes, loading: prizesLoading, error: prizesError } = usePrizes(room?.id)
  const { participants, loading: participantsLoading, error: participantsError } = useParticipants(room?.id)
  const { createRoom, loading: actionLoading, error: actionError } = useRoomActions()

  const handleCreateRoom = async () => {
    try {
      const newRoom = await createRoom({ name: 'Test Room' })
      console.log('Room created:', newRoom)
    } catch (err) {
      console.error('Failed to create room:', err)
    }
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h2>Hook Test Component</h2>

      <section style={{ marginBottom: '20px' }}>
        <h3>Room Data</h3>
        {roomLoading && <p>Loading room...</p>}
        {roomError && <p style={{ color: 'red' }}>Error: {roomError.message}</p>}
        {room && (
          <div>
            <p>Name: {room.name}</p>
            <p>Public ID: {room.publicId}</p>
            <p>Status: {room.status}</p>
            <p>Registration: {room.registrationOpen ? 'Open' : 'Closed'}</p>
          </div>
        )}
        {!roomLoading && !room && !roomError && <p>No room found</p>}
      </section>

      <section style={{ marginBottom: '20px' }}>
        <h3>Prizes</h3>
        {prizesLoading && <p>Loading prizes...</p>}
        {prizesError && <p style={{ color: 'red' }}>Error: {prizesError.message}</p>}
        <p>Count: {prizes?.length || 0}</p>
        {prizes && prizes.length > 0 && (
          <ul>
            {prizes.map(prize => (
              <li key={prize.id}>{prize.name} - {prize.description}</li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginBottom: '20px' }}>
        <h3>Participants</h3>
        {participantsLoading && <p>Loading participants...</p>}
        {participantsError && <p style={{ color: 'red' }}>Error: {participantsError.message}</p>}
        <p>Count: {participants?.length || 0}</p>
        {participants && participants.length > 0 && (
          <ul>
            {participants.map(participant => (
              <li key={participant.id}>
                {participant.name} {participant.hasWon && '🏆'}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>Actions</h3>
        <button
          onClick={handleCreateRoom}
          disabled={actionLoading}
          style={{
            padding: '10px 20px',
            fontSize: '16px',
            cursor: actionLoading ? 'not-allowed' : 'pointer'
          }}
        >
          {actionLoading ? 'Creating...' : 'Create Test Room'}
        </button>
        {actionError && <p style={{ color: 'red' }}>Error: {actionError.message}</p>}
      </section>
    </div>
  )
}

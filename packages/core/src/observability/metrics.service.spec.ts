import { MetricsService } from './metrics.service';

// REQ-OPS-004: ровно 4 метрики дизайна §3; собственный Registry (не default) —
// спеки не загрязняют друг друга.
describe('MetricsService (REQ-OPS-004)', () => {
  it('экспонирует 4 метрики в Prometheus text format', async () => {
    const m = new MetricsService();
    m.observePublishToDeliver('public', 0.012);
    m.observeReplayDuration('organizer', 0.2);
    m.incCommitError('P2034');
    m.connectionAdded('room-1');

    const text = await m.render();

    expect(text).toContain('mymozhem_publish_to_deliver_seconds_count{visibility="public"} 1');
    expect(text).toContain('mymozhem_replay_duration_seconds_count{level="organizer"} 1');
    expect(text).toContain('mymozhem_event_commit_errors_total{code="P2034"} 1');
    expect(text).toContain('mymozhem_active_connections{roomId="room-1"} 1');
    expect(m.contentType).toContain('text/plain');
  });

  it('gauge: парные add/remove; серия комнаты исчезает при нуле (stale-series гигиена)', async () => {
    const m = new MetricsService();
    m.connectionAdded('room-1');
    m.connectionAdded('room-1');
    m.connectionRemoved('room-1');
    expect(await m.render()).toContain('mymozhem_active_connections{roomId="room-1"} 1');
    m.connectionRemoved('room-1');
    expect(await m.render()).not.toContain('mymozhem_active_connections{roomId="room-1"}');
    // remove без add — не уводит в минус:
    m.connectionRemoved('room-1');
    expect(await m.render()).not.toContain('mymozhem_active_connections{roomId="room-1"}');
  });

  it('publish→deliver зажимается в 0 при skew часов (recordedAt БД впереди Date.now())', async () => {
    const m = new MetricsService();
    m.observePublishToDeliver('public', -5);
    const text = await m.render();
    expect(text).toContain('mymozhem_publish_to_deliver_seconds_count{visibility="public"} 1');
    expect(text).toContain('mymozhem_publish_to_deliver_seconds_sum{visibility="public"} 0');
  });
});

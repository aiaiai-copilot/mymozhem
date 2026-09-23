import { configureRoomRequestSchema } from './configure-room-request';

describe('configureRoomRequest contract (UI-срез, решение №9)', () => {
  it.each([
    ['valid', { appId: 'quiz', manifestVersion: 2, settings: { questions: [] } }, true],
    ['extra key rejected', { appId: 'quiz', manifestVersion: 2, settings: {}, extra: 1 }, false],
    ['settings must be object', { appId: 'quiz', manifestVersion: 2, settings: 'x' }, false],
    ['bad appId', { appId: 'QUIZ!', manifestVersion: 2, settings: {} }, false],
  ])('%s', (_l, body, ok) => {
    expect(configureRoomRequestSchema.safeParse(body).success).toBe(ok);
  });
});

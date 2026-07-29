import type { AppConfig } from '../config/config.schema';

// Shared AppConfig for int-specs. Values are inert: DATABASE_URL is unused because
// startTestDb() points PrismaService at a throwaway testcontainer.
export const TEST_CONFIG: AppConfig = {
  NODE_ENV: 'test',
  PORT: 3000,
  DATABASE_URL: 'postgresql://unused',
  ROOM_CODE_MIN_LEN: 8,
  ROOM_PARTICIPANT_LIMIT: 500,
  JOIN_RATE_LIMIT_IP: 20,
};

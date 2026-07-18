// Integration lane: DB-backed tests (*.int-spec.ts) against an ephemeral
// Testcontainers Postgres. Separate from unit `jest.config.js` (*.spec.ts) so unit
// runs stay fast and DB-free. `.int-spec.ts` does NOT match the unit `**/*.spec.ts`.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.int-spec.ts'],
  testTimeout: 120000, // container pull + start
  maxWorkers: 1, // one shared container per file; avoid parallel DB contention
};

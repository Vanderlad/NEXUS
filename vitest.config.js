import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Server-side tests only; each worker gets its own in-memory SQLite DB
    // (NEXUS_DB_PATH is read by server/db.js at import time).
    include: ['tests/**/*.test.js'],
    environment: 'node',
    env: {
      NEXUS_DB_PATH: ':memory:'
    }
  }
});

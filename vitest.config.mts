import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Matches the tsconfig path alias.
      '@': root.replace(/\/$/, ''),
      'server-only': `${root}tests/stubs/server-only.ts`,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    /**
     * Several tests call `vi.resetModules()` and then re-import a route, which
     * re-transforms its whole module graph inside the test body. With one
     * worker spawned per file that occasionally takes longer than vitest's 5s
     * default on a loaded machine — a timeout, never a wrong assertion.
     */
    testTimeout: 20_000,
    // The modules read configuration at import time, so the environment has to
    // be in place before any of them load.
    env: {
      GEMINI_API_KEY: 'test-key-not-real',
      GEMINI_MODEL: 'gemini-flash-latest',
      SALESFORCE_CLIENT_ID: 'test-client-id',
      SALESFORCE_LOGIN_URL: 'https://login.salesforce.com',
      SALESFORCE_REDIRECT_URI: 'http://localhost:3000/api/auth/callback/salesforce',
      SALESFORCE_MCP_URL: 'https://api.salesforce.com/platform/mcp/v1/platform/sobject-all',
      SETUP_SECRET: 'test-setup-secret',
      MAX_RECORDS: '50',
      MAX_TOOL_ROUNDS: '5',
    },
  },
});

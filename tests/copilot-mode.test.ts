import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'copilot-mode-'));
  vi.stubEnv('TOKEN_STORE_DIR', dir);
  vi.stubEnv('TOKEN_STORE', 'file');
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const post = (body: unknown) =>
  new Request('http://localhost:3001/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('copilot mode', () => {
  it('uses the code default until something is saved', async () => {
    const { getCopilotModeState } = await import('@/lib/copilot-mode');
    expect(await getCopilotModeState()).toEqual({ mode: 'live', source: 'code', codeDefault: 'live' });
  });

  it('remembers the mode saved from /config', async () => {
    const { getCopilotMode, getCopilotModeState, setCopilotMode } = await import('@/lib/copilot-mode');
    await setCopilotMode('scripted');
    expect(await getCopilotMode()).toBe('scripted');
    expect((await getCopilotModeState()).source).toBe('config');

    await setCopilotMode('live');
    expect(await getCopilotMode()).toBe('live');
  });
});

describe('/api/config', () => {
  it('reports the current mode to anyone', async () => {
    const { GET } = await import('@/app/api/config/route');
    expect(await (await GET()).json()).toMatchObject({ mode: 'live' });
  });

  it('rejects an unknown mode', async () => {
    const { POST } = await import('@/app/api/config/route');
    expect((await POST(post({ copilotMode: 'offline' }))).status).toBe(400);
  });

  it('switches to demo mode without any secret', async () => {
    const { POST } = await import('@/app/api/config/route');
    const response = await POST(post({ copilotMode: 'scripted' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mode: 'scripted', source: 'config', codeDefault: 'live' });
  });
});

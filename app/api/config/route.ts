/**
 * GET  /api/config — the current Copilot mode (live or scripted demo).
 * POST /api/config — change it. Body: { "copilotMode": "live" | "scripted" }.
 *
 * Changing the mode needs SETUP_SECRET in the `x-setup-secret` header, the same
 * secret that protects the one-time Salesforce setup, so a visitor to a
 * deployed demo cannot flip it. Reading it needs nothing: it is not sensitive.
 */

import { getCopilotModeState, isCopilotMode, setCopilotMode } from '@/lib/copilot-mode';
import { requireSetupSecret } from '@/lib/setup-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(): Promise<Response> {
  return Response.json(await getCopilotModeState(), { headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  const denied = requireSetupSecret(request);
  if (denied) return Response.json({ error: denied.message }, { status: denied.status, headers: NO_STORE });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'The request body was not valid JSON.' }, { status: 400, headers: NO_STORE });
  }

  const mode = (body as { copilotMode?: unknown } | null)?.copilotMode;
  if (!isCopilotMode(mode)) {
    return Response.json({ error: 'copilotMode must be "live" or "scripted".' }, { status: 400, headers: NO_STORE });
  }

  try {
    await setCopilotMode(mode);
  } catch (error) {
    return Response.json(
      { error: `The setting could not be saved: ${(error as Error).message}` },
      { status: 500, headers: NO_STORE },
    );
  }

  return Response.json(await getCopilotModeState(), { headers: NO_STORE });
}

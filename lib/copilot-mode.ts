/**
 * Where the /my-day Copilot gets its answers.
 *
 *   'live'     — Gemini reasons over live Salesforce data (normal behaviour).
 *   'scripted' — demo mode. Gemini is never called; questions are answered
 *                from data/scripted-responses.json, for demos when the LLM is
 *                unavailable or overloaded.
 *
 * Two ways to switch:
 *
 *   1. The /config page toggle. Takes effect on the next Copilot question, no
 *      restart. Saved beside the Salesforce tokens (a file locally, Redis on
 *      Vercel), so it survives restarts and every instance sees it.
 *   2. COPILOT_MODE below: the default used until /config has saved a choice.
 *      Change it, then rebuild (`npm run build`) or restart `npm run dev`.
 *
 * Only the Copilot's free-text answers change. The dashboard, map, account
 * panel, appointment details, schedule questions ("next appointment",
 * "schedule today") and status buttons stay live in both modes, because none
 * of them use the LLM.
 */

import 'server-only';

import { log } from './logger';
import { readSetting, writeSetting } from './token-store';

export type CopilotMode = 'live' | 'scripted';

/** THE CODE SWITCH: the default when /config has not saved a choice. */
export const COPILOT_MODE: CopilotMode = 'live';

const SETTING = 'copilotMode';

export function isCopilotMode(value: unknown): value is CopilotMode {
  return value === 'live' || value === 'scripted';
}

/** The code default, read through a function so callers compare against the full union. */
export function codeDefaultMode(): CopilotMode {
  return COPILOT_MODE;
}

export interface CopilotModeState {
  mode: CopilotMode;
  /** 'config' when the /config page set it, 'code' when it is the COPILOT_MODE default. */
  source: 'config' | 'code';
  codeDefault: CopilotMode;
}

export async function getCopilotModeState(): Promise<CopilotModeState> {
  const codeDefault = codeDefaultMode();
  try {
    const saved = await readSetting<unknown>(SETTING);
    if (isCopilotMode(saved)) return { mode: saved, source: 'config', codeDefault };
  } catch (error) {
    // A storage hiccup must not break the Copilot: fall back to the code default.
    log.warn('copilot-mode', 'Could not read the saved Copilot mode; using the code default', {
      error: (error as Error).message,
    });
  }
  return { mode: codeDefault, source: 'code', codeDefault };
}

export async function getCopilotMode(): Promise<CopilotMode> {
  return (await getCopilotModeState()).mode;
}

export async function setCopilotMode(mode: CopilotMode): Promise<void> {
  await writeSetting(SETTING, mode);
  log.info('copilot-mode', 'Copilot mode changed', { mode });
}

/**
 * Scripted Copilot: answers from data/scripted-responses.json instead of
 * Gemini. Used only when lib/copilot-mode.ts is set to 'scripted'.
 *
 * It emits the same SSE events as the live Copilot (progress, delta,
 * appointments, done), so the chat UI renders a scripted answer exactly like a
 * live one: streamed text, SA-#### links and appointment cards.
 */

import 'server-only';

import responses from '@/data/scripted-responses.json';
import { log } from './logger';
import type { Appointment, CopilotEvent, StatusAction } from '@/types/copilot';
import type { Technician } from '@/types/technician';

export interface ScriptedEntry {
  id: string;
  keywords: string[];
  response: string;
  appointments?: Appointment[];
  /**
   * Makes the entry act on a real appointment instead of only replying: the
   * Copilot shows that appointment's live card with a confirmation, and
   * confirming changes it in Salesforce. Handled in lib/copilot.ts.
   */
  action?: StatusAction;
  /** Reply for an action entry when no appointment is selected or named. */
  noAppointmentResponse?: string;
}

export interface ScriptedResponses {
  progressLabel?: string;
  thinkingDelayMs?: number;
  streamDelayMs?: number;
  fallback: string;
  entries: ScriptedEntry[];
}

const DEFAULT_TIMEZONE = 'America/Chicago';

/** Lowercase words, apostrophes and punctuation dropped: "What's up?" -> ["whats", "up"]. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^a-z0-9$]+/)
    .filter(Boolean);
}

/**
 * True when every word of the keyword starts a word of the question, so
 * "line item" matches "line items" and "summar" would match "summarize".
 */
export function keywordMatches(keyword: string, questionWords: string[]): boolean {
  const required = words(keyword);
  return required.length > 0 && required.every((word) => questionWords.some((candidate) => candidate.startsWith(word)));
}

/** The first entry, top to bottom, with a matching keyword; null when none match. */
export function findScriptedEntry(message: string, data: ScriptedResponses = responses as ScriptedResponses): ScriptedEntry | null {
  const questionWords = words(message);
  return data.entries.find((entry) => entry.keywords.some((keyword) => keywordMatches(keyword, questionWords))) ?? null;
}

/** "Tue, Nov 17, 2026" in the configured default time zone. */
export function formatToday(now = new Date(), timeZone = process.env.CMTPlay_DEFAULT_TIMEZONE || DEFAULT_TIMEZONE): string {
  try {
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: DEFAULT_TIMEZONE }).format(now);
  }
}

export function fillPlaceholders(text: string, now = new Date(), appointmentNumber = ''): string {
  return text
    .replace(/\{\{\s*today\s*\}\}/g, formatToday(now))
    .replace(/\{\{\s*appointment\s*\}\}/g, appointmentNumber);
}

/** Streams a scripted reply as delta events, so it appears to type like a live one. */
export async function* streamText(text: string, data: ScriptedResponses = responses as ScriptedResponses): AsyncGenerator<CopilotEvent> {
  for (const piece of chunk(text)) {
    yield { type: 'delta', text: piece };
    await sleep(data.streamDelayMs ?? 0);
  }
}

export const scriptedSettings = responses as ScriptedResponses;

/** Splits text into small pieces, keeping whitespace and newlines, so it streams like a typed reply. */
export function chunk(text: string, wordsPerChunk = 3): string[] {
  const pieces = text.match(/\S+\s*|\s+/g) ?? [];
  const chunks: string[] = [];
  for (let i = 0; i < pieces.length; i += wordsPerChunk) chunks.push(pieces.slice(i, i + wordsPerChunk).join(''));
  return chunks;
}

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

export async function* runScriptedTurn(
  technician: Technician,
  message: string,
  data: ScriptedResponses = responses as ScriptedResponses,
): AsyncGenerator<CopilotEvent> {
  const entry = findScriptedEntry(message, data);
  log.info('copilot', 'Scripted reply', { entry: entry?.id ?? 'fallback' });

  yield { type: 'progress', label: data.progressLabel ?? 'Asking Salesforce…' };
  await sleep(data.thinkingDelayMs ?? 0);

  const now = new Date();

  if (entry?.appointments?.length) {
    const appointments = entry.appointments.map(
      (appointment) =>
        Object.fromEntries(
          Object.entries(appointment).map(([key, value]) => [key, typeof value === 'string' ? fillPlaceholders(value, now) : value]),
        ) as Appointment,
    );
    yield { type: 'appointments', appointments, meta: { technicianName: technician.fullName } };
  }

  yield* streamText(fillPlaceholders(entry?.response ?? data.fallback, now), data);
  yield { type: 'done' };
}

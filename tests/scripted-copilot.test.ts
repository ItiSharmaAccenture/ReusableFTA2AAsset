import { describe, expect, it } from 'vitest';

import responses from '@/data/scripted-responses.json';
import {
  chunk,
  fillPlaceholders,
  findScriptedEntry,
  formatToday,
  runScriptedTurn,
  type ScriptedResponses,
} from '@/lib/scripted-copilot';
import type { CopilotEvent } from '@/types/copilot';

const technician = { id: 'TCH-7842', fullName: 'Sayantan Pal', firstName: 'Sayantan' };
/** The real file, with delays removed so the tests run instantly. */
const data: ScriptedResponses = { ...(responses as ScriptedResponses), thinkingDelayMs: 0, streamDelayMs: 0 };

async function collect(message: string): Promise<CopilotEvent[]> {
  const events: CopilotEvent[] = [];
  for await (const event of runScriptedTurn(technician, message, data)) events.push(event);
  return events;
}

const text = (events: CopilotEvent[]) =>
  events.map((event) => (event.type === 'delta' ? event.text : '')).join('');

describe('matching questions to scripted answers', () => {
  it.each([
    ['What can I upsell here?', 'upsell'],
    ['Recommend upsell products', 'upsell'],
    ['I need another motion sensor, who has one nearby?', 'motion-sensor'],
    ['Summarize this customer', 'account-summary'],
    ['summarise this', 'account-summary'],
    ['What parts do I need today', 'parts'],
    ['Check required parts', 'parts'],
    ["I'm done with this job, close it out", 'close-job'],
    ['Prepare job closure', 'close-job'],
    ['close out SA-0163', 'close-job'],
    ['Mark it complete', 'close-job'],
  ])('answers "%s" with %s', (question, id) => {
    expect(findScriptedEntry(question, data)?.id).toBe(id);
  });

  it('makes the close entry a real completion, with a reply naming the appointment', () => {
    const entry = findScriptedEntry("I'm done with this job, close it out", data)!;
    expect(entry.action).toBe('complete');
    expect(fillPlaceholders(entry.response, new Date(), 'SA-0163')).toContain('SA-0163');
  });

  it('falls back for anything unscripted', () => {
    expect(findScriptedEntry('What is the weather like?', data)).toBeNull();
  });
});

describe('the streamed reply', () => {
  it('streams the full answer and finishes with done', async () => {
    const events = await collect('What can I upsell here?');
    expect(events[0]).toMatchObject({ type: 'progress' });
    expect(events.at(-1)).toEqual({ type: 'done' });
    expect(text(events)).toBe(findScriptedEntry('upsell', data)!.response);
  });

  it('sends appointment cards before the text that mentions them, with today filled in', async () => {
    const events = await collect('What parts do I need today');
    const cards = events.find((event) => event.type === 'appointments');
    expect(cards?.type === 'appointments' && cards.appointments.map((a) => a.appointmentNumber)).toEqual(['SA-0163', 'SA-0063']);
    expect(cards?.type === 'appointments' && cards.appointments[0].appointmentDate).toBe(formatToday());
    expect(events.indexOf(cards!)).toBeLessThan(events.findIndex((event) => event.type === 'delta'));
  });

  it('uses the fallback text when nothing matches', async () => {
    expect(text(await collect('Tell me a joke'))).toBe(data.fallback);
  });
});

describe('helpers', () => {
  it('keeps every character when chunking', () => {
    const sample = 'Line one **bold**\n\nLine two — $1,500.00';
    expect(chunk(sample).join('')).toBe(sample);
  });

  it('formats today like the live Copilot cards', () => {
    expect(formatToday(new Date('2026-11-17T20:00:00Z'), 'America/Chicago')).toBe('Tue, Nov 17, 2026');
  });
});

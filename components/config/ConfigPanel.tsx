'use client';

/**
 * The /config page: a toggle for the Copilot demo (scripted) mode.
 */

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';

import type { CopilotMode, CopilotModeState } from '@/lib/copilot-mode';

export default function ConfigPanel({ initial, fontClassName }: { initial: CopilotModeState; fontClassName: string }) {
  const [state, setState] = useState<CopilotModeState>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const demoOn = state.mode === 'scripted';

  async function save(mode: CopilotMode) {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ copilotMode: mode }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<CopilotModeState> & { error?: string };

      if (!response.ok) {
        setMessage({ tone: 'error', text: body.error ?? `Could not save (HTTP ${response.status}).` });
        return;
      }

      setState(body as CopilotModeState);
      setMessage({
        tone: 'ok',
        text:
          mode === 'scripted'
            ? 'Demo mode is on. The Copilot now answers from the scripted responses.'
            : 'Demo mode is off. The Copilot is using Gemini again.',
      });
    } catch {
      setMessage({ tone: 'error', text: 'The server could not be reached. Is it running?' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`cfg-page ${fontClassName}`}>
      <main className="cfg-main">
        <header className="cfg-header">
          <span className="cfg-logo">
            <Image src="/assets/my-day/accenture-logo.png" alt="Accenture" width={36} height={36} priority />
          </span>
          <div>
            <h1>Configuration</h1>
            <p>CMTPlay My Day</p>
          </div>
          <Link className="cfg-back" href="/my-day">
            Back to My Day
          </Link>
        </header>

        <section className="cfg-card">
          <div className="cfg-row">
            <div className="cfg-row-text">
              <h2 id="cfg-demo-label">Copilot demo mode</h2>
              <p id="cfg-demo-desc">
                When on, the Copilot answers from hardcoded responses instead of calling Gemini. Use it when the LLM is slow or
                unavailable. The dashboard, map, account panel and schedule questions stay live from Salesforce.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void save(demoOn ? 'live' : 'scripted')}
              role="switch"
              aria-checked={demoOn}
              aria-labelledby="cfg-demo-label"
              aria-describedby="cfg-demo-desc"
              className={`cfg-switch${demoOn ? ' is-on' : ''}`}
              disabled={saving}
            >
              <span className="cfg-switch-thumb" />
            </button>
          </div>

          <dl className="cfg-status">
            <div>
              <dt>Copilot is using</dt>
              <dd>
                <span className={`cfg-pill${demoOn ? ' cfg-pill--demo' : ''}`}>
                  {demoOn ? 'Scripted responses (demo)' : 'Gemini (live)'}
                </span>
              </dd>
            </div>
            <div>
              <dt>Set by</dt>
              <dd>
                {state.source === 'config'
                  ? 'This page'
                  : `Code default (COPILOT_MODE = '${state.codeDefault}' in lib/copilot-mode.ts)`}
              </dd>
            </div>
          </dl>

          {message ? (
            <p className={`cfg-message cfg-message--${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>
              {message.text}
            </p>
          ) : null}

          <p className="cfg-note">
            Changes apply to the next Copilot question; no restart needed. Edit the answers in{' '}
            <code>data/scripted-responses.json</code>.
          </p>
        </section>
      </main>
    </div>
  );
}

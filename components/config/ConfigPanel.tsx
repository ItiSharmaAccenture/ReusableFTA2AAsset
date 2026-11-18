'use client';

/**
 * The /config page: a toggle for the Copilot demo (scripted) mode.
 *
 * Changing it needs SETUP_SECRET. The secret is kept in sessionStorage for this
 * tab only, so it is asked for once per visit and forgotten when the tab closes.
 */

import Image from 'next/image';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import type { CopilotMode, CopilotModeState } from '@/lib/copilot-mode';

const SECRET_KEY = 'cmtplay-config-secret';

function readStoredSecret(): string {
  try {
    return sessionStorage.getItem(SECRET_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeSecret(secret: string | null): void {
  try {
    if (secret) sessionStorage.setItem(SECRET_KEY, secret);
    else sessionStorage.removeItem(SECRET_KEY);
  } catch {
    // Storage blocked: the secret is simply asked for again next time.
  }
}

export default function ConfigPanel({ initial, fontClassName }: { initial: CopilotModeState; fontClassName: string }) {
  const [state, setState] = useState<CopilotModeState>(initial);
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const demoOn = state.mode === 'scripted';

  async function save(mode: CopilotMode) {
    // Typed value first; otherwise the one this tab already used successfully.
    const key = secret.trim() || readStoredSecret();
    if (!key) {
      setMessage({ tone: 'error', text: 'Enter the setup secret first (SETUP_SECRET in .env.local).' });
      document.getElementById('cfg-secret')?.focus();
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-setup-secret': key },
        body: JSON.stringify({ copilotMode: mode }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<CopilotModeState> & { error?: string };

      if (!response.ok) {
        if (response.status === 401) storeSecret(null);
        setMessage({ tone: 'error', text: body.error ?? `Could not save (HTTP ${response.status}).` });
        return;
      }

      storeSecret(key);
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

  // Enter in the secret field must not flip the switch; only the switch does.
  function onSubmit(event: FormEvent) {
    event.preventDefault();
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

        <form className="cfg-card" onSubmit={onSubmit}>
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

          <label className="cfg-field" htmlFor="cfg-secret">
            <span>Setup secret</span>
            <input
              id="cfg-secret"
              type="password"
              autoComplete="off"
              placeholder="SETUP_SECRET from .env.local"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
            />
            <small>Needed to change settings. After the first change it is remembered in this browser tab, so you can leave it blank.</small>
          </label>

          {message ? (
            <p className={`cfg-message cfg-message--${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>
              {message.text}
            </p>
          ) : null}

          <p className="cfg-note">
            Changes apply to the next Copilot question; no restart needed. Edit the answers in{' '}
            <code>data/scripted-responses.json</code>.
          </p>
        </form>
      </main>
    </div>
  );
}

# CLAUDE.md

Guidance for Claude Code working in this repository.

Human-facing docs: [`docs/setup.html`](docs/setup.html) (installation) and
[`docs/architecture.html`](docs/architecture.html) (how it fits together). This
file is the version written for you — the same ground, plus the things that
only bite an agent driving a terminal.

---

## What this repository is

Two programs that must both run for the upsell feature to do anything:

| | What | Where | Started with |
|---|---|---|---|
| App | Next.js dashboard + Copilot | `localhost:3000` | `npm run dev` |
| Agent | Python ADK agent over A2A | `127.0.0.1:8001` | `uvicorn main:app` in `agent/` |

The app asks the agent for product recommendations. Salesforce owns the
customer, the property and the appointment; the agent owns products. **Neither
implements the other's half** — this is the organising principle, and a change
that blurs it is a change to reject.

---

## Rules that are not negotiable

**Never print, echo, log or commit a secret.** `agent/.env` holds a live
OpenRouter key; `.env.local` holds the Gemini key and the Salesforce consumer
key; `.local/salesforce-tokens.json` holds live OAuth tokens. All are
git-ignored. When you need to confirm a variable is set, test for presence —
never print the value:

```bash
grep -c '^OPENROUTER_API_KEY=.\+' agent/.env   # 1 = set, 0 = empty
```

**The GitHub repository is public.** Scan staged content before any commit:

```bash
git diff --cached | grep -qE 'sk-or-v1-[A-Za-z0-9]{20,}' && echo BLOCKED || echo clean
```

Beware: piping `grep` into `head` makes the pipeline's exit status `head`'s, so
a naive `grep … | head && echo FOUND` always reports a match. Test `grep -q`
on its own.

**Do not burn the OpenRouter quota.** 50 free requests per day, **account-wide**,
and each end-to-end upsell test is one. Verify with unit tests and a single live
run, not a loop. If you need many iterations, test `toAgentPayload` and
`buildAgentPrompt` directly — no model call needed.

**Never relax a refusal into a guess.** When the property cannot be verified the
system declines to recommend. If a test or a demo looks broken because of that,
the fix is upstream in the lookup, never a fallback that invents a property.

---

## Environment gotchas you will hit

### The dev server exits on its first start, every time

`next dev` halts once per cold start with a Next.js security advisory
("Retry the same command to continue"). The retry stays up. Budget two launches,
and do not diagnose this as a config fault. The same happens to `npm run build`.

### Stopping the dev server leaves an orphan

`TaskStop` kills the `npm` wrapper; the `next dev` child survives and keeps
port 3000. A restart then silently moves to 3001 and exits, and health checks
hit the **old** server — which looks like success. Always kill by process:

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like '*next*start-server*' } |
  ForEach-Object { taskkill /PID $_.ProcessId /F }
```

Then confirm the port is free before relaunching:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
```

### PowerShell vs Bash

Both tools are available and take their own syntax. `.ps1` scripts (such as
`agent/test_request.ps1`) must run through the PowerShell tool — Bash fails on
`param(`. `du` over the OneDrive-backed agent folder is slow enough to hit the
command timeout; avoid it.

### Things you cannot do

Browser OAuth. Step 8 of the setup needs a human to open
`/api/auth/salesforce?secret=…` and log in. Ask; do not try to automate it.
Finding a ServiceResource Id, by contrast, you *can* do once tokens exist —
read `.local/salesforce-tokens.json` and query the REST API.

---

## Setup, in order

Steps 1-4 are yours. Step 5 is the human's. Steps 6-10 are yours again, except
the browser login.

1. `npm install`
2. `cd agent && python -m venv .venv && .venv/Scripts/python.exe -m pip install -r requirements.txt`
3. Ask the human for the catalogue PDF → `agent/catalog/` (**exactly one** PDF; the agent refuses to start otherwise)
4. Ask the human for a Gemini key, an OpenRouter key, and the Salesforce consumer key
5. **Human:** Salesforce org setup — MCP server activated, External Client App, scopes `mcp_api` **and** `api`, JWT tokens enabled. See `docs/setup.html` §5
6. Write `.env.local` and `agent/.env` from the two `.env.example` templates
7. Start the agent; confirm the card publishes skill id `property_upsell_recommendations`
8. **Human:** open `/api/auth/salesforce?secret=…` once
9. Find the ServiceResource Id, add `CMTPlay_DEMO_MODE`, `CMTPlay_TECHNICIAN_DIRECTORY`, and `CMTPlay_APPOINTMENT_SOURCE` if needed
10. Verify end to end

### Required in `.env.local`

```bash
GEMINI_API_KEY=            SALESFORCE_CLIENT_ID=
SALESFORCE_LOGIN_URL=      SALESFORCE_REDIRECT_URI=
SALESFORCE_SCOPES=mcp_api,api,refresh_token,offline_access
SALESFORCE_MCP_URLS=       SETUP_SECRET=
A2A_UPSELL_AGENT_URL=http://127.0.0.1:8001
CMTPlay_DEMO_MODE=true
CMTPlay_TECHNICIAN_DIRECTORY=[{"technicianId":"...","serviceResourceId":"0Hn..."}]
```

`A2A_UPSELL_AGENT_URL` has **no default on purpose**. Unset means the Copilot
reports recommendations unavailable. Do not add a localhost default — it would
be dead on a deployed instance and fail as a confusing connection error instead
of a setup step.

### Finding the ServiceResource Id

Once tokens exist, read `accessToken` and `instanceUrl` from
`.local/salesforce-tokens.json` (the shape nests, so search recursively) and
query:

```sql
SELECT Id, Name, RelatedRecordId, IsActive FROM ServiceResource WHERE IsActive = true
```

Keep **both** the Id and the Name. Then check how the org links jobs:

```sql
SELECT COUNT() FROM AssignedResource WHERE ServiceResourceId = '0Hn...'
```

Zero, on a resource that plainly has jobs, means the org links by **Owner**.
Set `CMTPlay_APPOINTMENT_SOURCE=owner_query`, or the dashboard is empty and the
Upsell tab is unreachable.

---

## Verifying

### Unit, lint, build

```bash
npm test          # 375 tests, 28 files
npm run lint
npm run build     # expect the advisory halt, then retry
```

`vitest.config.mts` sets `testTimeout: 20_000`. Several tests call
`vi.resetModules()` and re-import a route, re-transforming its module graph
inside the test body; with one worker per file that exceeds the 5s default on a
loaded machine. A timeout there is worker contention, **not** a failed
assertion — confirm with `--maxWorkers=4` before treating it as a regression.

### Live A2A check, without the UI

Cheapest useful proof. Sign in via the API, then drive one Copilot turn:

```bash
curl -s -c jar.txt -X POST http://localhost:3000/api/session \
  -H 'Content-Type: application/json' \
  --data '{"name":"<ServiceResource Name>","id":"<mapped technician id>"}'

curl -s -N -b jar.txt -X POST http://localhost:3000/api/copilot \
  -H 'Content-Type: application/json' \
  --data '{"message":"Recommend upsell products","appointmentId":"08p..."}' \
  --max-time 280
```

Expect two `progress` events, then a `delta` carrying the recommendations.
Allow 50-60s. Delete the cookie jar afterwards — it holds a signed session.

> **The name must match the ServiceResource's `Name`.** The technician *ID*
> scopes the dashboard; the Copilot looks appointments up by the *name* you
> declare. A mismatch gives "SA-nnnn was not found in the technician's
> schedule" and no delegation. That is correct behaviour, not a bug — but it
> wastes a debugging cycle if you forget.

For the agent alone, bypassing the app: `agent/test_request.ps1` via the
PowerShell tool, or `python example_request.py`.

---

## Conventions in this codebase

**Comments explain why, not what.** Existing comments state the reasoning behind
a decision — a cache TTL, a retry, a deliberate absence of a default. Match
that. Do not add comments that restate the code.

**Capabilities are resolved from published schemas**, never from hardcoded tool
names. An org can rename its actions or add a custom MCP server without a code
change. If you are about to write a tool name as a string literal, you are
probably solving it wrong; the override env vars exist for schemas too thin to
infer from, and an override matching nothing leaves the capability unresolved
rather than guessing.

**Untrusted content is wrapped, never obeyed.** Salesforce record text and the
agent's reply both cross a trust boundary and are treated as data. Keep it that
way in anything you add.

**`lib/upsell-agent.ts` is the only path to the agent.** Do not call it from
elsewhere. The A2A SDK is lazy-loaded there deliberately — importing it at
module scope pulls protobufjs and jose into the whole Copilot's import graph,
which measurably slowed the test suite.

**Server-only modules.** `lib/config.ts` and friends import `server-only`. Never
import them from a client component. Tests alias `server-only` to a stub in
`vitest.config.mts`.

**The seven-field contract** in `lib/upsell-payload.ts` is shared with
`agent/agent.py`. Changing the list means changing both sides; add a spelling to
`SOURCE_KEYS` rather than a field, unless the agent's contract genuinely grows.

---

## Git

`origin` is the original upstream repo; `a2a` is this project's repo
(`ReusableFTA2AAsset`). Push to `a2a` unless told otherwise.

Commit messages here are explanatory: a subject line, then prose about *why*,
then the per-file detail. Match that register — not a bullet list of changed
files.

Never commit `.env*` (except the `.example` templates), `.local/`, `.sf/`, or
`agent/catalog/*.pdf`. The catalogue is excluded by policy, not by accident; it
is supplied per deployment and the README says where to put it.

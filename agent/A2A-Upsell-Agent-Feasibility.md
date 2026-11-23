# A2A Property Upsell Agent — Feasibility Assessment

Whether a Google ADK specialist agent, reached over A2A, can replace the Salesforce-hosted upsell action in the existing Headless Field Service POC — and what the existing code actually requires to get there.

| | |
|---|---|
| **Date** | 18 November 2026 |
| **Codebase** | `salesforce-ai-sales-assistant` @ `bdbfbef` |
| **Baseline** | 344 tests passing, clean working tree |
| **Machine** | Python 3.14.6, Node 24.18.0, npm 11.16.0 |

---

## Verdict

**Feasible. Build it.**

Every external dependency the plan rests on was verified on this machine rather than assumed. The revised design — delegate to the ADK agent, and move the product catalogue into it — is better than the original: it removes a duplicate implementation and incidentally fixes a latent bug in capability resolution.

Findings below are grouped as resolved, blocking and open. The open ones are engineering work of known size. The single blocking one is not an integration problem at all, and no amount of A2A work addresses it: **the coverage-gap example in the plan has no data behind it in the current org.**

---

## 1. What was verified

Each row was checked by running the thing. The ADK and A2A claims were confirmed by reading the published packages, not by recalling documentation.

| Check | Result | How |
|---|---|---|
| ADK and A2A SDK install here | `google-adk 2.14.1` and `a2a-sdk 1.3.1` resolve cleanly on Python 3.14.6. ADK requires 3.11 or later. | `pip install --dry-run` |
| ADK still ships A2A server support in 2.x | Yes. `to_a2a(agent, host=, port=, rpc_path=, agent_card=)` returns a Starlette app; 32 A2A modules present. | read `google/adk/a2a/utils/agent_to_a2a.py` from the wheel |
| Agent Card discovery path | `/.well-known/agent-card.json` | `a2a/utils/constants.py` |
| A JavaScript client exists for the Next.js side | `@a2a-js/sdk@1.3.0` with a `./client` export — same major version as the Python server, so protocol-compatible. | `npm view` |
| Repository baseline is healthy | 344 tests across 26 files, all passing. | `npm test` |

Two setup details that cost an hour each if missed: `a2a-sdk` is an *optional extra* of ADK, so the install is `pip install "google-adk[a2a]"` and not bare `google-adk`; and there is no `uv` on this machine, so use `python -m venv`.

---

## 2. What the two decisions change

The plan was revised on two points: the Salesforce upsell tool is removed rather than kept alongside the agent, and the product catalogue is ingested into the ADK agent rather than fetched from Salesforce per request.

This produces a clean split. **Salesforce owns** customer, property and appointment context, reached through the existing custom MCP server. **The ADK agent owns** product knowledge and the gap reasoning over it. Nothing is implemented twice, and each system is shown doing work only it can do.

### R1 — The duplicate implementation is gone `RESOLVED`

The original plan had the ADK agent re-implementing logic that already exists and already works: the org publishes `FSUpsellProductAction` through the custom MCP server, and the Next.js app already grounds its recommendations in verified property detail. Removing the Salesforce tool leaves one upsell implementation instead of two competing ones.

> **Now retired:** `readUpsellProducts`, `digestUpsell`, `digestProducts` at `lib/copilot.ts:186-270`, plus roughly fifteen lines of upsell prompt rules at `lib/copilot.ts:880-895`.

### R2 — Removing the tool is configuration, not code `RESOLVED`

The tool policy is currently wide open (`SALESFORCE_TOOL_ALLOWLIST=*`, empty blocklist), so the Salesforce upsell action can be withdrawn from the model's reach with one environment variable. No Salesforce deployment, no code edit, instantly reversible — which makes it practical to switch between the two paths live during a demo.

```bash
SALESFORCE_TOOL_BLOCKLIST=FSUpsellProductActionapex_FSUpsellProductAction
```

> **Evidence:** The MCP tool name follows the pattern `<ApexClass>apex_<ApexClass>`, confirmed in the capability fixture at `tests/copilot-capabilities.test.ts:67`. The blocklist is applied during approval at `lib/tool-allowlist.ts:154`.

### R3 — It also removes a latent capability collision `RESOLVED`

The Copilot works out which Salesforce tool closes an appointment entirely from published schemas: *mutating, takes an appointment, publishes no status property*. The upsell action satisfies all three conditions in production, which makes it a real candidate for the close capability. Which tool wins is decided by discovery order, because the resolver takes the first match.

It resolves correctly today. The unit test does not catch the risk, because its fixture hardcodes `mutating: false` — whereas in production `looksMutating` returns true for this tool twice over. The server publishes `readOnlyHint: false` on every invocable Apex action, and the tool's name contains `apex`, which the fallback name pattern matches. Removing the tool eliminates the near-miss.

> **Evidence:** Resolver at `lib/copilot-capabilities.ts:142-147` · mutation classification at `lib/tool-allowlist.ts:111` · the fixture that masks it at `tests/copilot-capabilities.test.ts:66-70`.

---

## 3. The blocker

One finding is different in kind from the rest. It sits outside all six phases and outside the A2A work entirely.

> **BLOCKER — demo content**
>
> The worked example in the plan — *"two back doors but only one installed door sensor"* — cannot be grounded in Salesforce data as the org stands. Ingesting the product catalogue into the agent supplies the *available products* side of that comparison. It does not supply the other side.

### O1 — There is no installed-device or opening-count data `BLOCKING`

The custom property object carries seven fields, and none describe doors, windows or installed equipment. There is no `Asset` query anywhere in the repository, and the single configured MCP endpoint (`custom/TechnicianAppointments`) has no generic SOQL server behind it to fall back on.

```
Property_Size__c   Bedrooms__c   Bathrooms__c   Year_Built__c
Property_Type__c   Security_System_Base__c   Monitoring_Status__c
```

> **Evidence:** The complete field list queried from `Property_Detail__c` is at `lib/dashboard.ts:615-634`, mirrored in the type at `types/dashboard.ts:179-189`. No `sobject-all` MCP server is configured.

**Three ways forward:**

1. **Reframe the demo to the data that exists — recommended.** Gap analysis over bedrooms, bathrooms, property type and year built against the catalogue's room categories, with `Security_System_Base__c` and `Monitoring_Status__c` standing in for what is already installed. Demos honestly, needs no Salesforce work, available today.
2. **Extend the Salesforce data model.** Add opening counts and installed devices, then expose them through the custom MCP server. Delivers the plan's example exactly. This is Salesforce work that none of the six phases budgets for, and it lands on the critical path.
3. **Let the technician state the facts.** Cheapest to build, but it collides directly with a deliberate invariant in the codebase. See O5.

---

## 4. Open engineering work

Known size, no unknowns. These are consequences of the revised design that the six-phase plan does not currently name.

### O2 — The cheap integration path closed; the orchestrator must change `OPEN` *(phase 05)*

Under the original plan, A2A could have been called from the `onToolResult` hook when the Salesforce upsell tool returned, with no change to the orchestration loop at all. With that tool removed there is no result to hook, so the option is gone.

The orchestrator is hard-wired to MCP: the tool list comes only from `session.listTools()`, every call goes through `session.callTool()`, and an unrecognised name is rejected outright. There is no local-function-tool path. Two options remain.

- **Add a `localTools` channel to `AssistantOptions` — recommended.** Roughly fifty lines: a declaration plus an executor, so Gemini sees a delegation function beside the MCP tools. This is genuine model-driven delegation and it is what the plan describes. Gemini orchestration is one of the three stated objectives of the POC, so it is worth the fifty lines.
- **A deterministic intent path, `runUpsellIntent`.** No orchestrator change at all. The codebase already does exactly this twice, and it would catch the demo reliably, because the Upsell tab button and the suggested chip both send the literal string `Recommend upsell products`. The cost is narrative: the application delegates, not the model. Worth keeping as the fallback if time runs short.

> **Evidence:** Loop and unapproved-tool rejection at `lib/gemini.ts:370` · existing deterministic paths `runScheduleIntent` and `runStatusIntent` at `lib/copilot.ts:1138-1152` · fixed trigger strings at `components/my-day/dashboard/JobWorkspace.tsx:289` and `MyDayApp.tsx:38`.

### O3 — The property lookup needs re-plumbing to become the payload builder `OPEN` *(phase 05)*

`lookupCustomerProperty` is the function that turns a selected appointment into verified property detail: appointment, then account name, then the account-summary tool, then property rows. Under the new design it becomes the thing that builds the A2A task payload.

It currently runs *inside* the MCP tool-result hook and depends on `context.callTool`, which the orchestrator only constructs after a successful MCP call. A local tool executor has no such context. Whichever option in O2 is chosen, this function needs a session handle of its own; the cleanest fix is hoisting the `ToolResultContext` construction out of the per-call loop.

This function and its companions must be preserved, not retired alongside the digest helpers. They are the entire "Salesforce MCP is doing real work" half of the demonstration.

> **Keep:** `lookupCustomerProperty` at `lib/copilot.ts:1085-1136` · `customerPropertyFrom` at `:435` · `readAccountSummary` and `digestAccountSummary` at `:325-420`.

### O4 — The Execution Details panel is on a different surface from the feature `OPEN` *(phase 06)*

The plan's final deliverable is a five-stage strip in the Execution Details panel. That panel is rendered by `ExecutionProgress`, fed by `/api/chat`, which serves the general assistant at `/` — and that route runs the orchestrator with *default* options: no technician identity, no selected appointment, no property enrichment.

Upsell lives on `/my-day`, whose Copilot shows a single progress line that each event overwrites. It is not a retained step list. So extending the existing panel means one of three things, and the choice drives most of phase 06's cost.

- Port a stage list into the Copilot and widen `CopilotEvent` beyond `{ type: 'progress'; label }` — around a day.
- Accept the single-line display, which does show the five stages in sequence, just not as a checklist — around an hour.
- Move the demo to `/`, which means rebuilding identity and appointment context there. Not recommended.

Either way, `StageId` is a closed union and needs the new stages added, along with their labels.

> **Evidence:** `app/api/chat/route.ts` calls `runAssistant(parsed.body)` with no options · Copilot progress handling at `components/my-day/CopilotChat.tsx:379`, rendered at `:757` · `StageId` union at `types/chat.ts:8-16`, labels at `lib/gemini.ts:161`.

### O5 — "Technician observations" contradicts a deliberate invariant `OPEN` *(demo script)*

The application actively refuses to reason from property facts it has not verified. The instruction reads: *"Use only these listed property details. A property detail not listed here is unknown."* The whole property lookup exists so that a stated reason cannot be invented.

The plan's input table lists "Technician observations", and its closing demo question states property facts in free text — while its own execution flow earlier asks the neutral *"What can I upsell at this property?"*. Those are two different demos. Pick one.

If observations stay in, have the agent label each input as technician-reported or Salesforce-verified in its response. That turns the conflict into something worth showing rather than something to explain away.

> **Evidence:** Invariant at `lib/copilot.ts:470`, with the not-available branch immediately above it.

### O6 — Two test files will fail; rewrite rather than delete `OPEN` *(phase 06)*

The baseline is 344 passing tests. Budget for returning to green, not for dropping coverage.

- `tests/copilot-upsell.test.ts` — all five cases go. Three of them assert on `copilotInstruction` text that has to be rewritten for the A2A path in any case.
- `tests/copilot-account-summary.test.ts:141-175` — the *upsell property context* block calls `digestUpsell`. The property-grounding behaviour it covers **survives** the change, so port these cases onto the new payload builder. They are the regression net for "never invent a property detail", which is the invariant most at risk in this refactor.

---

## 5. Risks the catalogue move introduces

Moving the product data into the agent is the right call for a POC. It has two consequences worth stating rather than discovering on stage.

**Salesforce stops being the system of record for products.** The architecture diagram describes Salesforce as the system of record. After this change that holds for customers, properties and appointments — and not for products, which now live as a copy inside the agent, free to drift. Acceptable for a proof of concept. Put it on the slide rather than waiting for the question. The mitigation costs nothing: export the catalogue from Salesforce once, commit it as a dated fixture, and have the agent state its catalogue version in every response.

**Recommended product names may not match Salesforce records.** The plan keeps quote updates outside the agent, as a separate confirmed operation through the existing MCP integration. Because recommendations now originate from the agent's own catalogue, the names coming back will not necessarily match `Product2` records, so that follow-up step needs a name-matching stage. Out of scope for the POC; worth one line in the limitations.

---

## 6. Build these in from the start

Small items, each cheap now and awkward to retrofit.

| Item | Why now |
|---|---|
| `A2A_AGENT_URL` as configuration | A hardcoded `localhost:8001` is unreachable the moment this is deployed. The config module's `optional()` pattern makes it a two-line addition. |
| Cache the Agent Card | A turn already costs an MCP handshake of one to two seconds plus up to five model rounds. Follow the existing `discoveryCache` and `capabilityCache` patterns, both short-TTL. |
| An A2A branch in `describeFailure` | Without it, an agent that is not running on 8001 reaches the technician as "Something went wrong. Please try again." |
| Treat the agent response as untrusted | The codebase is consistent that record content is data and not instructions, and wraps tool output accordingly. An agent-to-agent channel is a new injection surface and deserves the same wrapper. |
| Watch the model budget | The agent makes its own Gemini calls on the same free-tier key, so quota pressure roughly doubles per turn. The orchestrator is pinned to `gemini-3.5-flash-lite`; test tool-selection reliability early, because a lite model choosing a new delegation function is the likeliest source of flaky demo behaviour. |
| Git-ignore the Python environment | The agent will live beside a Next.js repository that has no Python tooling configured. |

---

## 7. Effort

Net effect of the revised design is slightly **lower** than the original plan. Phase 02 shrinks, because the agent no longer duplicates Apex logic — it holds a catalogue and reasons over it. Phases 05 and 06 carry the new work.

| Phase | Work | Estimate |
|---|---|---|
| 01 | Review, and confirm the live MCP tool list | This report, plus one live session |
| 02–03 | ADK agent with ingested catalogue, exposed via `to_a2a` on port 8001 | ~0.5 day |
| 04 | Server-side A2A client: card fetch, skill check, task send, failure handling | ~0.5 day |
| 05 | Delegation capability (O2) plus payload re-plumbing (O3) | ~1 day |
| 06 | Progress events (O4) and the test rewrite (O6) | 0.25–1.25 days, per the O4 choice |
| — | Salesforce data model extension, *only if O1 takes that route* | Unbudgeted, on the critical path |

The schedule risk is not A2A. The SDKs do that work, and all of it checked out. The risk is whether the demo needs installed-device counts.

---

## 8. What could not be verified here

Stated so that nobody mistakes an untested assumption for a checked one. Each needs a live, authorised MCP session against the org.

- **The live tool list.** Tool names in this report come from test fixtures and configuration, not from a running `tools/list` call. Confirm the exact blocklist string before relying on R2.
- **Whether the custom MCP server publishes anything asset-like.** If it does, O1 is less severe than assessed. Nothing in the repository suggests it does.
- **The size and shape of the product catalogue.** The test fixture shows four room categories and a handful of products. If the real catalogue is large, the agent needs retrieval rather than a catalogue carried in its instruction.
- **Whether close-capability resolution currently holds by luck or by an ordering guarantee** (R3). It resolves correctly today; the mechanism was not confirmed against live discovery output.

---

*Assessed against the working tree at commit `bdbfbef`, clean status, full passing test run. File and line references point at the repository as of that commit.*

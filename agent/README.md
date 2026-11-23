# Property Upsell Agent

A standalone Google ADK agent, exposed over the A2A protocol, that recommends
home security products from a PDF catalogue using property details the calling
application has already verified against Salesforce.

It is recommendation-only: no tools, no external actions, no Salesforce writes.

```
A2A client  ──▶  ADK agent  ──▶  OpenRouter / Groq (via LiteLLM)
                     │
                     └── catalog/<one>.pdf  (text extracted at startup)
```

## Setup

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Copy `.env.example` to `.env` and fill in a provider key:

```powershell
Copy-Item .env.example .env
```

| Variable | Purpose |
| --- | --- |
| `LLM_PROVIDER` | `openrouter` (default) or `groq` |
| `OPENROUTER_API_KEY` / `GROQ_API_KEY` | provider key, server-side only |
| `OPENROUTER_MODEL` / `GROQ_MODEL` | must start with `openrouter/` or `groq/` |
| `A2A_HOST`, `A2A_PORT` | bind address, default `127.0.0.1:8001` |
| `CATALOG_DIR` | catalogue folder, default `catalog` |
| `MAX_CATALOG_CHARS` | extracted-text cap, default `120000` |

Switching provider needs no code change — edit `.env` only.

## Catalogue

Put **exactly one** text-based product catalogue PDF in `catalog/`.

At startup the text is extracted with PyMuPDF, page by page, and placed in the
agent's instructions so recommendations can cite real page numbers. There is no
vector store, no embedding, and no chunking — the catalogue is assumed small
enough for the model context.

Startup fails with an explicit message if the folder has no PDF or more than
one, if the PDF has no extractable text (scanned PDFs are not OCR'd), or if the
text exceeds `MAX_CATALOG_CHARS`. The agent never falls back to invented
product data.

## Run

```powershell
python -m uvicorn main:app --host 127.0.0.1 --port 8001
```

Agent card: <http://127.0.0.1:8001/.well-known/agent-card.json>
A2A JSON-RPC endpoint: <http://127.0.0.1:8001/>

## Example request

With the official A2A Python client:

```powershell
python example_request.py
```

Or directly over JSON-RPC from PowerShell:

```powershell
$payload = @{
  jsonrpc = "2.0"; id = "1"; method = "message/send"
  params = @{ message = @{
      messageId = "ps1"; role = "user"
      parts = @(@{ text = 'Recommend upsells. {"property": {"Bedrooms__c": 3, "Property_Type__c": "Detached House"}}' })
  }}
} | ConvertTo-Json -Depth 10

$r = Invoke-RestMethod -Uri "http://127.0.0.1:8001/" -Method Post `
       -ContentType "application/json" -Body $payload -TimeoutSec 280
$r.result.artifacts[0].parts[0].text
```

Both `message/send` and `message/stream` are supported. A cold request runs the
whole catalogue through the model, so allow a generous client timeout.

## Request shape

The caller sends a text message containing the Salesforce-verified property
object:

```json
{
  "property": {
    "Property_Size__c": 2400,
    "Bedrooms__c": 3,
    "Bathrooms__c": 2,
    "Year_Built__c": 2018,
    "Property_Type__c": "Detached House",
    "Security_System_Base__c": "Basic Security System",
    "Monitoring_Status__c": "Active"
  }
}
```

Every field is optional. A missing or null field is reported to the model as
unknown — it is never given a default, and the agent is instructed not to guess
it.

## Trust boundary

Incoming A2A content is treated as untrusted. Before each model call the
request is split into two blocks:

- **Verified property data** — only the seven whitelisted `__c` fields above,
  taken from the structured `property` object.
- **Request text** — everything else, including any free text and any
  unrecognised keys, labelled as data rather than instruction.

So a caller cannot smuggle extra property facts through prose, and cannot
redirect the agent by embedding instructions in the message.

The agent is additionally instructed never to invent products, prices or
specifications, never to infer door/window/sensor counts from a general system
description, to cite a catalogue page for every recommendation, and to put
anything unverified under *Onsite Verification*.

## Files

| File | Role |
| --- | --- |
| `agent.py` | agent, instructions, trust boundary, provider errors |
| `catalog_loader.py` | PDF text extraction with page markers |
| `main.py` | agent card + ASGI app via ADK's `to_a2a()` |
| `example_request.py` | one example request using the official A2A client |

"""Serve the Property Upsell Agent over the A2A protocol.

Run with:
    python -m uvicorn main:app --host 127.0.0.1 --port 8001

The ASGI app is built by Google ADK's own A2A integration (`to_a2a`), which
mounts the JSON-RPC task endpoint and the agent card. No part of the A2A
protocol is implemented by hand here.
"""

from __future__ import annotations

import asyncio
import os
import sys

from dotenv import load_dotenv

load_dotenv()

from google.adk.a2a.utils.agent_card_builder import AgentCardBuilder  # noqa: E402
from google.adk.a2a.utils.agent_to_a2a import to_a2a  # noqa: E402

from agent import ConfigError, build_agent_from_env  # noqa: E402
from catalog_loader import CatalogError  # noqa: E402

CARD_NAME = "Property Upsell Agent"
CARD_DESCRIPTION = (
    "Home security product recommendations using verified property information "
    "and PDF catalogue knowledge"
)
SKILL_NAME = "Property Upsell Recommendations"
SKILL_DESCRIPTION = (
    "Given property characteristics verified against Salesforce by the calling "
    "application, returns home security products drawn only from the loaded PDF "
    "catalogue, with a short reason and a page citation for each. "
    "Recommendation-only: the agent takes no action and modifies no records."
)
SKILL_EXAMPLE = (
    '{"property": {"Property_Type__c": "Detached House", "Bedrooms__c": 3, '
    '"Security_System_Base__c": "Basic Security System", '
    '"Monitoring_Status__c": "Active"}}'
)

HOST = os.getenv("A2A_HOST", "127.0.0.1")
PORT = int(os.getenv("A2A_PORT", "8001"))


def _fail(title: str, detail: str) -> None:
    print(f"\n[Property Upsell Agent] {title}\n", file=sys.stderr)
    print(detail, file=sys.stderr)
    print("", file=sys.stderr)
    raise SystemExit(1)


def _customise_card(card):
    """Rename the ADK-generated card and its skill for external discovery.

    ADK names the card after the Python agent id and calls its single skill
    "model"; the published card should carry the product-facing names.
    """
    card.name = CARD_NAME
    card.description = CARD_DESCRIPTION
    if card.skills:
        skill = card.skills[0]
        skill.id = "property_upsell_recommendations"
        skill.name = SKILL_NAME
        skill.description = SKILL_DESCRIPTION
        try:
            del skill.tags[:]
            skill.tags.extend(["home-security", "recommendations", "salesforce", "catalogue"])
            del skill.examples[:]
            skill.examples.append(SKILL_EXAMPLE)
        except (AttributeError, TypeError):
            # Pydantic-style card (a2a-sdk 0.3.x): assign instead of mutate.
            skill.tags = ["home-security", "recommendations", "salesforce", "catalogue"]
            skill.examples = [SKILL_EXAMPLE]
    return card


try:
    agent, catalog, provider, model_id = build_agent_from_env()
except CatalogError as exc:
    _fail("Catalogue configuration error", str(exc))
except ConfigError as exc:
    _fail("LLM configuration error", str(exc))

_card = asyncio.run(
    AgentCardBuilder(agent=agent, rpc_url=f"http://{HOST}:{PORT}/").build()
)

app = to_a2a(agent, host=HOST, port=PORT, agent_card=_customise_card(_card))

print(
    "\n[Property Upsell Agent] ready\n"
    f"  catalogue : {catalog.filename} ({catalog.page_count} pages, "
    f"{catalog.char_count:,} chars)\n"
    f"  provider  : {provider}\n"
    f"  model     : {model_id}\n"
    f"  agent card: http://{HOST}:{PORT}/.well-known/agent-card.json\n"
    f"  a2a rpc   : http://{HOST}:{PORT}/\n",
    flush=True,
)

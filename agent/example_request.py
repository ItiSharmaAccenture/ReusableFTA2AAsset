"""One example A2A request against a running Property Upsell Agent.

This stands in for the Next.js / Node.js client that will eventually call the
agent. It uses the official A2A client SDK: it resolves the agent card, sends a
text message carrying the Salesforce-verified property object, and prints the
recommendation.

    python example_request.py
    python example_request.py --url http://127.0.0.1:8001
"""

from __future__ import annotations

import argparse
import asyncio
import json
import uuid

import httpx
from a2a.client import ClientConfig, create_client
from a2a.types import Message, Part, Role, SendMessageRequest

# A cold request runs a full catalogue through the model, so allow for it.
REQUEST_TIMEOUT_SECONDS = 300.0

# What the calling application has already read from, and verified against,
# Salesforce. Illustrative values only.
PROPERTY_PAYLOAD = {
    "property": {
        "Property_Size__c": 2400,
        "Bedrooms__c": 3,
        "Bathrooms__c": 2,
        "Year_Built__c": 2018,
        "Property_Type__c": "Detached House",
        "Security_System_Base__c": "Basic Security System",
        "Monitoring_Status__c": "Active",
    }
}

PROMPT = (
    "Recommend suitable upsell products for this property.\n\n"
    + json.dumps(PROPERTY_PAYLOAD, indent=2)
)


def _text_of(parts) -> str:
    return "".join(part.text for part in parts if part.text)


async def main(url: str) -> None:
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as http_client:
        client = await create_client(url, ClientConfig(httpx_client=http_client))
        await _run(client)


async def _run(client) -> None:
    try:
        request = SendMessageRequest(
            message=Message(
                message_id=uuid.uuid4().hex,
                role=Role.ROLE_USER,
                parts=[Part(text=PROMPT)],
            )
        )

        # The stream carries the same text more than once (artifact updates, then
        # the finished task), so keep the latest and print it once at the end.
        answer = ""
        async for response in client.send_message(request):
            which = response.WhichOneof("payload")
            if which == "message":
                answer = _text_of(response.message.parts) or answer
            elif which == "task":
                task = response.task
                text = "\n".join(
                    _text_of(artifact.parts) for artifact in task.artifacts
                ).strip()
                answer = text or _text_of(task.status.message.parts) or answer
            elif which == "status_update":
                answer = _text_of(response.status_update.status.message.parts) or answer
            elif which == "artifact_update":
                answer = _text_of(response.artifact_update.artifact.parts) or answer

        print(answer or "(no text returned)")
    finally:
        await client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8001")
    asyncio.run(main(parser.parse_args().url))

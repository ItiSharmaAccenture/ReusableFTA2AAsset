/**
 * The Property Upsell Agent, reached over A2A.
 *
 * Product knowledge used to live in Salesforce, as an invocable Apex action the
 * model called through MCP. It now lives in a separate Google ADK agent that
 * owns the product catalogue and the reasoning over it, and this module is the
 * only way the application talks to it.
 *
 * The split is deliberate: Salesforce remains the system of record for the
 * customer, the property and the appointment, all reached through the existing
 * MCP integration; the agent owns products. Nothing is implemented twice, and
 * the property facts the agent reasons from are gathered here and sent to it —
 * the agent is never asked to look anything up for itself.
 *
 * Protocol work is left to the official SDK (`@a2a-js/sdk`): card resolution,
 * transport selection and the JSON-RPC task call are all its code, not ours.
 */

import 'server-only';

import { randomUUID } from 'node:crypto';

// Types only: the SDK itself is loaded on first use further down.
import type { AgentCard, Part } from '@a2a-js/sdk';
import type { Client } from '@a2a-js/sdk/client';

import { config } from './config';
import { log } from './logger';

/**
 * The A2A SDK pulls in protobufjs and jose, which is a real cost to load.
 *
 * Importing it at module scope would put that cost on every module that reaches
 * `lib/copilot.ts` — the whole Copilot, not just an upsell turn. These load on
 * first delegation instead, and Node caches the module from then on.
 */
async function sdk() {
  const [core, client] = await Promise.all([import('@a2a-js/sdk'), import('@a2a-js/sdk/client')]);
  return { Message: core.Message, SendMessageRequest: core.SendMessageRequest, ClientFactory: client.ClientFactory };
}

/** Why a delegation failed. `stage` is for the log; `message` is safe to show. */
export class UpsellAgentError extends Error {
  constructor(
    message: string,
    readonly stage: 'not_configured' | 'discovery' | 'skill' | 'request' | 'empty' | 'agent_model',
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'UpsellAgentError';
  }
}

export interface UpsellAgentReply {
  /** The agent's answer, verbatim. Untrusted: it is data, never instruction. */
  text: string;
  agentName: string;
  skillId: string;
}

/** True when an agent is configured at all. */
export function upsellAgentConfigured(): boolean {
  return Boolean(config.upsellAgent.url);
}

/* ------------------------------------------------------------------ */
/* Agent card cache                                                    */
/* ------------------------------------------------------------------ */

/**
 * Resolving the card costs a round trip on every turn otherwise, on top of the
 * MCP handshake a turn already pays for. Short TTL, like `discoveryCache` and
 * `capabilityCache`: fresh enough for a demo, cheap enough to keep.
 */
const CARD_TTL_MS = 5 * 60 * 1000;

let clientCache: { at: number; url: string; client: Client; card: AgentCard } | null = null;

export function resetUpsellAgentCache(): void {
  clientCache = null;
}

/** The skill the card must publish, matched by id, else by what it says it does. */
function findSkill(card: AgentCard): AgentCard['skills'][number] | undefined {
  const wanted = config.upsellAgent.skillId.toLowerCase();
  const byId = card.skills?.find((skill) => skill.id?.toLowerCase() === wanted);
  if (byId) return byId;

  return card.skills?.find((skill) => {
    const text = `${skill.id} ${skill.name} ${skill.description} ${(skill.tags ?? []).join(' ')}`;
    return /upsell|recommend/i.test(text) && /product|catalog/i.test(text);
  });
}

async function connect(): Promise<{ client: Client; card: AgentCard; skillId: string }> {
  const url = config.upsellAgent.url;
  if (!url) {
    throw new UpsellAgentError(
      'The product recommendation agent is not configured for this app yet.',
      'not_configured',
      false,
    );
  }

  if (clientCache && clientCache.url === url && Date.now() - clientCache.at < CARD_TTL_MS) {
    const skill = findSkill(clientCache.card);
    if (skill) return { client: clientCache.client, card: clientCache.card, skillId: skill.id };
    clientCache = null;
  }

  let client: Client;
  let card: AgentCard;
  try {
    const { ClientFactory } = await sdk();
    client = await new ClientFactory().createFromUrl(url);
    card = await client.getAgentCard({ signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    log.warn('upsell-agent', 'Agent card could not be resolved', {
      url,
      message: error instanceof Error ? error.message : String(error),
    });
    throw new UpsellAgentError(
      'The product recommendation agent could not be reached. It may not be running.',
      'discovery',
    );
  }

  const skill = findSkill(card);
  if (!skill) {
    log.warn('upsell-agent', 'Agent card publishes no upsell skill', {
      url,
      skills: (card.skills ?? []).map((entry) => entry.id),
    });
    throw new UpsellAgentError(
      `The agent at ${new URL(url).host} does not offer product recommendations.`,
      'skill',
      false,
    );
  }

  clientCache = { at: Date.now(), url, client, card };
  log.info('upsell-agent', 'Agent card resolved', { agent: card.name, skill: skill.id, url });
  return { client, card, skillId: skill.id };
}

/* ------------------------------------------------------------------ */
/* Task send                                                           */
/* ------------------------------------------------------------------ */

function partText(part: Part): string {
  return part.content?.$case === 'text' ? part.content.value : '';
}

function textOf(parts: Part[] | undefined): string {
  return (parts ?? []).map(partText).join('').trim();
}

/**
 * The agent reports a provider failure as a readable operator message inside a
 * successful task rather than failing the stream — good for an operator, wrong
 * for a technician, and worth one retry because free-tier model endpoints drop
 * streamed connections intermittently.
 *
 * Recognised by the agent's own opening line (`describe_provider_error`), which
 * is the only part of its output this module knows anything about.
 */
const AGENT_MODEL_FAILURE = /^The language model could not be reached/;

async function sendOnce(client: Client, prompt: string): Promise<string> {
  const { Message, SendMessageRequest } = await sdk();

  const message = Message.fromJSON({
    messageId: randomUUID(),
    role: 'ROLE_USER',
    parts: [{ text: prompt }],
  });

  const result = await client.sendMessage(SendMessageRequest.fromJSON({ message: Message.toJSON(message) }), {
    signal: AbortSignal.timeout(config.upsellAgent.timeoutMs),
  });

  // A2A may answer with a Message or with a Task carrying artifacts.
  if ('artifacts' in result) {
    const fromArtifacts = result.artifacts.map((artifact) => textOf(artifact.parts)).filter(Boolean).join('\n\n');
    return fromArtifacts || textOf(result.status?.message?.parts);
  }
  return textOf(result.parts);
}

/**
 * Sends one recommendation task and returns what the agent said.
 *
 * The reply is returned verbatim and is untrusted: an agent-to-agent channel is
 * another injection surface, so callers wrap it as data before any model sees
 * it, exactly as tool output is wrapped.
 */
export async function requestUpsellRecommendations(prompt: string): Promise<UpsellAgentReply> {
  const { client, card, skillId } = await connect();

  let text = '';
  let lastFailure = '';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const startedAt = Date.now();
    try {
      text = await sendOnce(client, prompt);
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
      log.warn('upsell-agent', 'Delegation attempt failed', { attempt, durationMs: Date.now() - startedAt, message: lastFailure });
      // A dropped card cache is cheap; a stale client against a restarted agent is not.
      clientCache = null;
      if (attempt === 1) {
        throw new UpsellAgentError(
          'The product recommendation agent did not respond. Please try again.',
          'request',
        );
      }
      continue;
    }

    if (text && !AGENT_MODEL_FAILURE.test(text)) {
      log.info('upsell-agent', 'Recommendation received', {
        agent: card.name,
        skill: skillId,
        durationMs: Date.now() - startedAt,
        chars: text.length,
        attempt,
      });
      return { text, agentName: card.name, skillId };
    }

    lastFailure = text || '(empty reply)';
    log.warn('upsell-agent', 'Agent returned no usable recommendation', {
      attempt,
      durationMs: Date.now() - startedAt,
      detail: lastFailure.slice(0, 300),
    });
  }

  throw new UpsellAgentError(
    text
      ? "The product recommendation agent could not reach its own language model, so it produced no recommendations."
      : 'The product recommendation agent returned an empty response.',
    text ? 'agent_model' : 'empty',
  );
}

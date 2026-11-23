/**
 * Turns a Salesforce-verified property into the request the Property Upsell
 * Agent accepts.
 *
 * The agent treats exactly seven fields as verified fact and reports anything
 * else as caller-supplied text. Those seven are the contract between the two
 * systems, so the mapping is explicit here rather than inferred: a field the
 * org does not return is simply absent, and the agent is told to treat it as
 * unknown rather than assume a default.
 *
 * Nothing in this module invents a value. If Salesforce did not return it, it
 * does not reach the agent.
 */

import type { AccountProperty } from './copilot';

/** The fields the agent will reason from. Any other key is data, not fact. */
export const AGENT_PROPERTY_FIELDS = [
  'Property_Size__c',
  'Bedrooms__c',
  'Bathrooms__c',
  'Year_Built__c',
  'Property_Type__c',
  'Security_System_Base__c',
  'Monitoring_Status__c',
] as const;

export type AgentPropertyField = (typeof AGENT_PROPERTY_FIELDS)[number];

/**
 * Salesforce key spellings accepted for each agent field.
 *
 * The custom MCP server returns camelCase (`propertySizeSqFt`), but an org that
 * exposes the custom fields directly returns `Property_Size__c`. Both normalise
 * to the same entry, so neither needs a code change.
 */
const SOURCE_KEYS: Record<AgentPropertyField, string[]> = {
  Property_Size__c: ['propertysize', 'propertysizesqft', 'propertysizesquarefeet', 'squarefeet', 'sqft', 'size'],
  Bedrooms__c: ['bedrooms', 'bedroomcount', 'numberofbedrooms', 'beds'],
  Bathrooms__c: ['bathrooms', 'bathroomcount', 'numberofbathrooms', 'baths'],
  Year_Built__c: ['yearbuilt', 'builtyear', 'constructionyear'],
  Property_Type__c: ['propertytype', 'hometype', 'type'],
  Security_System_Base__c: ['securitysystembase', 'securitysystem', 'basesecuritysystem', 'systembase'],
  Monitoring_Status__c: ['monitoringstatus', 'monitoring'],
};

/** `Property_Size__c`, `propertySizeSqFt` and `property_size` all compare equal. */
function normaliseKey(key: string): string {
  return key.replace(/__c$/i, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

/** A number stays a number; everything else goes as the string Salesforce returned. */
function scalar(value: string | number): string | number {
  if (typeof value === 'number') return value;
  const trimmed = value.trim();
  if (trimmed === '') return trimmed;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && /^-?\d+(\.\d+)?$/.test(trimmed) ? parsed : trimmed;
}

export interface UpsellAgentPayload {
  property: Partial<Record<AgentPropertyField, string | number>>;
}

/**
 * Maps one property's returned fields onto the agent's contract.
 *
 * Returns only the fields Salesforce actually supplied. The agent lists the
 * rest as not supplied and is instructed not to guess them, so an absent field
 * is a stated unknown rather than a silent gap.
 */
export function toAgentPayload(property: AccountProperty): UpsellAgentPayload {
  const byNormalised = new Map<string, string | number>();
  for (const [key, value] of Object.entries(property.fields)) {
    byNormalised.set(normaliseKey(key), value);
  }

  const mapped: Partial<Record<AgentPropertyField, string | number>> = {};
  for (const field of AGENT_PROPERTY_FIELDS) {
    for (const candidate of SOURCE_KEYS[field]) {
      const value = byNormalised.get(candidate);
      if (value !== undefined && value !== '') {
        mapped[field] = scalar(value);
        break;
      }
    }
  }

  return { property: mapped };
}

/** Agent fields this property could not supply, named as the agent names them. */
export function missingAgentFields(payload: UpsellAgentPayload): AgentPropertyField[] {
  return AGENT_PROPERTY_FIELDS.filter((field) => payload.property[field] === undefined);
}

/**
 * The message sent to the agent: a short instruction, then the payload.
 *
 * Context that is not one of the seven verified fields — the account name, the
 * property's own name, the job — is deliberately left in the prose, where the
 * agent treats it as untrusted data rather than as a property fact.
 */
export function buildAgentPrompt(input: {
  payload: UpsellAgentPayload;
  accountName: string;
  propertyName: string;
  otherPropertyCount: number;
  jobSubject?: string | null;
}): string {
  const lines = [
    'Recommend suitable upsell products for this property.',
    '',
    `The property below belongs to the account "${input.accountName}" and is recorded in Salesforce as "${input.propertyName}".`,
  ];

  if (input.otherPropertyCount > 0) {
    lines.push(
      `That account has ${input.otherPropertyCount} other propert${input.otherPropertyCount === 1 ? 'y' : 'ies'} on record; this request is about this one only.`,
    );
  }
  if (input.jobSubject) {
    lines.push(`The technician is on site for: ${input.jobSubject.replace(/\s+/g, ' ').slice(0, 160)}.`);
  }

  lines.push('', JSON.stringify(input.payload, null, 2));
  return lines.join('\n');
}

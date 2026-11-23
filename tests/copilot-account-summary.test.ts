/**
 * Account summary results: the property details arrive as JSON inside a
 * string, so the Copilot unpacks them into plain lines before Gemini sees them.
 */

import { describe, expect, it } from 'vitest';

import {
  copilotInstruction,
  customerPropertyFrom,
  digestAccountSummary,
  digestAgentRecommendations,
  readAccountSummary,
} from '@/lib/copilot';
import { toTechnician } from '@/lib/technician';
import { toAgentPayload } from '@/lib/upsell-payload';
import { validateToolArguments, wrapActionInputs, type ApprovedTool } from '@/lib/tool-allowlist';

const summaryData = {
  moreMatchesExist: false,
  accounts: [
    {
      properties: [
        {
          monitoringStatus: 'In Service',
          securitySystemBase: 'Command panel',
          propertyType: 'Townhome',
          yearBuilt: 2012,
          bathrooms: 2,
          bedrooms: 3,
          propertySizeSqFt: 1610.0,
          propertyName: 'Alvarez Residence',
          propertyId: 'a4pg7000000Ys2nAAC',
        },
      ],
      contactNames: ['John Smith'],
      serviceAddress: { country: 'China', postalCode: '200030', state: null, city: 'Shanghai', street: '355 Hong Qiao Lu' },
      accountName: 'Biospan, LLC.',
      accountId: '001g700001BxWZiAAN',
    },
  ],
};

/** The shape Salesforce returns for the invocable action. */
const response = {
  content: [
    {
      actionName: 'GetAccountPropertySummary',
      errors: null,
      isSuccess: true,
      outputValues: {
        accountSummaryData: JSON.stringify(summaryData),
        message: 'Account found successfully. Generate an Account Summary using the returned information.',
        status: 'FOUND',
      },
    },
  ],
};

describe('digestAccountSummary', () => {
  const digest = digestAccountSummary(response);

  it('unpacks the JSON-encoded account data', () => {
    expect(digest).not.toBeNull();
    expect(digest).toContain('Biospan, LLC.');
    expect(digest).toContain('Contacts: John Smith');
    expect(digest).toContain('Service address: 355 Hong Qiao Lu, Shanghai, 200030, China');
  });

  it('lists every property detail', () => {
    for (const line of [
      'Alvarez Residence',
      'Property type: Townhome',
      'Year built: 2012',
      'Bedrooms: 3',
      'Bathrooms: 2',
      'Property size (sq ft): 1610',
      'Security system base: Command panel',
      'Monitoring status: In Service',
    ]) {
      expect(digest).toContain(line);
    }
  });

  it('leaves out record Ids', () => {
    expect(digest).not.toContain('a4pg7000000Ys2nAAC');
    expect(digest).not.toContain('001g700001BxWZiAAN');
  });

  it('says when no account matched', () => {
    const empty = { content: [{ outputValues: { accountSummaryData: '{"accounts":[]}', status: 'NOT_FOUND' } }] };
    expect(digestAccountSummary(empty)).toContain('No matching accounts were returned.');
  });

  it('ignores other tools’ results', () => {
    expect(digestAccountSummary({ content: [{ outputValues: { products: [] } }] })).toBeNull();
    expect(digestAccountSummary({ appointments: [] })).toBeNull();
  });
});

describe('Apex action arguments', () => {
  const action: ApprovedTool = {
    name: 'GetAccountPropertySummaryapex_GetAccountPropertySummary',
    description: 'Account summary',
    inputSchema: {
      type: 'object',
      properties: {
        inputs: {
          type: 'array',
          items: { type: 'object', required: ['accountName'], properties: { accountName: { type: 'string' } } },
        },
      },
      additionalProperties: false,
    },
  };

  it('wraps flat fields into inputs instead of dropping them', () => {
    const result = validateToolArguments(action, { accountName: 'Biospan, LLC.' });
    expect(result).toMatchObject({ ok: true, args: { inputs: [{ accountName: 'Biospan, LLC.' }] } });
  });

  it('wraps a single inputs object into an array', () => {
    expect(wrapActionInputs(action, { inputs: { accountName: 'Biospan' } })).toEqual({ inputs: [{ accountName: 'Biospan' }] });
  });

  it('leaves correctly shaped and non-Apex arguments alone', () => {
    const shaped = { inputs: [{ accountName: 'Biospan' }] };
    expect(wrapActionInputs(action, shaped)).toBe(shaped);
    const plain: ApprovedTool = { ...action, inputSchema: { type: 'object', properties: { q: { type: 'string' } } } };
    expect(wrapActionInputs(plain, { q: 'x' })).toEqual({ q: 'x' });
  });
});

describe('account summary instruction', () => {
  const accountTool: ApprovedTool = {
    name: 'GetAccountPropertySummaryapex_GetAccountPropertySummary',
    description: 'Search Salesforce Accounts by full or partial Account name and retrieve information for an AI-generated Account Summary.',
    inputSchema: { type: 'object', properties: {} },
  };

  it('names the account tool and insists on calling it', () => {
    const instruction = copilotInstruction(toTechnician('Sayantan Pal', 'TCH-7842'), {}, [accountTool]);
    expect(instruction).toContain(`always call ${accountTool.name}`);
    expect(instruction).toMatch(/appointment data never includes contacts or property details/);
  });
});

/**
 * The property half of an upsell. The products now come from the A2A agent, but
 * what reaches it still has to be a property Salesforce actually returned —
 * this is the regression net for "never invent a property detail".
 */
describe('upsell property context', () => {
  const summary = readAccountSummary(response);

  it('sends the exact matching account’s verified property details to the agent', () => {
    const property = customerPropertyFrom(summary, 'Biospan, LLC.');
    expect(property.available).toBe(true);
    if (!property.available) return;

    // The values crossing to the agent are the ones Salesforce returned, under
    // the field names the agent treats as verified.
    expect(toAgentPayload(property.properties[0])).toEqual({
      property: {
        Property_Type__c: 'Townhome',
        Property_Size__c: 1610,
        Bedrooms__c: 3,
        Bathrooms__c: 2,
        Year_Built__c: 2012,
        Security_System_Base__c: 'Command panel',
        Monitoring_Status__c: 'In Service',
      },
    });

    const digest = digestAgentRecommendations({
      property,
      agentText: '1. Smart Lock — Source: catalogue.pdf, page 2',
      agentName: 'Property Upsell Agent',
      propertyName: property.properties[0].name,
      missingFields: [],
    });
    expect(digest).toContain('verified from the Salesforce account summary for Biospan, LLC.');
    expect(digest).toContain('Alvarez Residence');
  });

  it('reports missing property details instead of guessing', () => {
    expect(customerPropertyFrom(readAccountSummary({ content: [{ outputValues: { accountSummaryData: '{"accounts":[]}' } }] }), 'Nobody'))
      .toEqual({ available: false, reason: 'Salesforce found no account named "Nobody"' });

    const noProps = { accounts: [{ accountName: 'Biospan, LLC.', properties: [] }] };
    expect(customerPropertyFrom(readAccountSummary(noProps), 'Biospan, LLC.').available).toBe(false);

    // No verified property means the agent is never asked, and the model is
    // told to recommend nothing rather than fall back on its own knowledge.
    const digest = digestAgentRecommendations({
      property: { available: false, reason: 'no appointment is selected or named, so the customer is not known' },
    });
    expect(digest).toContain('no appointment is selected or named');
    expect(digest).toContain('Do not recommend any product, and do not mention or assume any property detail');
  });

  it('treats several partial matches as ambiguous', () => {
    const two = { accounts: [{ accountName: 'Biospan East', properties: [{ propertyName: 'A' }] }, { accountName: 'Biospan West', properties: [{ propertyName: 'B' }] }] };
    const property = customerPropertyFrom(readAccountSummary(two), 'Biospan');
    expect(property).toMatchObject({ available: false });
    expect(!property.available && property.reason).toMatch(/2 accounts matching/);
  });
});

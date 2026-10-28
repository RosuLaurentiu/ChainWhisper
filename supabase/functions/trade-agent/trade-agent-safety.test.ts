import {
  findDisallowedTradeAgentContextMaterial,
  findProhibitedTradeAgentMaterial,
  getSemanticTradeAgentPreflightError,
  hasUnresolvedTradeAgentPlaceholders
} from './trade-agent-safety.ts';
import { redactTradeAgentSecrets } from '../_shared/trade-agent-redaction.ts';

const assert = (condition: unknown, message = 'Assertion failed'): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const PRIVATE_LINK_CODE = 'VQEAAAAAABYBI0VniavN7wEjRWeJq83vASNFZ4mrze8BI0VniavN7w';

Deno.test('rejects secrets and private order links before redaction', () => {
  assert(findProhibitedTradeAgentMaterial({ accessSecret: `0x${'12'.repeat(32)}` }) !== null);
  assert(findProhibitedTradeAgentMaterial(`Open /otc/order/link/${PRIVATE_LINK_CODE}`) !== null);
  assert(findProhibitedTradeAgentMaterial(`/otcdesk/terminal/l/${PRIVATE_LINK_CODE}`) !== null);
  assert(findProhibitedTradeAgentMaterial(encodeURIComponent(`/otcdesk/terminal/l/${PRIVATE_LINK_CODE}`)) !== null);
  assert(findProhibitedTradeAgentMaterial(
    Array.from({ length: 4 }).reduce<string>(
      (value) => encodeURIComponent(value),
      `/otcdesk/terminal/l/${PRIVATE_LINK_CODE}`
    )
  ) !== null);
  assert(findProhibitedTradeAgentMaterial(
    Array.from({ length: 6 }).reduce<string>(
      (value) => `?p=${encodeURIComponent(value)}`,
      `/otcdesk/terminal/l/${PRIVATE_LINK_CODE}`
    )
  ) !== null);
  assert(findProhibitedTradeAgentMaterial(
    `?noise=%ZZ&p=${encodeURIComponent(`/otcdesk/terminal/l/${PRIVATE_LINK_CODE}`)}`
  ) !== null);
  assert(findProhibitedTradeAgentMaterial(PRIVATE_LINK_CODE) !== null);
  assert(findProhibitedTradeAgentMaterial(`private key: 0x${'34'.repeat(32)}`) !== null);
  assert(findProhibitedTradeAgentMaterial('34'.repeat(32)) !== null);
  assert(findProhibitedTradeAgentMaterial('test test test test test test test test test test test junk') !== null);
  assert(findProhibitedTradeAgentMaterial(`${'abandon '.repeat(23)}art`) !== null);
  assert(findProhibitedTradeAgentMaterial('Compare WISP with COTI') === null);
  assert(findProhibitedTradeAgentMaterial('/otcdesk/terminal/l/VgAW') === null);
  const redacted = redactTradeAgentSecrets({ clientSecret: 'provider-specific-opaque-value' });
  assert(
    (redacted as { clientSecret?: unknown }).clientSecret === '[redacted-access-secret]',
    'Expected provider-specific secret keys to remain redacted.'
  );
});

Deno.test('detects unresolved paid-action placeholders', () => {
  assert(hasUnresolvedTradeAgentPlaceholders('Buy [amount] WISP'));
  assert(!hasUnresolvedTradeAgentPlaceholders('Buy 1 WISP'));
});

Deno.test('allows escrow identity but blocks wallet addresses and private state elsewhere', () => {
  assert(findDisallowedTradeAgentContextMaterial({
    openedOrder: {
      tradeId: 7,
      escrowContract: '0x1111111111111111111111111111111111111111'
    }
  }) === null);
  assert(findDisallowedTradeAgentContextMaterial({
    selectedMessage: {
      text: 'Send to 0x2222222222222222222222222222222222222222'
    }
  }) !== null);
  assert(findDisallowedTradeAgentContextMaterial({ privateInventory: '10' }) !== null);
});

Deno.test('semantic preflight allows missing details but rejects ambiguity and invalid supplied values', () => {
  assert(getSemanticTradeAgentPreflightError({
    action: 'find_price',
    context: {},
    prompt: 'I want to buy and sell 1 WISP with COTI.'
  }).includes('one direction'));
  assert(getSemanticTradeAgentPreflightError({
    action: 'find_price',
    context: {},
    prompt: 'Compare WISP and COTI price references for a buy request without an amount.'
  }) === '');
  assert(getSemanticTradeAgentPreflightError({
    action: 'draft_limit',
    context: {},
    prompt: 'Help me draft a limit order for WISP and COTI.'
  }) === '');
  assert(getSemanticTradeAgentPreflightError({
    action: 'find_price',
    context: {},
    prompt: 'I want to buy 0 WISP with COTI.'
  }).includes('must be positive'));
  assert(getSemanticTradeAgentPreflightError({
    action: 'find_price',
    context: {},
    prompt: 'I want to buy 1.1234567 WISP with COTI.'
  }).includes('precision'));
  assert(getSemanticTradeAgentPreflightError({
    action: 'find_price',
    context: {},
    prompt: 'I want to buy 1 WISP with COTI.'
  }) === '');
});

Deno.test('semantic recurring preflight allows missing terms and validates supplied terms', () => {
  assert(getSemanticTradeAgentPreflightError({
    action: 'draft_recurring',
    context: {},
    prompt:
      'Recurring WISP / COTI. Buy price: 2. Sell price: 3. Buy budget: 10. Sell inventory: 4. Amounts: visible.'
  }) === '');
  assert(getSemanticTradeAgentPreflightError({
    action: 'draft_recurring',
    context: {},
    prompt: 'Help me draft a recurring WISP / COTI order.'
  }) === '');
  assert(getSemanticTradeAgentPreflightError({
    action: 'draft_recurring',
    context: {},
    prompt:
      'Recurring WISP / COTI. Buy price: 2. Sell price: 3. Buy budget: 0. Sell inventory: 4. Amounts: visible.'
  }).includes('positive'));
});

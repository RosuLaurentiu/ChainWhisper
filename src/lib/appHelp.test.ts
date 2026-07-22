import { describe, expect, it } from 'vitest';
import { redactTradeAgentSecretText } from '../../supabase/functions/_shared/trade-agent-redaction';
import {
  APP_HELP_MAX_QUESTION_CHARS,
  APP_HELP_QUICK_QUESTIONS,
  APP_HELP_TOPICS,
  getAppHelpTopic,
  isTrustedAppHelpRoute,
  matchAppHelpTopics,
  normalizeAppHelpCurrentPath,
  normalizeAppHelpResponse,
  resolveAppHelpOnClient,
  resolveLocalAppHelpAnswer
} from './appHelp';

describe('appHelp knowledge matching', () => {
  it('keeps quick questions and curated answers concise', () => {
    APP_HELP_QUICK_QUESTIONS.forEach(({ label, question }) => {
      expect(label.trim().split(/\s+/u).length).toBeLessThanOrEqual(4);
      expect(question.trim().split(/\s+/u).length).toBeLessThanOrEqual(7);
    });
    APP_HELP_TOPICS.forEach(({ answer }) => {
      expect(answer.trim().split(/\s+/u).length).toBeLessThanOrEqual(45);
    });
  });

  it('answers curated questions locally without an API request', () => {
    const resolution = resolveAppHelpOnClient('What does the Privacy Portal do?', '/otc/agent');
    expect(resolution.kind).toBe('local');
    if (resolution.kind !== 'local') {
      throw new Error('Expected a local App Help answer');
    }
    expect(resolution.response.source).toBe('local');
    expect(resolution.response.topicId).toBe('privacy-portal');
  });

  it('handles common spelling and natural-language variants locally', () => {
    const answer = resolveLocalAppHelpAnswer('How do I use my ChainWisper acount and owner walet?', '/');
    expect(answer?.topicId).toBe('owner-and-chainwhisper-accounts');
    expect(answer?.confidence).toBe('high');
  });

  it('uses the current route to rank otherwise ambiguous questions', () => {
    const match = matchAppHelpTopics('How do orders work?', '/otc/orders');
    expect(match.topic?.id).toBe('links-counters-and-settlement');
    expect(match.confidence).toBe('moderate');
  });

  it('sends only moderate, relevant questions to the grounded fallback', () => {
    const resolution = resolveAppHelpOnClient('Tell me more about treasury', '/');
    expect(resolution.kind).toBe('remote');
    if (resolution.kind !== 'remote') {
      throw new Error('Expected a remote App Help fallback');
    }
    expect(resolution.match.topic?.id).toBe('treasury-data');
    expect(resolution.match.confidence).toBe('moderate');
  });

  it('refuses off-topic questions locally', () => {
    const resolution = resolveAppHelpOnClient('Write a poem about the weather on Mars.', '/otc/agent');
    expect(resolution.kind).toBe('refusal');
    if (resolution.kind !== 'refusal') {
      throw new Error('Expected a local refusal');
    }
    expect(resolution.response.source).toBe('refusal');
    expect(resolution.response.topicId).toBeNull();
  });

  it('rejects questions above the client and server character cap', () => {
    const resolution = resolveAppHelpOnClient('x'.repeat(APP_HELP_MAX_QUESTION_CHARS + 1), '/chat');
    expect(resolution).toMatchObject({ kind: 'invalid' });
  });
});

describe('appHelp response and route safety', () => {
  it('normalizes a grounded response and drops unknown related topics', () => {
    expect(
      normalizeAppHelpResponse({
        answer: 'Use the owner wallet for recovery.',
        relatedTopicIds: ['privacy-and-recovery', 'privacy-and-recovery', 'not-a-topic'],
        source: 'nano',
        topicId: 'owner-and-chainwhisper-accounts'
      })
    ).toEqual({
      answer: 'Use the owner wallet for recovery.',
      relatedTopicIds: ['privacy-and-recovery'],
      source: 'nano',
      topicId: 'owner-and-chainwhisper-accounts'
    });
  });

  it('rejects model-generated or unknown source routes', () => {
    expect(isTrustedAppHelpRoute('/chat')).toBe(true);
    expect(isTrustedAppHelpRoute('https://example.com')).toBe(false);
    expect(getAppHelpTopic('not-a-topic')).toBeNull();
    expect(() => normalizeAppHelpResponse({ answer: 'No', source: 'nano', topicId: 'not-a-topic' })).toThrow(
      'unknown topic'
    );
  });

  it('canonicalizes only known current app paths', () => {
    expect(normalizeAppHelpCurrentPath('/messages?thread=1')).toBe('/chat');
    expect(normalizeAppHelpCurrentPath('/otc/order/42')).toBe('/otc/orders');
    expect(normalizeAppHelpCurrentPath('https://example.com/otc')).toBe('/');
  });

  it('redacts private order material from free-help questions too', () => {
    const secret = `0x${'a'.repeat(64)}`;
    expect(redactTradeAgentSecretText(`Help with /otc/order/link/PRIVATECODE#${secret}`)).toBe(
      'Help with /otc/order/link/[redacted-trade-link]#[redacted-access-secret]'
    );
  });
});

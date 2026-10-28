import { describe, expect, it } from 'vitest';
import { redactTradeAgentSecretText } from '../../supabase/functions/_shared/trade-agent-redaction';
import { encodeTradeLink } from './tradeLinks';
import {
  APP_HELP_MAX_QUESTION_CHARS,
  APP_HELP_QUICK_QUESTIONS,
  APP_HELP_TOPICS,
  buildAppHelpAiResult,
  containsSensitiveAppHelpMaterial,
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
    APP_HELP_TOPICS.forEach(({ aliases, answer, cautions, prerequisites, relatedTopicIds, steps, summary, surfaceAffinity }) => {
      expect(answer.trim().split(/\s+/u).length).toBeLessThanOrEqual(45);
      expect(summary.trim()).not.toBe('');
      expect(aliases.length).toBeGreaterThan(0);
      expect(Array.isArray(prerequisites)).toBe(true);
      expect(steps.length).toBeGreaterThan(0);
      expect(Array.isArray(cautions)).toBe(true);
      expect(relatedTopicIds.length).toBeGreaterThan(0);
      expect(surfaceAffinity.length).toBeGreaterThan(0);
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
    expect(answer?.topicId).toBe('browser-wallet');
    expect(answer?.confidence).toBe('high');
  });

  it('uses the current route to rank otherwise ambiguous questions', () => {
    const match = matchAppHelpTopics('How do orders work?', '/otc/orders');
    expect(match.topic?.id).toBe('links-counters-and-settlement');
    expect(match.confidence).toBe('high');
  });

  it('sends only moderate, relevant questions to the grounded fallback', () => {
    const resolution = resolveAppHelpOnClient('Tell me more about treasury', '/');
    expect(resolution.kind).toBe('remote');
    if (resolution.kind !== 'remote') {
      throw new Error('Expected a remote App Help fallback');
    }
    expect(resolution.match.topic?.id).toBe('private-tvl');
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

  it('clarifies ambiguous relevant questions without calling the remote fallback', () => {
    const resolution = resolveAppHelpOnClient('Help with my balance', '/otc');
    expect(resolution.kind).toBe('clarification');
    if (resolution.kind !== 'clarification') {
      throw new Error('Expected clarification choices');
    }
    expect(resolution.topicIds.length).toBeGreaterThan(1);
    expect(resolution.topicIds.length).toBeLessThanOrEqual(3);
  });

  it('blocks private material before matching or remote help', () => {
    const secret = `0x${'a'.repeat(64)}`;
    const resolution = resolveAppHelpOnClient(`/otc/order/link/PRIVATECODE#${secret}`, '/otc/agent');
    expect(resolution.kind).toBe('refusal');
    if (resolution.kind !== 'refusal') {
      throw new Error('Expected a safety refusal');
    }
    expect(resolution.response).toMatchObject({
      relatedTopicIds: [],
      source: 'refusal',
      topicId: null
    });
  });

  it('blocks bare wallet credentials and encoded legacy private links', () => {
    const privateCode = encodeTradeLink(22, `0x${'ab'.repeat(32)}`);
    const cases = [
      'test test test test test test test test test test test junk',
      'cd'.repeat(32),
      `/otcdesk/terminal/l/${privateCode}`,
      `?p=${encodeURIComponent(`/otcdesk/terminal/l/${privateCode}`)}`,
      privateCode
    ];

    cases.forEach((question) => {
      expect(resolveAppHelpOnClient(question, '/otc/agent').kind, question).toBe('refusal');
    });
  });

  it('allows ordinary prose and encoded public order links', () => {
    const publicCode = encodeTradeLink(22);

    expect(containsSensitiveAppHelpMaterial('How are private keys kept separate?')).toBe(false);
    expect(containsSensitiveAppHelpMaterial(`/otcdesk/terminal/l/${publicCode}`)).toBe(false);
  });

  it('blocks wallet addresses before invoking remote help', () => {
    const walletAddress = `0x${'a'.repeat(40)}`;
    const resolution = resolveAppHelpOnClient(`Tell me more about private TVL for ${walletAddress}`, '/');
    expect(resolution.kind).toBe('refusal');
    if (resolution.kind !== 'refusal') {
      throw new Error('Expected a client-side privacy refusal');
    }
    expect(resolution.response).toMatchObject({
      relatedTopicIds: [],
      source: 'refusal',
      topicId: null
    });
  });

  it('rejects questions above the client and server character cap', () => {
    const resolution = resolveAppHelpOnClient('x'.repeat(APP_HELP_MAX_QUESTION_CHARS + 1), '/chat');
    expect(resolution).toMatchObject({ kind: 'invalid' });
  });
});

describe('appHelp response and route safety', () => {
  it('converts unsupported or empty grounded output into a refusal without topic suggestions', () => {
    expect(
      buildAppHelpAiResult({
        answer: 'Model answer must not be used.',
        relatedTopicIds: ['privacy-and-recovery'],
        supported: false,
        topicId: 'privacy-portal'
      })
    ).toEqual({
      answer: 'I do not have enough verified ChainWhisper information to answer that.',
      relatedTopicIds: [],
      source: 'refusal',
      topicId: null
    });
    expect(
      buildAppHelpAiResult({
        answer: '  ',
        relatedTopicIds: ['privacy-and-recovery'],
        supported: true,
        topicId: 'privacy-portal'
      })
    ).toMatchObject({
      relatedTopicIds: [],
      source: 'refusal',
      topicId: null
    });
  });

  it('keeps supported grounded output AI-assisted with trusted topic metadata', () => {
    expect(
      buildAppHelpAiResult({
        answer: 'Use the Privacy Portal.',
        relatedTopicIds: ['privacy-and-recovery'],
        supported: true,
        topicId: 'privacy-portal'
      })
    ).toEqual({
      answer: 'Use the Privacy Portal.',
      relatedTopicIds: ['privacy-and-recovery'],
      source: 'ai',
      topicId: 'privacy-portal'
    });
  });

  it('refuses secret-bearing model output and rejects it again at the browser boundary', () => {
    const mnemonic = 'test test test test test test test test test test test junk';

    expect(
      buildAppHelpAiResult({
        answer: mnemonic,
        relatedTopicIds: ['privacy-and-recovery'],
        supported: true,
        topicId: 'privacy-portal'
      })
    ).toMatchObject({ source: 'refusal', topicId: null });
    expect(() => normalizeAppHelpResponse({
      answer: mnemonic,
      relatedTopicIds: [],
      source: 'ai',
      topicId: 'privacy-portal'
    })).toThrow('unsafe material');
  });

  it('normalizes a grounded response and drops unknown related topics', () => {
    expect(
      normalizeAppHelpResponse({
        answer: 'Use the selected browser wallet.',
        relatedTopicIds: ['privacy-and-recovery', 'privacy-and-recovery', 'not-a-topic'],
        source: 'nano',
        topicId: 'browser-wallet'
      })
    ).toEqual({
      answer: 'Use the selected browser wallet.',
      relatedTopicIds: ['privacy-and-recovery'],
      source: 'ai',
      topicId: 'browser-wallet'
    });
  });

  it('rejects model-generated or unknown source routes', () => {
    expect(isTrustedAppHelpRoute('/chat')).toBe(true);
    expect(isTrustedAppHelpRoute('https://example.com')).toBe(false);
    expect(getAppHelpTopic('not-a-topic')).toBeNull();
    expect(() => normalizeAppHelpResponse({ answer: 'No', source: 'ai', topicId: 'not-a-topic' })).toThrow(
      'unknown topic'
    );
  });

  it('forces refusal metadata to contain no topic suggestions', () => {
    expect(
      normalizeAppHelpResponse({
        answer: 'Do not share that.',
        relatedTopicIds: ['privacy-and-recovery'],
        source: 'refusal',
        topicId: 'privacy-and-recovery'
      })
    ).toEqual({
      answer: 'Do not share that.',
      relatedTopicIds: [],
      source: 'refusal',
      topicId: null
    });
  });

  it('canonicalizes only known current app paths', () => {
    expect(normalizeAppHelpCurrentPath('/messages?thread=1')).toBe('/chat');
    expect(normalizeAppHelpCurrentPath('/otc/order/42')).toBe('/otc/orders');
    expect(normalizeAppHelpCurrentPath('https://example.com/otc')).toBe('/');
  });

  it('redacts private order material from free-help questions too', () => {
    const secret = `0x${'a'.repeat(64)}`;
    const privateCode = encodeTradeLink(22, secret);
    expect(redactTradeAgentSecretText(`Help with /otc/order/link/${privateCode}#${secret}`)).toBe(
      'Help with /otc/order/link/[redacted-trade-link]#[redacted-access-secret]'
    );
  });

  it('redacts bare credentials and bare private-link codes without altering public codes', () => {
    const mnemonic = 'test test test test test test test test test test test junk';
    const privateCode = encodeTradeLink(22, `0x${'ab'.repeat(32)}`);
    const publicCode = encodeTradeLink(22);

    expect(redactTradeAgentSecretText(`phrase ${mnemonic}`)).not.toContain(mnemonic);
    expect(redactTradeAgentSecretText(`key ${'cd'.repeat(32)}`)).not.toContain('cd'.repeat(32));
    expect(redactTradeAgentSecretText(`open ${privateCode}`)).not.toContain(privateCode);
    expect(redactTradeAgentSecretText(`open ${publicCode}`)).toBe(`open ${publicCode}`);
  });

  it('allows general safety questions that mention secret concepts without including a secret', () => {
    expect(containsSensitiveAppHelpMaterial('How are private keys kept separate?')).toBe(false);
    expect(containsSensitiveAppHelpMaterial('Can App Help see my recovery phrase?')).toBe(false);
  });
});

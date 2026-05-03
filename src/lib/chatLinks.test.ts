import { describe, expect, it } from 'vitest';
import { parseChatMessageLinkParts, resolveChatMessageLink } from './chatLinks';

const ORIGIN = 'https://chainwhisper.app';

describe('chatLinks', () => {
  it('resolves same-origin trade paths as internal app links', () => {
    expect(resolveChatMessageLink('/trades/l/abc123?escrow=private', ORIGIN)).toEqual({
      external: false,
      href: '/trades/l/abc123?escrow=private'
    });
  });

  it('resolves same-origin full URLs as internal app links', () => {
    expect(resolveChatMessageLink('https://chainwhisper.app/trades/42#secret=0xabc', ORIGIN)).toEqual({
      external: false,
      href: '/trades/42#secret=0xabc'
    });
  });

  it('keeps external links external', () => {
    expect(resolveChatMessageLink('https://example.com/trades/l/abc123', ORIGIN)).toEqual({
      external: true,
      href: 'https://example.com/trades/l/abc123'
    });
  });

  it('splits trailing punctuation away from links', () => {
    expect(parseChatMessageLinkParts('Open /trades/l/abc123.', ORIGIN)).toEqual([
      { type: 'text', text: 'Open ' },
      { type: 'link', text: '/trades/l/abc123', href: '/trades/l/abc123', external: false },
      { type: 'text', text: '.' }
    ]);
  });

  it('linkifies same-origin app redirect links', () => {
    expect(parseChatMessageLinkParts('Use https://chainwhisper.app/?p=/trades/l/abc123', ORIGIN)).toEqual([
      { type: 'text', text: 'Use ' },
      {
        type: 'link',
        text: 'https://chainwhisper.app/?p=/trades/l/abc123',
        href: '/?p=/trades/l/abc123',
        external: false
      }
    ]);
  });
});

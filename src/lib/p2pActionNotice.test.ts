import { describe, expect, it } from 'vitest';
import { buildP2PActionNotice, getP2PActionNoticeMessage, type P2PActionNoticeAction } from './p2pActionNotice';

describe('p2p action notices', () => {
  it('uses the compact shared pending copy', () => {
    expect(
      getP2PActionNoticeMessage({
        action: 'fill',
        status: 'pending'
      })
    ).toBe('Confirming on-chain...');
  });

  it.each([
    ['create-offer', 'Offer opened'],
    ['create-recurring-order', 'Order opened'],
    ['fill', 'Trade filled'],
    ['accept', 'Offer accepted'],
    ['counter', 'Counter sent'],
    ['decline', 'Offer refused'],
    ['cancel', 'Offer cancelled'],
    ['recurring-update', 'Order updated'],
    ['recurring-liquidity', 'Liquidity changed'],
    ['recurring-close', 'Order closed'],
    ['reveal', 'Private history revealed']
  ] as Array<[P2PActionNoticeAction, string]>)('maps %s success copy', (action, message) => {
    expect(getP2PActionNoticeMessage({ action, status: 'success' })).toBe(message);
  });

  it('keeps errors contextual', () => {
    const notice = buildP2PActionNotice({
      action: 'accept',
      message: 'Switch to COTI network first.',
      status: 'error',
      surface: 'terminal',
      tradeKey: '7:0xabc',
      txHash: '0x123'
    });

    expect(notice).toMatchObject({
      action: 'accept',
      message: 'Switch to COTI network first.',
      status: 'error',
      surface: 'terminal',
      tradeKey: '7:0xabc',
      txHash: '0x123'
    });
  });
});

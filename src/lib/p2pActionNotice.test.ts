import { describe, expect, it } from 'vitest';
import {
  buildP2PActionNotice,
  getP2PActionFailureStatus,
  getP2PActionNoticeAutoDismissMs,
  getP2PActionNoticeMessage,
  type P2PActionNoticeAction
} from './p2pActionNotice';

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
    ['budget-visibility', 'Budget visibility changed'],
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

describe('getP2PActionNoticeAutoDismissMs', () => {
  it('keeps failures and pending transactions visible until another explicit action', () => {
    expect(getP2PActionNoticeAutoDismissMs('error')).toBeNull();
    expect(getP2PActionNoticeAutoDismissMs('pending')).toBeNull();
    expect(getP2PActionNoticeAutoDismissMs('wallet')).toBeNull();
    expect(getP2PActionNoticeAutoDismissMs('uncertain')).toBeNull();
  });

  it('clears completed informational notices after a short delay', () => {
    expect(getP2PActionNoticeAutoDismissMs('success')).toBe(6500);
    expect(getP2PActionNoticeAutoDismissMs('info')).toBe(6500);
  });
});

describe('getP2PActionFailureStatus', () => {
  it('keeps submitted confirmation timeouts distinct from ordinary failures', () => {
    expect(getP2PActionFailureStatus(
      'The transaction was submitted, but COTI confirmation timed out. Check wallet activity before retrying.'
    )).toBe('uncertain');
    expect(getP2PActionFailureStatus('The wallet rejected the request.')).toBe('error');
  });
});

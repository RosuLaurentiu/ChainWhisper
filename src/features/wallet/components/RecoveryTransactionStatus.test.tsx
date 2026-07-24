import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import RecoveryTransactionStatus from './RecoveryTransactionStatus';

describe('RecoveryTransactionStatus', () => {
  it('makes the complete recovery entry an external explorer link', () => {
    const transactionUrl = `https://mainnet.cotiscan.io/tx/0x${'1'.repeat(64)}`;
    const markup = renderToStaticMarkup(
      <RecoveryTransactionStatus profileId={7} transactionUrl={transactionUrl} />
    );

    expect(markup).toContain(`href="${transactionUrl}"`);
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noreferrer"');
    expect(markup).toContain('Recovery available');
    expect(markup).toContain('View on Blockscout');
    expect(markup).not.toContain('role="status"');
  });

  it('shows the on-chain profile fallback when no transaction is stored', () => {
    const markup = renderToStaticMarkup(
      <RecoveryTransactionStatus profileId={7} />
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('On-chain profile #7');
    expect(markup).not.toContain('href=');
  });

  it('shows that an existing profile transaction is being resolved', () => {
    const markup = renderToStaticMarkup(
      <RecoveryTransactionStatus profileId={0} resolving />
    );

    expect(markup).toContain('Finding transaction');
    expect(markup).not.toContain('href=');
  });
});

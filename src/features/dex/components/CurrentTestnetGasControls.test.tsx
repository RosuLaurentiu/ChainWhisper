import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import CurrentTestnetGasControls from './CurrentTestnetGasControls';
vi.mock('../../../lib/appChain', async () => ({ readOfficialTestnetGas: (await import('../../../lib/officialTestnetFaucet')).readOfficialTestnetGas }));
describe('official faucet access', () => {
  it('keeps the official link free of owner data and disconnected gas reads disabled', () => {
    const html = renderToStaticMarkup(<CurrentTestnetGasControls />);
    expect(html).toContain('href="https://faucet.testnet.coti.io/"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toMatch(/disabled=""[^>]*>Check native Testnet gas/);
    expect(html).toContain('Native COTI pays gas');
    expect(html).toContain('not enabled for private DEX swaps');
    expect(html).not.toContain('eth_sendTransaction');
  });
});

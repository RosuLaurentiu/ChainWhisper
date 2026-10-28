import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import CurrentTestnetGasControls from '../../../src/features/dex/components/CurrentTestnetGasControls';
import type { SharedWalletSession } from '../../../src/lib/walletSession';
import { CURRENT_CHEAP_DEX_CANDIDATE as c } from '../../../src/lib/dexV2Deployment';
import '../../../src/styles.css';
import '../../../src/styles/current-testnet-gas.css';
const account = '0x1111111111111111111111111111111111111111';
const head = { number: '0x100', hash: `0x${'22'.repeat(32)}`, timestamp: '0x200' };
const calls: string[] = [];
let release: (() => void) | null = null, delayed = false, balance = '0x0', reorg = false;
const provider = { request: async ({ method, params }: { method: string; params?: unknown[] }) => {
  calls.push(method);
  if (method === 'eth_chainId') return '0x6c11a0';
  if (method === 'eth_getBlockByNumber') return params?.[0] === '0x0' ? { number: '0x0', timestamp: '0x0', hash: c.genesisHash }
    : params?.[0] !== 'latest' && reorg ? { ...head, hash: `0x${'33'.repeat(32)}` } : head;
  if (method === 'eth_getBalance') { if (delayed) await new Promise<void>(r => { release = r; }); return balance; }
  throw new Error('Unexpected public gas RPC');
} };
let changeOwner: (() => void) | null = null, returned = 0;
Object.assign(window, { __gas: { calls, set: (next: { balance?: string; delayed?: boolean; reorg?: boolean }) => {
  balance = next.balance ?? balance; delayed = next.delayed ?? delayed; reorg = next.reorg ?? reorg;
}, release: () => release?.(), changeOwner: () => changeOwner?.(), returns: () => returned } });
function Harness() {
  const [owner, setOwner] = useState(account); changeOwner = () => setOwner('0x4444444444444444444444444444444444444444');
  const session = { walletAddress: owner, chainId: 7082400, browserProvider: provider } as unknown as SharedWalletSession;
  return <main className="dex-v2-page"><h1>Local Testnet gas fixture</h1><details className="dex-v2-current-funding" open><summary>Test-token funding and exact allowance</summary><CurrentTestnetGasControls sharedWalletSession={session} onReturn={() => { ++returned; }} /></details></main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);

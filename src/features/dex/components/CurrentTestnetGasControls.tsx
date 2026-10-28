import { useEffect, useRef, useState } from 'react';
import { formatUnits } from '@coti-io/coti-ethers';
import type { SharedWalletSession } from '../../../lib/walletSession';
import { readOfficialTestnetGas } from '../../../lib/appChain';
import { OFFICIAL_COTI_TESTNET_FAUCET_URL, OFFICIAL_TESTNET_TOKEN_CATALOG, type OfficialTestnetGasState } from '../../../lib/officialTestnetFaucet';
import { COTI_TESTNET_NETWORK } from '../../../lib/chainWhisperNetworks';

export default function CurrentTestnetGasControls({ sharedWalletSession, onReturn }: {
  sharedWalletSession?: SharedWalletSession; onReturn?: () => void;
}) {
  const provider = sharedWalletSession?.browserProvider;
  const owner = sharedWalletSession?.walletAddress ?? '';
  const chainId = sharedWalletSession?.chainId ?? null;
  const context = { provider, owner, chainId }, scope = useRef(context);
  if (scope.current.provider !== provider || scope.current.owner !== owner || scope.current.chainId !== chainId) scope.current = context;
  const [result, setResult] = useState<{ scope: object; value?: OfficialTestnetGasState; message: string } | null>(null);
  const [busy, setBusy] = useState(false), running = useRef(false), returned = useRef<object | null>(null);
  const callback = useRef(onReturn); callback.current = onReturn;
  const read = async () => {
    if (!provider || !owner || chainId !== COTI_TESTNET_NETWORK.chainIdDecimal || running.current) return;
    const s = scope.current; running.current = true; setBusy(true); setResult(null);
    try {
      const value = await readOfficialTestnetGas({ request: args => provider.request(args), owner, chainId });
      if (s === scope.current) setResult({ scope: s, value, message: value.balance === 0n ? 'No native gas. Claim COTI from the official Testnet faucet, then check again.' : 'Native Testnet gas checked. Each action still checks its current fee and reserve.' });
    } catch (e) {
      if (s === scope.current) setResult({ scope: s, message: e instanceof Error ? e.message : 'Testnet gas is unavailable. Check again.' });
    } finally { running.current = false; setBusy(false); }
  };
  const readRef = useRef(read); readRef.current = read;
  useEffect(() => {
    const refresh = () => {
      if (returned.current !== scope.current) return;
      returned.current = null;
      void readRef.current(); callback.current?.();
    };
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible); };
  }, []);
  const current = result?.scope === scope.current ? result : null;
  const connected = Boolean(provider && owner && chainId === COTI_TESTNET_NETWORK.chainIdDecimal);
  return <section className="dex-v2-current-gas" aria-label="Official Testnet gas and token support">
    <p>Native COTI pays gas. It is separate from the private test tokens used by this DEX.</p>
    <a href={OFFICIAL_COTI_TESTNET_FAUCET_URL} target="_blank" rel="noopener noreferrer" onClick={() => { returned.current = scope.current; }}>Open official COTI Testnet faucet</a>
    <p>The faucet page selects its own network. Select COTI Testnet there. No wallet secret or private input is sent by this link.</p>
    <button type="button" disabled={!connected || busy} onClick={() => { void read(); }}>Check native Testnet gas</button>
    <p role="status">{busy ? 'Checking native Testnet gas…' : current?.message ?? 'Connect the owner on COTI Testnet to check gas. Returning from the faucet refreshes gas and available private funding checks.'}</p>
    {current?.value ? <p>Gas balance: {formatUnits(current.value.balance, 18)} COTI at block {String(current.value.block.number)}.</p> : null}
    <details><summary>Official faucet token support</summary>
      <p>Catalog checked on 3 October 2026; the page displays up to 10 units per claim. Availability and claim limits can change.</p>
      <p>These seven addresses are not enabled for private DEX swaps. Continue with the current candidate's private test-token faucet and exact allowance controls below.</p>
      <table><caption>Official Testnet assets without private swap admission</caption><thead><tr><th>Token</th><th>Decimals</th><th>Contract</th></tr></thead><tbody>
        {OFFICIAL_TESTNET_TOKEN_CATALOG.map(([symbol, address, decimals]) => <tr key={address}><td>{symbol}</td><td>{decimals}</td><td><a href={`${COTI_TESTNET_NETWORK.blockExplorerUrl}/address/${address}`} title={address} aria-label={`${symbol} contract ${address}`} target="_blank" rel="noopener noreferrer">{address.slice(0, 8)}…{address.slice(-6)}</a></td></tr>)}
      </tbody></table>
    </details>
  </section>;
}

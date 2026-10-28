import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveBrowserWalletPrivacyState, type SharedWalletSession } from '../../../lib/walletSession';
import { CURRENT_CHEAP_DEX_CANDIDATE, currentCheapDexCandidateKey, resolveCurrentCheapDexCandidate,
  type CurrentCheapDexIdentity, type CurrentCheapDexCandidateKey } from '../../../lib/dexV2Deployment';
import { currentDexDisplayPair, formatDexCandidateTokenAmount, type CurrentDexDisplayToken } from '../../../lib/currentDexDisplay';

export type CurrentTrialBalanceSelection = Readonly<{
  candidate?: CurrentCheapDexIdentity; tokens?: readonly [string, string]
}>;

export default function useCurrentTrialBalances(session: SharedWalletSession | undefined, result: string,
  selection?: CurrentTrialBalanceSelection) {
  const identity = selection?.candidate ?? CURRENT_CHEAP_DEX_CANDIDATE;
  const { graph, packageSha256 } = identity, core = identity.core.toLowerCase();
  const hasExplicitPair = Boolean(selection?.tokens);
  const tokenIn = (selection?.tokens?.[0] ?? CURRENT_CHEAP_DEX_CANDIDATE.tokens[0][0]).toLowerCase();
  const tokenOut = (selection?.tokens?.[1] ?? CURRENT_CHEAP_DEX_CANDIDATE.tokens[1][0]).toLowerCase();
  const selected = useMemo((): Readonly<{ prepared: boolean; key: CurrentCheapDexCandidateKey; chain: bigint; candidate: CurrentCheapDexIdentity;
    tokens: readonly [CurrentDexDisplayToken, CurrentDexDisplayToken] }> | undefined => {
    try {
      const identity = { graph, core, packageSha256 };
      const key = currentCheapDexCandidateKey(identity);
      const prepared = key === 'cheap-prepared' || key === 'cheap-exit' || key === 'cheap-history';
      if (prepared && !hasExplicitPair) throw new Error('Select a prepared DEX pair.');
      const pair = currentDexDisplayPair(identity, tokenIn, tokenOut);
      const candidate = resolveCurrentCheapDexCandidate(key);
      return { prepared, key, chain: BigInt(candidate.chainId), candidate,
        tokens: [pair.tokenIn, pair.tokenOut] };
    } catch { return undefined; }
  }, [graph, core, packageSha256, tokenIn, tokenOut, hasExplicitPair]);
  const owner = session?.walletAddress.toLowerCase();
  const privacy = session ? resolveBrowserWalletPrivacyState({ browserWalletAddress: session.walletAddress,
    sessionOnboardInfo: session.sessionOnboardInfo ?? {}, walletAesHealthByAddress: session.walletAesHealthByAddress }) : undefined;
  const privacyReady = privacy?.ownerAesReady ?? false;
  const getSender = session?.actions?.getCurrentDexSubmissionCapability;
  const getFunds = session?.actions?.getCurrentSharedDexTokenFundsCapability;
  const context = { owner, chain: session?.chainId, provider: session?.browserProvider,
    source: session?.activeSignerSource, walletId: session?.browserWalletId, privacyReady, getSender, getFunds,
    graph, core, packageSha256, tokenIn, tokenOut,
    privacyKey: privacy?.ownerAesKey,
    onboard: owner ? session?.sessionOnboardInfo?.[owner] : undefined,
    onboardSession: session?.sessionOnboardInfo, health: session?.walletAesHealthByAddress };
  const scope = useRef(context);
  if ((Object.keys(context) as (keyof typeof context)[]).some(key => context[key] !== scope.current[key])) scope.current = context;
  const captured = scope.current;
  const sequence = useRef(0);
  const [state, setState] = useState<{ scope: object; status: 'loading' | 'ready' | 'error'; values?: string[] } | null>(null);
  const eligible = Boolean(selected && owner && context.chain === Number(selected.chain) && context.provider &&
    (selected.prepared ? getFunds : getSender) && privacyReady);
  const refresh = useCallback(async () => {
    if (!eligible || !selected || scope.current !== captured) return;
    const request = ++sequence.current;
    setState({ scope: captured, status: 'loading' });
    try {
      let values: string[];
      if (selected.prepared) {
        const reader = await getFunds!(selected.chain, { candidate: selected.key });
        if (scope.current !== captured || sequence.current !== request) return;
        const funds = await reader.read();
        if (scope.current !== captured || sequence.current !== request) return;
        if (funds.owner.toLowerCase() !== owner || funds.core.toLowerCase() !== captured.core ||
          funds.graph !== captured.graph || funds.packageSha256 !== captured.packageSha256 ||
          funds.privateFundsVerified !== true || funds.readyToSign !== false) throw new Error('Private funds identity changed.');
        values = selected.tokens.map(token => {
          const matches = funds.tokens.filter(value => value.address.toLowerCase() === token.address.toLowerCase());
          if (matches.length !== 1 || matches[0].decimals !== token.decimals || typeof matches[0].balance !== 'bigint') {
            throw new Error('Private funds token metadata changed.');
          }
          return formatDexCandidateTokenAmount(selected.candidate, token.address, matches[0].balance);
        });
      } else {
        const sender = await getSender!(selected.chain);
        if (scope.current !== captured || sequence.current !== request) return;
        const funds = await Promise.all([sender.readCurrentTokenFunding(0), sender.readCurrentTokenFunding(1)]);
        values = selected.tokens.map(token => {
          const index = CURRENT_CHEAP_DEX_CANDIDATE.tokens.findIndex(([address]) => address.toLowerCase() === token.address.toLowerCase());
          return formatDexCandidateTokenAmount(selected.candidate, token.address, funds[index].balance);
        });
      }
      if (scope.current !== captured || sequence.current !== request) return;
      setState({ scope: captured, status: 'ready', values });
    } catch {
      if (scope.current === captured && sequence.current === request) setState({ scope: captured, status: 'error' });
    }
  }, [captured, eligible, getSender, getFunds, owner, selected]);
  useEffect(() => {
    void refresh();
    return () => { sequence.current++; };
  }, [refresh, result]);
  const current = state?.scope === captured ? state : null;
  const status = !selected ? 'Unavailable' : !owner ? 'Connect wallet' : context.chain !== Number(selected.chain)
    ? 'Switch to Testnet' : !privacyReady ? 'Unlock privacy' : !eligible ? 'Unavailable'
      : !current || current.status === 'loading' ? 'Loading…' : 'Unavailable';
  return { labels: eligible && current?.status === 'ready' ? current.values! : [status, status],
    loading: eligible && (!current || current.status === 'loading'), eligible, refresh };
}

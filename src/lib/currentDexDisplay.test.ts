import { describe, expect, it } from 'vitest';
import {
  parseCurrentDexTokenAmount, formatCurrentDexTokenAmount, CURRENT_DEX_TOKEN_DECIMALS,
  CURRENT_DEX_DISPLAY_TOKENS, CURRENT_DEX_DISPLAY_PAIR, CURRENT_DEX_POOL_LABELS,
  currentDexTokenLabel, readCurrentDexDisplay, currentDexDisplayToken, currentDexDisplayPair,
  parseDexCandidateTokenAmount, formatDexCandidateTokenAmount
} from './currentDexDisplay';
import {
  CURRENT_CHEAP_DEX_CANDIDATE, CURRENT_CHEAP_POOL_TOKENS, STAGED_PREPARED_DEX_CANDIDATE,
  resolveCurrentCheapDexCandidate
} from './dexV2Deployment';

describe('current DEX displayed token amounts',()=>{
  it('uses the current exit Core market IDs and exact six-decimal amounts', () => {
    const c = resolveCurrentCheapDexCandidate('cheap-exit'), display = readCurrentDexDisplay(c);
    expect(display.tokens).toHaveLength(4); expect(display.pairs).toHaveLength(6);
    for (const pair of display.pairs) {
      expect(currentDexDisplayPair(c, pair.tokens[1].address, pair.tokens[0].address).marketId).toBe(pair.marketId);
      expect(readCurrentDexDisplay(STAGED_PREPARED_DEX_CANDIDATE).pairs.map(p => p.marketId)).not.toContain(pair.marketId);
      for (const token of pair.tokens) {
        expect(parseDexCandidateTokenAmount(c, token.address, '0.000001', 'Amount', true)).toBe(1n);
        expect(formatDexCandidateTokenAmount(c, token.address, (1n << 256n) - 1n)).toContain('.639935');
        expect(() => parseDexCandidateTokenAmount(c, token.address, '0.0000001', 'Amount')).toThrow();
      }
    }
  });
  it('retains one-atom precision and integers above the Number limit',()=>{
    expect(parseCurrentDexTokenAmount('0.000000000000000001','Amount',true)).toBe(1n);
    expect(parseCurrentDexTokenAmount('9007199254740993.000000000000000001','Amount')).toBe(9007199254740993000000000000000001n);
    const maximum=(1n<<256n)-1n;expect(parseCurrentDexTokenAmount(formatCurrentDexTokenAmount(maximum),'Amount')).toBe(maximum);
  });
  it.each(['-1','1e3','NaN','0.0000000000000000001','1.2.3','01',''])('rejects ambiguous or inexact input %s',value=>expect(()=>parseCurrentDexTokenAmount(value,'Amount')).toThrow());
  it('permits zero payout floors, rejects zero positive funding and uint256 overflow',()=>{
    expect(parseCurrentDexTokenAmount('0','Floor')).toBe(0n);expect(()=>parseCurrentDexTokenAmount('0','Budget',true)).toThrow();
    expect(()=>parseCurrentDexTokenAmount(formatCurrentDexTokenAmount(1n<<256n),'Budget')).toThrow();
  });
});

describe('candidate-bound DEX display amounts', () => {
  const prepared = STAGED_PREPARED_DEX_CANDIDATE;
  const maximum = (1n << 256n) - 1n;

  it('uses all four maintained prepared token metadata records', () => {
    const display = readCurrentDexDisplay(prepared);
    expect(display.tokens).toEqual(prepared.tokenMetadata.map(token => ({
      address: token.address, label: token.symbol, decimals: token.decimals
    })));
    expect(display.tokens).toHaveLength(4);
    expect(Object.isFrozen(display)).toBe(true);
    for (const token of display.tokens) {
      expect(currentDexDisplayToken(prepared, token.address.toUpperCase())).toBe(token);
      expect(parseDexCandidateTokenAmount(prepared, token.address, '0.000001', 'Amount', true)).toBe(1n);
      expect(formatDexCandidateTokenAmount(prepared, token.address, 1n)).toBe('0.000001');
      expect(parseDexCandidateTokenAmount(prepared, token.address, '9007199254740993.000001', 'Amount'))
        .toBe(9007199254740993000001n);
      const exact = formatDexCandidateTokenAmount(prepared, token.address, maximum);
      expect(exact).toBe('115792089237316195423570985008687907853269984665640564039457584007913129.639935');
      expect(parseDexCandidateTokenAmount(prepared, token.address, exact, 'Amount')).toBe(maximum);
      expect(() => parseDexCandidateTokenAmount(prepared, token.address,
        '115792089237316195423570985008687907853269984665640564039457584007913129.639936', 'Amount')).toThrow(/range/);
      expect(() => formatDexCandidateTokenAmount(prepared, token.address, maximum + 1n)).toThrow(/range/);
      expect(() => formatDexCandidateTokenAmount(prepared, token.address, -1n)).toThrow(/range/);
    }
  });

  it.each(['0.0000001', '1.0000000', '-1', '1e3', 'NaN', '1.2.3', '01', ''])(
    'rejects inexact or ambiguous six-decimal input %s', value => {
      expect(() => parseDexCandidateTokenAmount(prepared, prepared.tokens[0][0], value, 'Amount')).toThrow();
    });

  it('permits zero floors and rejects zero positive amounts', () => {
    expect(parseDexCandidateTokenAmount(prepared, prepared.tokens[0][0], '0', 'Floor')).toBe(0n);
    expect(() => parseDexCandidateTokenAmount(prepared, prepared.tokens[0][0], '0', 'Budget', true)).toThrow(/range/);
  });

  it('resolves maintained pairs in both directions without changing canonical order', () => {
    expect(readCurrentDexDisplay(prepared).pairs).toHaveLength(prepared.pairs.length);
    for (const pair of prepared.pairs) {
      const forward = currentDexDisplayPair(prepared, pair.tokens[0], pair.tokens[1]);
      const reverse = currentDexDisplayPair(prepared, pair.tokens[1], pair.tokens[0]);
      expect(forward.marketId).toBe(pair.marketId);
      expect(forward.tokens.map(token => token.address)).toEqual(pair.tokens);
      expect(reverse.tokens).toBe(forward.tokens);
      expect(forward.tokenIn.address).toBe(pair.tokens[0]);
      expect(reverse.tokenIn.address).toBe(pair.tokens[1]);
      expect(reverse.tokenOut.address).toBe(pair.tokens[0]);
    }
    expect(() => currentDexDisplayPair(prepared, prepared.tokens[0][0], prepared.tokens[0][0])).toThrow(/distinct/);
    expect(() => currentDexDisplayPair(prepared, prepared.tokens[0][0], '0x0000000000000000000000000000000000000001')).toThrow();
    // The prepared candidate contains all six distinct pairs of its four tokens.
    expect(readCurrentDexDisplay(prepared).pairs).toHaveLength(6);
  });

  it('rejects wrong candidate identities and addresses before amount conversion', () => {
    for (const identity of [
      { ...prepared, graph: '0'.repeat(64) },
      { ...prepared, packageSha256: '0'.repeat(64) },
      { ...prepared, core: CURRENT_CHEAP_DEX_CANDIDATE.core }
    ]) {
      expect(() => readCurrentDexDisplay(identity)).toThrow(/candidate/);
      expect(() => parseDexCandidateTokenAmount(identity, prepared.tokens[0][0], '1', 'Amount')).toThrow();
      expect(() => formatDexCandidateTokenAmount(identity, prepared.tokens[0][0], 1n)).toThrow();
    }
    expect(() => currentDexDisplayToken(prepared, CURRENT_DEX_DISPLAY_TOKENS[0].address)).toThrow();
    expect(() => parseDexCandidateTokenAmount(CURRENT_CHEAP_DEX_CANDIDATE, prepared.tokens[0][0], '1', 'Amount')).toThrow();
    expect(() => formatDexCandidateTokenAmount(prepared, CURRENT_DEX_DISPLAY_TOKENS[0].address, 1n)).toThrow();
    expect(() => readCurrentDexDisplay(resolveCurrentCheapDexCandidate('cheap-archived'))).toThrow(/metadata/);
    // Caller-supplied metadata cannot replace the maintained candidate metadata.
    const changedMetadata = { ...prepared, tokenMetadata: [] };
    expect(currentDexDisplayToken(changedMetadata, prepared.tokens[0][0]).decimals).toBe(6);
  });

  it('keeps historical current metadata and 18-decimal exports unchanged', () => {
    expect(CURRENT_DEX_TOKEN_DECIMALS).toBe(18);
    expect(CURRENT_DEX_DISPLAY_TOKENS).toEqual(CURRENT_CHEAP_DEX_CANDIDATE.tokens.map(([address], index) =>
      ({ address, label: `Test token ${index}`, decimals: 18 })));
    expect(CURRENT_DEX_DISPLAY_PAIR).toEqual(['Test token 0', 'Test token 1']);
    expect(CURRENT_DEX_POOL_LABELS).toEqual(CURRENT_CHEAP_POOL_TOKENS.map(([address]) => currentDexTokenLabel(address)));
    expect(readCurrentDexDisplay(CURRENT_CHEAP_DEX_CANDIDATE).tokens).toBe(CURRENT_DEX_DISPLAY_TOKENS);
    for (const token of CURRENT_DEX_DISPLAY_TOKENS) {
      expect(parseDexCandidateTokenAmount(CURRENT_CHEAP_DEX_CANDIDATE, token.address, '0.000000000000000001', 'Amount')).toBe(1n);
      expect(formatDexCandidateTokenAmount(CURRENT_CHEAP_DEX_CANDIDATE, token.address, maximum)).toBe(formatCurrentDexTokenAmount(maximum));
    }
    expect(() => currentDexTokenLabel(prepared.tokens[0][0])).toThrow();
  });
});

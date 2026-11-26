import { describe, expect, it } from 'vitest';
import {
  parseCurrentDexTokenAmount, formatCurrentDexTokenAmount, CURRENT_DEX_TOKEN_DECIMALS,
  CURRENT_DEX_DISPLAY_TOKENS, CURRENT_DEX_DISPLAY_PAIR, CURRENT_DEX_POOL_LABELS,
  currentDexTokenLabel, readCurrentDexDisplay, currentDexDisplayToken, currentDexDisplayPair,
  parseDexCandidateTokenAmount, formatDexCandidateTokenAmount
} from './currentDexDisplay';
import { resolveCurrentCheapDexCandidate } from './dexV2Deployment';
// An earlier deployment whose display metadata the current App must refuse.
import { STAGED_PREPARED_DEX_CANDIDATE as old } from './currentDexPreparedCandidate';

describe('current DEX displayed token amounts',()=>{
  it('uses the current Core market IDs and exact six-decimal amounts', () => {
    const c = resolveCurrentCheapDexCandidate('cheap-history'), display = readCurrentDexDisplay(c);
    expect(() => readCurrentDexDisplay(old as never)).toThrow(/candidate/);
    expect(display.tokens).toHaveLength(4); expect(display.pairs).toHaveLength(6);
    for (const pair of display.pairs) {
      expect(currentDexDisplayPair(c, pair.tokens[1].address, pair.tokens[0].address).marketId).toBe(pair.marketId);
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
  const current = resolveCurrentCheapDexCandidate('cheap-history');
  const maximum = (1n << 256n) - 1n;

  it('uses all four maintained current token metadata records', () => {
    const display = readCurrentDexDisplay(current);
    expect(display.tokens).toEqual(current.tokenMetadata.map(token => ({
      address: token.address, label: token.symbol, decimals: token.decimals
    })));
    expect(display.tokens).toHaveLength(4);
    expect(Object.isFrozen(display)).toBe(true);
    for (const token of display.tokens) {
      expect(currentDexDisplayToken(current, token.address.toUpperCase())).toBe(token);
      expect(parseDexCandidateTokenAmount(current, token.address, '0.000001', 'Amount', true)).toBe(1n);
      expect(formatDexCandidateTokenAmount(current, token.address, 1n)).toBe('0.000001');
      expect(parseDexCandidateTokenAmount(current, token.address, '9007199254740993.000001', 'Amount'))
        .toBe(9007199254740993000001n);
      const exact = formatDexCandidateTokenAmount(current, token.address, maximum);
      expect(exact).toBe('115792089237316195423570985008687907853269984665640564039457584007913129.639935');
      expect(parseDexCandidateTokenAmount(current, token.address, exact, 'Amount')).toBe(maximum);
      expect(() => parseDexCandidateTokenAmount(current, token.address,
        '115792089237316195423570985008687907853269984665640564039457584007913129.639936', 'Amount')).toThrow(/range/);
      expect(() => formatDexCandidateTokenAmount(current, token.address, maximum + 1n)).toThrow(/range/);
      expect(() => formatDexCandidateTokenAmount(current, token.address, -1n)).toThrow(/range/);
    }
  });

  it.each(['0.0000001', '1.0000000', '-1', '1e3', 'NaN', '1.2.3', '01', ''])(
    'rejects inexact or ambiguous six-decimal input %s', value => {
      expect(() => parseDexCandidateTokenAmount(current, current.tokens[0][0], value, 'Amount')).toThrow();
    });

  it('permits zero floors and rejects zero positive amounts', () => {
    expect(parseDexCandidateTokenAmount(current, current.tokens[0][0], '0', 'Floor')).toBe(0n);
    expect(() => parseDexCandidateTokenAmount(current, current.tokens[0][0], '0', 'Budget', true)).toThrow(/range/);
  });

  it('resolves maintained pairs in both directions without changing canonical order', () => {
    expect(readCurrentDexDisplay(current).pairs).toHaveLength(current.pairs.length);
    for (const pair of current.pairs) {
      const forward = currentDexDisplayPair(current, pair.tokens[0], pair.tokens[1]);
      const reverse = currentDexDisplayPair(current, pair.tokens[1], pair.tokens[0]);
      expect(forward.marketId).toBe(pair.marketId);
      expect(forward.tokens.map(token => token.address)).toEqual(pair.tokens);
      expect(reverse.tokens).toBe(forward.tokens);
      expect(forward.tokenIn.address).toBe(pair.tokens[0]);
      expect(reverse.tokenIn.address).toBe(pair.tokens[1]);
      expect(reverse.tokenOut.address).toBe(pair.tokens[0]);
    }
    expect(() => currentDexDisplayPair(current, current.tokens[0][0], current.tokens[0][0])).toThrow(/distinct/);
    expect(() => currentDexDisplayPair(current, current.tokens[0][0], '0x0000000000000000000000000000000000000001')).toThrow();
    // The current candidate contains all six distinct pairs of its four tokens.
    expect(readCurrentDexDisplay(current).pairs).toHaveLength(6);
  });

  it('rejects wrong candidate identities and addresses before amount conversion', () => {
    for (const identity of [
      { ...current, graph: '0'.repeat(64) },
      { ...current, packageSha256: '0'.repeat(64) },
      { ...current, core: old.core }
    ]) {
      expect(() => readCurrentDexDisplay(identity)).toThrow(/candidate/);
      expect(() => parseDexCandidateTokenAmount(identity, current.tokens[0][0], '1', 'Amount')).toThrow();
      expect(() => formatDexCandidateTokenAmount(identity, current.tokens[0][0], 1n)).toThrow();
    }
    expect(() => parseDexCandidateTokenAmount(old as never, current.tokens[0][0], '1', 'Amount')).toThrow();
    expect(() => formatDexCandidateTokenAmount(current, '0x0000000000000000000000000000000000000001', 1n)).toThrow();
    expect(() => readCurrentDexDisplay(old as never)).toThrow(/candidate/);
    // Caller-supplied metadata cannot replace the maintained candidate metadata.
    const changedMetadata = { ...current, tokenMetadata: [] };
    expect(currentDexDisplayToken(changedMetadata, current.tokens[0][0]).decimals).toBe(6);
  });

  it('derives the current display exports from the selected candidate', () => {
    expect(CURRENT_DEX_TOKEN_DECIMALS).toBe(18);
    expect(CURRENT_DEX_DISPLAY_TOKENS).toEqual(current.tokenMetadata.map(token => ({ address: token.address, label: token.symbol, decimals: token.decimals })));
    const primary = readCurrentDexDisplay(current).pairs.find(pair => pair.marketId === current.marketId)!;
    expect(CURRENT_DEX_DISPLAY_PAIR).toEqual(primary.tokens.map(token => token.label));
    expect(CURRENT_DEX_POOL_LABELS).toEqual(CURRENT_DEX_DISPLAY_PAIR);
    expect(readCurrentDexDisplay(current).tokens).toBe(CURRENT_DEX_DISPLAY_TOKENS);
    for (const token of CURRENT_DEX_DISPLAY_TOKENS) {
      expect(currentDexTokenLabel(token.address.toUpperCase())).toBe(token.label);
      expect(formatDexCandidateTokenAmount(current, token.address, maximum)).toBe('115792089237316195423570985008687907853269984665640564039457584007913129.639935');
    }
    expect(() => currentDexTokenLabel('0x0000000000000000000000000000000000000001')).toThrow();
  });
});

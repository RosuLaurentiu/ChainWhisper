import { describe, expect, it } from 'vitest';
import { Interface } from '@coti-io/coti-ethers';
import { CURRENT_SLIPPAGE_DEX_QUOTE_ABI, encodeCurrentDexQuoteRequest, packCurrentDexMinimumRate } from './currentDexOperation';

// Quote fragments from the accepted packed Core ABI; native evidence remains separate.
const actual = new Interface([
  'function quoteFastPool(address inputToken,address outputToken,address destination,uint256 deadline,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedMaximumInput,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedMinimumInput,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedMinimumOutput,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedMinimumRate,uint16 toleranceBps) returns (uint256 quoteId)',
  'function quoteCheapAsync((address inputToken,address outputToken,address destination,uint256 deadline,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) maximumInput,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) minimumInput,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) minimumOutput,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) minimumRate,uint16 toleranceBps) request) returns (uint256 quoteId)'
]), app = new Interface(CURRENT_SLIPPAGE_DEX_QUOTE_ABI);
const signature = `0x${'11'.repeat(65)}`;
const amount = (value: bigint) => ({ ciphertext: { ciphertextHigh: value >> 128n, ciphertextLow: value & ((1n << 128n) - 1n) }, signature });

describe('packed Quote codec matches the repaired linked candidate', () => {
  it.each(['fast-pool', 'cheap-async'] as const)('%s keeps full amounts, rate halves and tolerance', profile => {
    const method = profile === 'fast-pool' ? 'quoteFastPool' : 'quoteCheapAsync';
    expect(app.getFunction(method)!.format('sighash')).toBe(actual.getFunction(method)!.format('sighash'));
    const terms = {
      profile, quoteProtocol: 'quote-slippage' as const, toleranceBps: 50,
      inputToken: `0x${'11'.repeat(20)}`, outputToken: `0x${'22'.repeat(20)}`, destination: `0x${'33'.repeat(20)}`, deadline: 9999999999n,
      maximumInput: amount((1n << 256n) - 1n), minimumInput: amount(1n), minimumOutput: amount(1n),
      minimumRate: amount(packCurrentDexMinimumRate((1n << 128n) - 1n, (1n << 128n) - 1n))
    };
    const encoded = encodeCurrentDexQuoteRequest(terms);
    const decoded = actual.decodeFunctionData(method, encoded);
    expect(actual.encodeFunctionData(method, decoded)).toBe(encoded);
    const fields = profile === 'cheap-async' ? decoded.request : decoded;
    expect(fields.toleranceBps).toBe(50n);
    const rate = fields.minimumRate ?? fields.encryptedMinimumRate;
    const maximum = fields.maximumInput ?? fields.encryptedMaximumInput;
    expect(rate.ciphertext.ciphertextHigh).toBe((1n << 128n) - 1n);
    expect(rate.ciphertext.ciphertextLow).toBe((1n << 128n) - 1n);
    expect(maximum.ciphertext.ciphertextHigh).toBe((1n << 128n) - 1n);
    expect(maximum.ciphertext.ciphertextLow).toBe((1n << 128n) - 1n);
  });
});

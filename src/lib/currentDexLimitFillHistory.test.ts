import { AbiCoder } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import type { PrivateUint256Output } from './privateUint256';
import { CURRENT_LIMIT_FILL_HISTORY_GRAPH, SHARED_RECEIPT_LIMIT_FILL_HISTORY_GRAPH, currentLimitFillHistoryAbi as abi, readCurrentLimitFillHistoryPage } from './currentDexLimitFillHistory';

const coder=AbiCoder.defaultAbiCoder(),owner=`0x${'22'.repeat(20)}`,engine=`0x${'11'.repeat(20)}`;
const tokens=[`0x${'33'.repeat(20)}`,`0x${'44'.repeat(20)}`]as const,hash=`0x${'55'.repeat(32)}`;
const payload=(values:bigint[],block=95n,time=995n)=>coder.encode(['uint256','uint256','tuple(uint256 ciphertextHigh,uint256 ciphertextLow)[4]'],[block,time,values.map(v=>[1n,v])]);
const sharedPayload=(id:bigint,sold:bigint,received:bigint,direction:bigint)=>coder.encode(
  ['uint256','uint256','tuple(uint256 ciphertextHigh,uint256 ciphertextLow)[3]','uint256'],
  [95n,995n,[id,sold,received].map(v=>[1n,v]),direction]);
function fixture(records:(string|null)[]){
  const guard=vi.fn(),attest=vi.fn(),decrypt=vi.fn((cipher:PrivateUint256Output)=>BigInt(cipher.ciphertextLow));
  const rpc=vi.fn(async(method:string,params:unknown[])=>{
    if(method==='eth_getBlockByNumber')return{number:params[0],hash,timestamp:params[0]==='0x64'?'0x3e8':'0x3e3'};
    expect(method).toBe('eth_call');const call=params[0]as{from:string;to:string;data:string};expect(call.from).toBe(owner);expect(call.to).toBe(engine);expect(params[1]).toEqual({blockHash:hash,requireCanonical:true});
    const [action,record]=abi.decodeFunctionData('limitFillHistory',call.data);expect(action).toBeLessThan(2n);
    if(action===0n)return abi.encodeFunctionResult('limitFillHistory',[coder.encode(['uint256'],[records.length])]);
    const value=records[Number(record)];if(value===null)throw{code:'CALL_EXCEPTION',data:abi.getError('ReceiptAccessDenied')!.selector};
    return abi.encodeFunctionResult('limitFillHistory',[value]);
  });
  const args={graph:CURRENT_LIMIT_FILL_HISTORY_GRAPH,owner,engine,poolTokens:tokens,head:{number:100n,hash,timestamp:1000n},rpc,assertCurrent:guard,attest,decrypt};
  return{args,rpc,guard,attest,decrypt};
}
describe('private Limit execution history',()=>{
  it('reads shared receipts in both directions with full-width IDs and the same zero-fill work',async()=>{
    const id=(1n<<200n)+7n;
    const f=fixture([sharedPayload(id,5n,10n,1n),sharedPayload(9n,0n,0n,0n),sharedPayload(8n,4n,8n,0n)]);
    const decryptBool=vi.fn((cipher:bigint)=>cipher===1n);
    const page=await readCurrentLimitFillHistoryPage({...f.args,graph:SHARED_RECEIPT_LIMIT_FILL_HISTORY_GRAPH,decryptBool});
    expect(page.fills).toMatchObject([{positionId:8n,soldToken:tokens[1],receivedToken:tokens[0]},
      {positionId:id,soldToken:tokens[0],receivedToken:tokens[1],sold:5n,received:10n}]);
    expect(f.decrypt).toHaveBeenCalledTimes(9);expect(decryptBool).toHaveBeenCalledTimes(3);
    expect(f.rpc.mock.calls.filter(([method])=>method==='eth_getBlockByNumber')).toHaveLength(4);
    expect(page).toMatchObject({complete:true,readyToSign:false,nativeAdmission:false});
  });
  it('binds the format to the graph and rejects absent or invalid Boolean decoders',async()=>{
    const missing=fixture([]);
    await expect(readCurrentLimitFillHistoryPage({...missing.args,graph:SHARED_RECEIPT_LIMIT_FILL_HISTORY_GRAPH})).rejects.toThrow('Boolean history decoder');
    expect(missing.rpc).not.toHaveBeenCalled();
    const old=fixture([payload([7n,1n,1n,1n])]);
    await expect(readCurrentLimitFillHistoryPage({...old.args,graph:SHARED_RECEIPT_LIMIT_FILL_HISTORY_GRAPH,decryptBool:()=>true})).rejects.toThrow('canonical');
    expect(old.decrypt).not.toHaveBeenCalled();
    const narrow=fixture([sharedPayload(7n,1n,1n,1n)]);
    await expect(readCurrentLimitFillHistoryPage(narrow.args)).rejects.toThrow();
    expect(narrow.decrypt).not.toHaveBeenCalled();
    await expect(readCurrentLimitFillHistoryPage({...narrow.args,graph:SHARED_RECEIPT_LIMIT_FILL_HISTORY_GRAPH,
      decryptBool:()=>2n as unknown as boolean})).rejects.toThrow('saved owner privacy');
  });
  it('loads former-owner records in both directions and skips other owners and zero fills',async()=>{
    const f=fixture([payload([7n,5n,10n,1n]),null,payload([9n,0n,0n,0n]),payload([8n,4n,8n,0n])]);
    const page=await readCurrentLimitFillHistoryPage(f.args);
    expect(page.fills).toMatchObject([{record:3n,positionId:8n,soldToken:tokens[1],receivedToken:tokens[0],sold:4n,received:8n},{record:0n,positionId:7n,soldToken:tokens[0],receivedToken:tokens[1],sold:5n,received:10n}]);
    expect(page).toMatchObject({count:4n,nextBefore:0n,complete:true,readyToSign:false,nativeAdmission:false});
    expect(f.rpc.mock.calls.filter(([method])=>method==='eth_getBlockByNumber')).toHaveLength(4); // All owned slots, including zero, plus the head check.
  });
  it('pages by the public record count without assuming an operation has eight records',async()=>{
    const f=fixture(Array.from({length:16},()=>payload([7n,0n,0n,1n])));
    expect(await readCurrentLimitFillHistoryPage({...f.args,pageSize:5})).toMatchObject({count:16n,nextBefore:11n,complete:false});
    expect(await readCurrentLimitFillHistoryPage({...f.args,before:11n,pageSize:5})).toMatchObject({nextBefore:6n,complete:false});
  });
  it.each([[0n,1n],[1n,0n]])('rejects a zero-charge/output mismatch %s/%s',async(sold,received)=>{
    await expect(readCurrentLimitFillHistoryPage(fixture([payload([7n,sold,received,1n])]).args)).rejects.toThrow('Limit fill amounts');
  });
  it.each([0n,2n])('rejects invalid private position or direction %s',async(value)=>{
    await expect(readCurrentLimitFillHistoryPage(fixture([payload(value===0n?[0n,1n,1n,1n]:[7n,1n,1n,2n])]).args)).rejects.toThrow('Limit fill identity');
  });
  it('does not turn RPC failure into empty history',async()=>{
    const f=fixture([payload([7n,1n,1n,1n])]);f.rpc.mockRejectedValueOnce(new Error('RPC unavailable'));
    await expect(readCurrentLimitFillHistoryPage(f.args)).rejects.toThrow('RPC unavailable');
  });
  it('rejects unsupported graphs and stale cursors before disclosing amounts',async()=>{
    const f=fixture([]);await expect(readCurrentLimitFillHistoryPage({...f.args,graph:'0'.repeat(64)})).rejects.toThrow('unavailable for this candidate');expect(f.rpc).not.toHaveBeenCalled();
    await expect(readCurrentLimitFillHistoryPage({...f.args,before:1n})).rejects.toThrow('cursor');expect(f.decrypt).not.toHaveBeenCalled();
  });
  it('checks canonical payloads, receipt blocks and session changes',async()=>{
    const suffix=fixture([payload([7n,1n,1n,1n])+'00']);await expect(readCurrentLimitFillHistoryPage(suffix.args)).rejects.toThrow('canonical');
    const future=fixture([payload([7n,1n,1n,1n],101n,1001n)]);await expect(readCurrentLimitFillHistoryPage(future.args)).rejects.toThrow('block');
    const stale=fixture([payload([7n,1n,1n,1n])]);stale.guard.mockImplementationOnce(()=>{}).mockImplementationOnce(()=>{throw new Error('Wallet changed');});await expect(readCurrentLimitFillHistoryPage(stale.args)).rejects.toThrow('Wallet changed');expect(stale.decrypt).not.toHaveBeenCalled();
  });
});

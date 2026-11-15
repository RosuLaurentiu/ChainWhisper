import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMobileWalletDiagnosticsEnabled, logMobileWalletDiagnostic } from './mobileWalletDiagnostics';

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const install=(enabled=false)=>{
  const getItem=vi.fn((key:string)=>enabled&&key==='chainwhisper:mobile-wallet-diagnostics'?'1':null);
  vi.stubGlobal('window',{sessionStorage:{getItem},localStorage:{getItem},
    location:{pathname:'/dex/positions',search:'?private=not-for-logs',hash:'#not-for-logs'}});
  return vi.spyOn(console,'info').mockImplementation(()=>{});
};
describe('opt-in local wallet diagnostics',()=>{
  it('emits nothing unless the existing flag is enabled',()=>{
    const info=install();logMobileWalletDiagnostic('dex-mounted');expect(info).not.toHaveBeenCalled();
  });
  it('keeps only caller-supplied field names and redacts route query/fragment',()=>{
    const info=install(true);
    logMobileWalletDiagnostic('pool-position-scope-invalidated',{fields:['health','onboard'],selected:true});
    expect(info).toHaveBeenCalledWith('[ChainWhisper mobile wallet]','pool-position-scope-invalidated',{
      route:'/dex/positions?[params]#[redacted]',fields:['health','onboard'],selected:true});
  });
  it('does not interrupt a component when storage access is denied',()=>{
    const info=vi.spyOn(console,'info').mockImplementation(()=>{});
    vi.stubGlobal('window',{get sessionStorage(){throw Error('Storage denied');}});
    expect(isMobileWalletDiagnosticsEnabled()).toBe(false);
    expect(()=>logMobileWalletDiagnostic('dex-mounted')).not.toThrow();expect(info).not.toHaveBeenCalled();
  });
  it('does not interrupt a component when the console sink fails',()=>{
    install(true).mockImplementation(()=>{throw Error('Console unavailable');});
    expect(()=>logMobileWalletDiagnostic('dex-unmounted')).not.toThrow();
  });
});

'use strict';
const path=require('node:path');
const runtime=require(path.resolve(__dirname,'../../ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/c1-service/runtime.cjs'));
const MODES=['--check','--read','--start','--once','--restart','--reconcile','--inspect','--expire','--renew'];
async function main(args){
 if(!Array.isArray(args)||args.length!==1||!MODES.includes(args[0]))throw Error('CURRENT_DEX_C1_USAGE');
 return runtime.main(args[0]);
}
module.exports={main};
if(require.main===module)main(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result))).catch(error=>{
 console.error(JSON.stringify(runtime.failure(error)));process.exitCode=1;
});

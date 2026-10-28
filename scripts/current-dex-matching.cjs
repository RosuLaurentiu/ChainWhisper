'use strict';
const path=require('node:path');
const runtime=require(path.resolve(__dirname,'../../ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/matching-service/runtime.cjs'));
async function main(args){
 if(!Array.isArray(args)||args.length!==1||!['--check','--start','--once','--reconcile','--inspect'].includes(args[0]))throw Error('CURRENT_DEX_MATCHING_USAGE');
 return runtime.main(args[0]);
}
function failure(error){
 const guard=String(error?.message??'').split(/\r?\n/,1)[0].match(/^[A-Z][A-Z0-9_]+$/)?.[0]??'CURRENT_DEX_MATCHING_REJECTED';
 const code=value=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(value)?value:null;
 return{status:'CURRENT_DEX_MATCHING_STOP',guard,code:code(error?.code),causeCode:code(error?.cause?.code),locations:error?.stack?.split('\n').slice(1,4).flatMap(line=>line.match(/([\w-]+\.cjs:\d+:\d+)/)?.[0]??[]),noAutomaticRetry:true,privateAccountingVerified:false};
}
module.exports={main,failure};
if(require.main===module)main(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result))).catch(error=>{
 console.error(JSON.stringify(failure(error)));process.exitCode=1;
});

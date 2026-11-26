'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{execFileSync}=require('node:child_process'),{parseArgs}=require('node:util');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const safe=name=>typeof name==='string'&&!name.includes('\\')&&!path.posix.isAbsolute(name)&&name.split('/').every(p=>p&&p!=='.'&&p!=='..');
function prepareStaticSite({build,output,graph,previous=[]}) {
 assert(/^[0-9a-f]{64}$/.test(graph),'PAGES_GRAPH');assert(!fs.existsSync(output),'PAGES_OUTPUT_EXISTS');
 const files=new Map(),retained=[];
 function walk(directory,prefix='') {
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})) {
   const name=prefix+entry.name,file=path.join(directory,entry.name);assert(safe(name)&&!entry.isSymbolicLink(),'PAGES_BUILD_PATH');
   if(entry.isDirectory())walk(file,name+'/');else{assert(entry.isFile(),'PAGES_BUILD_FILE');files.set(name,fs.readFileSync(file));}
  }
 }
 walk(build);const index=files.get('index.html');assert(index,'PAGES_INDEX');
 const identityBytes=files.get('DEX_BUILD_IDENTITY.json');assert(identityBytes,'PAGES_BUILD_IDENTITY_MISSING');
 const identity=JSON.parse(identityBytes);assert(identity.schema==='CURRENT_DEX_BUILD_V1'&&identity.graph===graph,'PAGES_BUILD_IDENTITY_MISMATCH');
 for(const source of previous) {
  assert(source.manifest.schema==='CHECKED_BETA_APP_STATIC_TREE_V1'&&/^[0-9a-f]{64}$/.test(source.manifest.graph),'PAGES_PREVIOUS_GRAPH');
  for(const [name,digest]of Object.entries(source.manifest.files)) {
   assert(safe(name)&&/^[0-9a-f]{64}$/.test(digest),'PAGES_PREVIOUS_PATH');
   if(!name.startsWith('assets/'))continue;
   const bytes=source.read(name);assert(sha(bytes)===digest,'PAGES_PREVIOUS_HASH');
   if(files.has(name))assert(sha(files.get(name))===digest,'PAGES_ASSET_COLLISION');
   else{files.set(name,bytes);retained.push({name,source:source.id,sha256:digest});}
  }
 }
 for(const match of index.toString().matchAll(/(?:src|href)="\/?(assets\/[^"?#]+)"/g))assert(files.has(match[1]),'PAGES_ENTRY_ASSET');
 // Retain immutable files for open tabs, never old HTML, contract configuration or pending records.
 for(const [name,bytes]of files){const file=path.join(output,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes,{flag:'wx'});}
 const manifest={schema:'CHECKED_BETA_APP_STATIC_TREE_V1',graph,indexSha256:sha(index),files:Object.fromEntries([...files].sort(([a],[b])=>a.localeCompare(b)).map(([name,bytes])=>[name,sha(bytes)]))};
 return {manifest,retained};
}
function gitSource(ref,cwd) {
 const git=args=>execFileSync('git',args,{cwd,maxBuffer:32*1024*1024});
 const id=git(['rev-parse','--verify',ref+'^{commit}']).toString().trim();assert(/^[0-9a-f]{40}$/.test(id),'PAGES_PREVIOUS_COMMIT');
 const read=name=>{assert(safe(name),'PAGES_GIT_PATH');const file=name==='BUILD_MANIFEST.json'?name:'site/'+name;assert(git(['ls-tree',id,'--',file]).toString().startsWith('100644 blob '),'PAGES_GIT_FILE');return git(['show',id+':'+file]);};
 return {id,manifest:JSON.parse(read('BUILD_MANIFEST.json')),read};
}
// The hosted site as the previous release: BUILD_MANIFEST.json names its files; prepareStaticSite checks each hash.
// CW-138: `local` returns bytes that this machine already has for a name (the new build or the retained-file cache).
// A local copy is used only when its hash equals the hosted manifest; every other file is requested from the site.
async function httpSource(base,{fetch:request=globalThis.fetch,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),limit=32*1024*1024,parallel=8,local=()=>null}={}) {
 let origin=null;try{origin=new URL(base);}catch{origin=null;}
 assert(origin&&origin.protocol==='https:'&&!origin.username&&!origin.password&&!origin.search&&!origin.hash,'PAGES_HTTP_URL');
 const root=origin.href.replace(/\/+$/,'');
 async function load(url) {
  for(let attempt=1;;attempt++) {
   let response=null;try{response=await request(url,{redirect:'error',signal:AbortSignal.timeout(60000)});}catch(error){if(attempt===3)throw new Error('PAGES_HTTP_REQUEST',{cause:error});}
   if(response&&response.status===200){const bytes=Buffer.from(await response.arrayBuffer());assert(bytes.length<=limit,'PAGES_HTTP_SIZE');return bytes;}
   // Repeat only a temporary answer. A missing or moved file stops at once.
   assert(attempt<3&&(!response||response.status===429||response.status>=500),'PAGES_HTTP_STATUS');await wait(1000*attempt);
  }
 }
 // The manifest changes with each release, so it must not come from a cache. Hash-named files do not change.
 let manifest;try{manifest=JSON.parse(await load(root+'/BUILD_MANIFEST.json?v='+Date.now()));}catch(error){if(error instanceof SyntaxError)throw new Error('PAGES_HTTP_MANIFEST');throw error;}
 assert(manifest&&manifest.files&&typeof manifest.files==='object'&&!Array.isArray(manifest.files),'PAGES_HTTP_MANIFEST');
 const names=Object.keys(manifest.files).filter(name=>safe(name)&&name.startsWith('assets/')),bytes=new Map();let next=0;
 let reused=0;
 await Promise.all(Array.from({length:Math.min(parallel,names.length)},async()=>{while(next<names.length){const name=names[next++];
  let have=null;try{have=local(name);}catch{have=null;}
  if(Buffer.isBuffer(have)&&have.length<=limit&&sha(have)===manifest.files[name]){bytes.set(name,have);reused++;}
  else bytes.set(name,await load(root+'/'+name.split('/').map(encodeURIComponent).join('/')));}}));
 return {id:root,manifest,reused,requested:names.length-reused,read:name=>{assert(bytes.has(name),'PAGES_HTTP_FILE');return bytes.get(name);}};
}
// Reads one safe asset name from the new build or from the retained-file cache. Never follows a link.
function localAssets(directories) {
 return name=>{
  if(!safe(name)||!name.startsWith('assets/'))return null;
  for(const directory of directories){const file=path.join(directory,name);let stat=null;try{stat=fs.lstatSync(file);}catch{stat=null;}if(stat&&stat.isFile())return fs.readFileSync(file);}
  return null;
 };
}
// Saves the assets of the prepared site for the next deploy. The next run checks each hash again.
function saveRetainedCache(output,cache) {
 const from=path.join(output,'assets');if(!fs.existsSync(from))return 0;
 fs.rmSync(cache,{recursive:true,force:true});fs.mkdirSync(path.join(cache,'assets'),{recursive:true});let count=0;
 for(const entry of fs.readdirSync(from,{withFileTypes:true}))if(entry.isFile()){fs.copyFileSync(path.join(from,entry.name),path.join(cache,'assets',entry.name));count++;}
 return count;
}
module.exports={prepareStaticSite,gitSource,httpSource,localAssets,saveRetainedCache};
if(require.main===module)(async()=>{
 const {values}=parseArgs({options:{build:{type:'string'},output:{type:'string'},graph:{type:'string'},'previous-ref':{type:'string',multiple:true,default:[]},'previous-url':{type:'string',multiple:true,default:[]},'retained-cache':{type:'string'}}});
 assert(values.build&&values.output&&values.graph,'PAGES_USAGE');
 const previous=values['previous-ref'].map(ref=>gitSource(ref,process.cwd()));const local=localAssets([values.build,...(values['retained-cache']?[values['retained-cache']]:[])]);let reused=0,requested=0;
 for(const url of values['previous-url']){const source=await httpSource(url,{local});reused+=source.reused;requested+=source.requested;previous.push(source);}
 const result=prepareStaticSite({build:values.build,output:values.output,graph:values.graph,previous});
 fs.writeFileSync(path.resolve(values.output)+'.manifest.json',JSON.stringify(result.manifest,null,2)+'\n',{flag:'wx'});
 const cached=values['retained-cache']?saveRetainedCache(values.output,values['retained-cache']):0;
 console.log(JSON.stringify({status:'PAGES_STATIC_SITE_PREPARED',files:Object.keys(result.manifest.files).length,retainedAssets:result.retained.length,reusedLocalAssets:reused,requestedHostedAssets:requested,cachedAssets:cached,indexSha256:result.manifest.indexSha256}));
})().catch(error=>{console.error(error);process.exit(1);});

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
module.exports={prepareStaticSite,gitSource};
if(require.main===module) {
 const {values}=parseArgs({options:{build:{type:'string'},output:{type:'string'},graph:{type:'string'},'previous-ref':{type:'string',multiple:true,default:[]}}});
 assert(values.build&&values.output&&values.graph,'PAGES_USAGE');
 const result=prepareStaticSite({build:values.build,output:values.output,graph:values.graph,previous:values['previous-ref'].map(ref=>gitSource(ref,process.cwd()))});
 fs.writeFileSync(path.resolve(values.output)+'.manifest.json',JSON.stringify(result.manifest,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:'PAGES_STATIC_SITE_PREPARED',files:Object.keys(result.manifest.files).length,retainedAssets:result.retained.length,indexSha256:result.manifest.indexSha256}));
}

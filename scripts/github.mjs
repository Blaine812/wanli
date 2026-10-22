// Uses existing Git Credential Manager authorization in memory. No credential
// values are written to disk, supplied as process arguments, or printed.
import {execFileSync} from 'node:child_process';
const repository='Blaine812/wanli',command=process.argv[2]||'status';
let credential;
try{
 const raw=execFileSync('git',['-c','credential.interactive=never','credential','fill'],{input:'protocol=https\nhost=github.com\npath=Blaine812/wanli.git\n\n',encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'},stdio:['pipe','pipe','pipe']});
 credential=Object.fromEntries(raw.trim().split(/\r?\n/).map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)];}));
 if(!credential.password)throw new Error();
}catch{console.error('GitHub authorization is not available through Git Credential Manager.');process.exit(2);}
async function api(endpoint,options={}){
 const response=await fetch('https://api.github.com/repos/'+repository+endpoint,{...options,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+credential.password,'X-GitHub-Api-Version':'2026-03-10',...(options.body?{'Content-Type':'application/json'}:{})},signal:AbortSignal.timeout(30000)});
 const data=response.status===204?null:await response.json();
 if(!response.ok){const error=new Error(`${response.status}: ${data?.message||'GitHub request failed'}`);error.status=response.status;throw error;}
 return data;
}
try{
 if(command==='status'){
  const repo=await api('');let pages;try{pages=await api('/pages');}catch(e){if(e.status!==404)throw e;}
  console.log(JSON.stringify({repository,private:repo.private,defaultBranch:repo.default_branch,canPush:repo.permissions?.push,pages:pages?{url:pages.html_url,status:pages.status,buildType:pages.build_type,cname:pages.cname}:null}));
 }else if(command==='enable-pages'){
  let current;try{current=await api('/pages');}catch(e){if(e.status!==404)throw e;}
  const result=await api('/pages',{method:current?'PUT':'POST',body:JSON.stringify({build_type:'workflow'})});
  console.log(JSON.stringify({enabled:true,url:result?.html_url||current?.html_url||`https://blaine812.github.io/wanli/`}));
 }else if(command==='bind-domain'){
  const domain='miaomiaojiao.cn',current=await api('/pages');
  if(current.cname&&current.cname!==domain)throw new Error('A different custom domain is already configured; no changes made.');
  if(current.cname!==domain)await api('/pages',{method:'PUT',body:JSON.stringify({cname:domain})});
  const saved=await api('/pages');
  if(saved.cname!==domain)throw new Error('Custom domain was not saved.');
  console.log(JSON.stringify({domain:saved.cname,url:saved.html_url,httpsEnforced:saved.https_enforced,certificate:saved.https_certificate?.state||null}));
 }else if(command==='domain-status'){
  const saved=await api('/pages');
  console.log(JSON.stringify({domain:saved.cname,url:saved.html_url,httpsEnforced:saved.https_enforced,certificate:saved.https_certificate||null}));
 }else if(command==='refresh-domain-certificate'){
  const domain='miaomiaojiao.cn',current=await api('/pages');
  if(current.cname!==domain)throw new Error('Expected custom domain is not configured.');
  if(current.https_enforced||current.https_certificate?.state&&!['errored','bad_authz','destroyed'].includes(current.https_certificate.state)){
   console.log(JSON.stringify({unchanged:true,certificate:current.https_certificate||null}));
  }else{
   await api('/pages',{method:'PUT',body:JSON.stringify({cname:null})});
   try{await api('/pages',{method:'PUT',body:JSON.stringify({cname:domain})});}
   catch{await api('/pages',{method:'PUT',body:JSON.stringify({cname:domain})});}
   const saved=await api('/pages');
   if(saved.cname!==domain)throw new Error('Custom domain must be restored.');
   console.log(JSON.stringify({domain:saved.cname,restarted:true,certificate:saved.https_certificate||null}));
  }
 }else if(command==='domain-health'){
  console.log(JSON.stringify(await api('/pages/health')));
 }else if(command==='enable-https'){
  const current=await api('/pages');
  if(current.cname!=='miaomiaojiao.cn')throw new Error('Expected custom domain is not configured.');
  await api('/pages',{method:'PUT',body:JSON.stringify({https_enforced:true})});
  const saved=await api('/pages');console.log(JSON.stringify({domain:saved.cname,httpsEnforced:saved.https_enforced}));
 }else if(command==='dispatch'){
  await api('/actions/workflows/pages.yml/dispatches',{method:'POST',body:JSON.stringify({ref:'main'})});console.log('GitHub Pages build requested.');
 }else if(command==='runs'){
  const data=await api('/actions/workflows/pages.yml/runs?per_page=5');console.log(JSON.stringify(data.workflow_runs.map(run=>({id:run.id,sha:run.head_sha,status:run.status,conclusion:run.conclusion,url:run.html_url,event:run.event}))));
 }else if(command==='jobs'){
  if(!/^\d+$/.test(process.argv[3]||''))throw new Error('Pass a numeric run ID.');
  const data=await api(`/actions/runs/${process.argv[3]}/jobs`);console.log(JSON.stringify(data.jobs.map(job=>({name:job.name,status:job.status,conclusion:job.conclusion,steps:job.steps?.map(s=>({name:s.name,conclusion:s.conclusion,status:s.status}))}))));
 }else throw new Error('Unknown GitHub operation.');
}catch(error){console.error(error.message);process.exitCode=1;}

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHandler} from '../supabase/functions/miaomiao-api/handler.mjs';
import demos from '../shared/demo-cats.json' with {type:'json'};
const origin='https://blaine812.github.io',actor='00000000-0000-4000-8000-000000000001';
const jpg=await readFile(new URL('../public/cats/milk.jpg',import.meta.url));
function setup({rpcError,invalidUser=false,uploadError=false,finishFails=0}={}){
 const calls=[],photos=new Map();let finishCount=0;
 const cat={id:'00000000-0000-4000-8000-000000000002',name:'奶盖',intro:'你好小猫',breed:'小橘猫',imagePath:'photo.jpg',createdAt:1,commentCount:0};
 const backend={
  async user(token){calls.push(['user',token]);return invalidUser?{user:null,error:true}:{user:{id:actor,aud:'authenticated'}};},
  async rpc(name,args){calls.push([name,args]);if(rpcError)return {error:{message:rpcError}};
   if(name==='miaomiao_gallery')return {data:{cats:[cat],uploadedTotal:1,demoCounts:{'demo-milk':2},nextOffset:null}};
   if(name==='miaomiao_comments_get')return {data:{comments:[]}};
   if(name==='miaomiao_comment_create')return {data:{comment:{id:'comment',nickname:args.p_nickname,body:args.p_body}}};
   if(name==='miaomiao_reserve_upload')return {data:{id:cat.id,imagePath:cat.imagePath}};
   if(name==='miaomiao_finish_upload'){finishCount++;return finishCount<=finishFails?{error:{message:'Network error'}}:{data:cat};}
   return {data:null};},
  async upload(name,bytes,mime){calls.push(['upload',name,mime]);photos.set(name,bytes);return {error:uploadError?new Error('Storage failure'):null};},
  async remove(name){calls.push(['remove',name]);photos.delete(name);return {error:null};},
  photoUrl:name=>'https://storage.example/'+name,
 };
 const handler=createHandler({backend,demos,allowedOrigins:[origin],ipSalt:'test-key'});
 const request=(url,options={})=>handler(new Request('https://project.supabase.co/functions/v1/miaomiao-api'+url,{...options,headers:{Origin:origin,...options.headers}}));
 const form=(bytes=jpg)=>{const data=new FormData();data.set('name','奶盖');data.set('intro','你好小猫');data.set('breed','小橘猫');data.set('photo',new Blob([bytes],{type:'image/jpeg'}),'cat.jpg');return data;};
 return {calls,photos,request,form};
}
test('public gallery lists safe photo DTOs and sample comment counts',async()=>{const {request,calls}=setup();const response=await request('/cats');assert.equal(response.status,200);const data=await response.json();assert.equal(data.total,7);assert.equal(data.cats[0].image,'https://storage.example/photo.jpg');assert.equal(data.cats[1].commentCount,2);assert.equal('imagePath' in data.cats[0],false);assert.equal(calls.some(([name])=>name==='user'),false);});
test('same-origin CORS preflight works; unrelated sites are rejected',async()=>{const {request,calls}=setup();const response=await request('/cats',{method:'OPTIONS'});assert.equal(response.status,204);assert.equal(response.headers.get('access-control-allow-origin'),origin);assert.equal((await request('/cats',{headers:{Origin:'https://other.example'}})).status,403);assert.equal(calls.length,0);});
test('writes without a valid server-verified user cannot call database or Storage',async()=>{for(const invalidUser of [false,true]){const {request,form,calls}=setup({invalidUser});const response=await request('/cats',{method:'POST',body:form(),headers:invalidUser?{Authorization:'Bearer invalid'}:{}});assert.equal(response.status,401);assert.equal(calls.some(([name])=>name.startsWith('miaomiao_')||name==='upload'),false);}});
test('uploads use the verified user, sniff the image and return a stored photo URL',async()=>{const {request,form,calls,photos}=setup();const response=await request('/cats',{method:'POST',headers:{Authorization:'Bearer session'},body:form()});assert.equal(response.status,201);assert.equal((await response.json()).cat.image,'https://storage.example/photo.jpg');const args=calls.find(([name])=>name==='miaomiao_reserve_upload')[1];assert.equal(args.p_actor,actor);assert.equal(args.p_mime,'image/jpeg');assert.equal(args.p_bytes,jpg.length);assert.match(args.p_ip_hash,/^[a-f0-9]{64}$/);assert.equal(photos.size,1);});
test('malformed, fake and oversized uploads are refused before reserving storage',async()=>{const {request,form,calls}=setup();for(const data of [form(new TextEncoder().encode('<svg onload="alert(1)"></svg>')),form(new Uint8Array(8*1024*1024+1))]){assert.equal((await request('/cats',{method:'POST',headers:{Authorization:'Bearer session'},body:data})).status,400);}const missing=form();missing.set('intro','');assert.equal((await request('/cats',{method:'POST',headers:{Authorization:'Bearer session'},body:missing})).status,400);assert.equal(calls.some(([name])=>name==='miaomiao_reserve_upload'),false);});
test('failed upload releases its reservation; uncertain database commits never delete photos',async()=>{let s=setup({uploadError:true});assert.equal((await s.request('/cats',{method:'POST',headers:{Authorization:'Bearer session'},body:s.form()})).status,503);assert.equal(s.photos.size,0);assert.ok(s.calls.some(([name])=>name==='miaomiao_cancel_upload'));s=setup({finishFails:2});assert.equal((await s.request('/cats',{method:'POST',headers:{Authorization:'Bearer session'},body:s.form()})).status,503);assert.equal(s.photos.size,1);assert.equal(s.calls.some(([name])=>name==='remove'),false);});
test('an uncertain finish is retried once and can return its existing committed record',async()=>{const s=setup({finishFails:1});assert.equal((await s.request('/cats',{method:'POST',headers:{Authorization:'Bearer session'},body:s.form()})).status,201);assert.equal(s.calls.filter(([name])=>name==='miaomiao_finish_upload').length,2);});
test('comments use the verified visitor, preserve text, hash the IP and validate input',async()=>{const s=setup();const body="<script>alert(1)</script> '); DROP TABLE cats; --";const response=await s.request('/comments',{method:'POST',headers:{Authorization:'Bearer session','Content-Type':'application/json','x-forwarded-for':'spoof, 192.0.2.1'},body:JSON.stringify({owner_id:'forged',catId:'courtyard',nickname:'访客',body})});assert.equal(response.status,201);const args=s.calls.find(([name])=>name==='miaomiao_comment_create')[1];assert.equal(args.p_actor,actor);assert.equal(args.p_body,body);assert.equal(JSON.stringify(args).includes('192.0.2.1'),false);assert.equal((await s.request('/comments',{method:'POST',headers:{Authorization:'Bearer session','Content-Type':'application/json'},body:'null'})).status,400);});
test('database rate and capacity errors have actionable user messages',async()=>{for(const [error,status] of [['MIAOMIAO_RATE_LIMIT',429],['MIAOMIAO_STORAGE_FULL',507],['MIAOMIAO_CAT_NOT_FOUND',404]]){const {request}=setup({rpcError:error});assert.equal((await request('/comments?catId=courtyard')).status,status);}});
test('invalid pages and oversized JSON cannot reach the database',async()=>{const {request,calls}=setup();assert.equal((await request('/cats?offset=-1')).status,400);assert.equal((await request('/comments',{method:'POST',headers:{Authorization:'Bearer session','Content-Type':'application/json'},body:'a'.repeat(9000)})).status,413);assert.equal(calls.some(([name])=>name.startsWith('miaomiao_')),false);});
test('frontend and Edge Function use identical demo IDs and local image assets',async()=>{const edge=JSON.parse(await readFile(new URL('../supabase/functions/miaomiao-api/demos.json',import.meta.url),'utf8'));assert.deepEqual(edge,demos);for(const cat of demos)await readFile(new URL('../public'+cat.image,import.meta.url));});

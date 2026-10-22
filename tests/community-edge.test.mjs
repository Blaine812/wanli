import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHandler} from '../supabase/functions/miaomiao-api/handler.mjs';
import demos from '../shared/demo-cats.json' with {type:'json'};
const image=await readFile(new URL('../public/cats/milk.jpg',import.meta.url));
const actor='00000000-0000-4000-8000-000000000001',batchId='00000000-0000-4000-8000-000000000002';
function setup({failFinish=false}={}){
 const calls=[];const backend={user:async()=>({user:{id:actor,aud:'authenticated'}}),photoUrl:path=>'https://photos.example/'+path,upload:async(path,bytes,mime)=>{calls.push(['upload',path,bytes.length,mime]);return {};},remove:async path=>{calls.push(['remove',path]);},rpc:async(name,args)=>{calls.push([name,args]);if(name==='miaomiao_community_state')return {data:{version:0,totals:{incense:0,blessings:0},feed:[]}};if(name==='miaomiao_community_action')return {data:{version:1}};if(name==='miaomiao_media_file')return {data:{imagePath:'batch/0.jpg',bytes:image.length,mime:'image/jpeg',uploaded:false}};if(name==='miaomiao_media_finish')return failFinish?{error:{message:'uncertain'}}:{data:{cat:{id:batchId,imagePath:'batch/0.jpg',imagePaths:['batch/0.jpg','batch/1.jpg']}}};return {data:[]};}};
 const handler=createHandler({backend,demos,allowedOrigins:['https://miaomiaojiao.cn'],ipSalt:'test'});
 const request=(route,body,auth=true)=>handler(new Request('https://example.test/functions/v1/miaomiao-api'+route,{method:body===undefined?'GET':'POST',headers:{Origin:'https://miaomiaojiao.cn',...(auth?{Authorization:'Bearer test'}:{}),...(!(body instanceof FormData)&&body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)}));
 return {calls,request};
}
test('every community write needs a server-verified visitor; public state has no actor',async()=>{
 const s=setup();for(const route of ['/state','/like','/offer','/blessing-recipient','/media-start','/media-file','/media-finish','/media-cancel'])assert.equal((await s.request(route,{},false)).status,401);
 assert.equal(s.calls.length,0);assert.equal((await s.request('/state',undefined,false)).status,200);assert.deepEqual(s.calls[0],['miaomiao_community_state',{p_actor:null}]);
});
test('forged owner and progress cannot select the actor or control blessing counts',async()=>{
 const s=setup();assert.equal((await s.request('/offer',{p_actor:'forged',incense:99999,blessings:88})).status,200);const [,args]=s.calls.find(([name])=>name==='miaomiao_community_action');assert.equal(args.p_actor,actor);assert.equal(args.p_action,'offer');
 assert.equal((await s.request('/blessing-recipient',{awardId:'invalid'})).status,400);
});
test('reserved files validate actual MIME and bytes before Storage, then use the server path',async()=>{
 const s=setup();const form=()=>{const f=new FormData();f.set('photo',new Blob([image],{type:'image/jpeg'}),'cat.jpg');return f;};
 assert.equal((await s.request('/media-file?batchId='+batchId+'&index=0',form())).status,200);assert.deepEqual(s.calls.find(([name])=>name==='upload'),['upload','batch/0.jpg',image.length,'image/jpeg']);
 const invalid=new FormData();invalid.set('photo',new Blob(['fake'],{type:'image/jpeg'}),'cat.jpg');assert.equal((await s.request('/media-file?batchId='+batchId+'&index=0',invalid)).status,400);assert.equal(s.calls.filter(([name])=>name==='upload').length,1);
 const finish=await s.request('/media-finish',{batchId});assert.equal(finish.status,201);assert.deepEqual((await finish.json()).cat.images,['https://photos.example/batch/0.jpg','https://photos.example/batch/1.jpg']);
});
test('an uncertain multi-photo commit retries without deleting objects',async()=>{
 const s=setup({failFinish:true});assert.equal((await s.request('/media-finish',{batchId})).status,503);assert.equal(s.calls.filter(([name])=>name==='miaomiao_media_finish').length,2);assert.equal(s.calls.some(([name])=>name==='remove'),false);
});

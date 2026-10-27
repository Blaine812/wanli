import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../supabase/functions/miaomiao-api/handler.mjs';
import demos from '../shared/demo-cats.json' with {type:'json'};
function setup(result={username:'admin'}){
 const calls=[];const backend={photoUrl:path=>'https://photos.example/'+path,user:async()=>{throw Error('Administrator must not be a visitor');},rpc:async(name,args)=>{calls.push({name,args});return {data:typeof result==='function'?result(args):structuredClone(result)};}};
 const handler=createHandler({backend,demos,allowedOrigins:['https://miaomiaojiao.cn'],ipSalt:'test'});
 const request=(route,body={},token='',origin='https://miaomiaojiao.cn')=>handler(new Request('https://edge.example/miaomiao-api/admin/'+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)}));
 return {calls,request};
}
test('admin endpoints reject public visitor tokens, missing sessions, and unrelated origins',async()=>{
 const s=setup();for(const route of ['session','data','delete','password','logout']){assert.equal((await s.request(route)).status,401);assert.equal((await s.request(route,{},'visitor.jwt.token')).status,401);}
 assert.equal((await s.request('login',{username:'admin',password:'123456'},'','https://unrelated.example')).status,403);assert.equal(s.calls.length,0);
});
test('login uses server RPC, returns random session once, and stores only its digest',async()=>{
 const s=setup(),response=await s.request('login',{username:'admin',password:'123456'});assert.equal(response.status,200);const value=await response.json();assert.match(value.token,/^[a-f0-9]{64}$/);
 const call=s.calls[0];assert.equal(call.name,'miaomiao_admin_action');assert.equal(call.args.p_action,'login');assert.equal(call.args.p_session_hash,'');assert.notEqual(call.args.p_new_session_hash,value.token);assert.match(call.args.p_new_session_hash,/^[a-f0-9]{64}$/);assert.ok(!call.args.p_ip_hash.includes('.'));
});
test('expired sessions and incorrect password responses preserve server status',async()=>{
 const s=setup({error:'登录已过期，请重新登录',status:401});const response=await s.request('data',{kind:'cats',query:'',page:0},'a'.repeat(64));assert.equal(response.status,401);
 assert.equal((await response.json()).error,'登录已过期，请重新登录');assert.equal(s.calls[0].args.p_session_hash.length,64);
});
test('admin data handles empty albums and hidden demo covers without returning broken images',async()=>{
 const s=setup({items:[{id:'uploaded',name:'小满',imagePath:'removed.jpg',imagePaths:[]},{...demos[0],hideDefault:true,imagePaths:['new.jpg']}],stats:{},total:2});
 const response=await s.request('data',{kind:'cats',query:'',page:0},'a'.repeat(64));assert.equal(response.status,200);const value=await response.json();assert.equal(value.items[0].image,'');assert.deepEqual(value.items[0].images,[]);assert.deepEqual(value.items[1].images,['https://photos.example/new.jpg']);
});
test('photo deletion accepts only exact bucket URLs or the matching demo default',async()=>{
 const s=setup({ok:true}),token='a'.repeat(64);
 assert.equal((await s.request('delete',{kind:'photo',catId:'demo-milk',image:'https://evil.example/a.jpg'},token)).status,400);
 assert.equal((await s.request('delete',{kind:'photo',catId:'demo-milk',image:demos[1].image},token)).status,400);
 assert.equal((await s.request('delete',{kind:'photo',catId:'demo-milk',image:demos[0].image},token)).status,200);assert.equal(s.calls[0].args.p_value.imagePath,demos[0].image);
 assert.equal((await s.request('delete',{kind:'photo',catId:'uploaded',image:'https://photos.example/album/one.jpg'},token)).status,200);assert.equal(s.calls[1].args.p_value.imagePath,'album/one.jpg');
});
test('management input is bounded before reaching the database',async()=>{
 const s=setup(),token='a'.repeat(64);
 assert.equal((await s.request('data',{kind:'cats',query:'',page:-1},token)).status,400);
 assert.equal((await s.request('password',{currentPassword:'123456',newPassword:'short'},token)).status,400);
 assert.equal((await s.request('login',{username:'admin',password:'猫'.repeat(25)})).status,400);assert.equal(s.calls.length,0);
});

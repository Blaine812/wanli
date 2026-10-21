// Explicit end-to-end verification: creates a clearly labeled sample cat and
// comment in this site's Supabase project. Run only as part of launch testing.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
const url='https://bkjdgwbrxrwgluxjuhpa.supabase.co';
const key='sb_publishable_WBypVF6NynmLYSuM2FZBcg_Idf_3kBm';
const auth=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const {data,error}=await auth.auth.signInAnonymously();
assert.ifError(error);assert.ok(data.session?.access_token);
const headers={apikey:key,Origin:'https://blaine812.github.io',Authorization:'Bearer '+data.session.access_token};
const base=url+'/functions/v1/miaomiao-api';
const form=new FormData();
form.set('name','布丁 · 上线测试');form.set('breed','示例小猫');
form.set('intro','这是一张用于验证照片上传的示例照片。愿每一位来到小院的朋友，都能收获毛茸茸的好心情。');
form.set('photo',new Blob([await readFile(new URL('../public/cats/pudding.jpg',import.meta.url))],{type:'image/jpeg'}),'pudding.jpg');
const uploaded=await fetch(base+'/cats',{method:'POST',headers,body:form,signal:AbortSignal.timeout(90000)});
const result=await uploaded.json();assert.equal(uploaded.status,201,JSON.stringify(result));assert.ok(result.cat?.id);
const comment=await fetch(base+'/comments',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({catId:result.cat.id,nickname:'小院测试员',body:'上传和留言测试成功，欢迎来到喵喵小院 🐾'}),signal:AbortSignal.timeout(90000)});
const posted=await comment.json();assert.equal(comment.status,201,JSON.stringify(posted));
const gallery=await (await fetch(base+'/cats',{headers:{apikey:key}})).json();
assert.ok(gallery.cats.some(cat=>cat.id===result.cat.id));
const stored=await (await fetch(base+'/comments?catId='+result.cat.id,{headers:{apikey:key}})).json();
assert.ok(stored.comments.some(item=>item.body==='上传和留言测试成功，欢迎来到喵喵小院 🐾'));
const image=await fetch(result.cat.image);assert.equal(image.status,200);assert.ok((await image.arrayBuffer()).byteLength>0);
console.log(JSON.stringify({anonymousSession:'ok',upload:'persisted',comment:'persisted',photo:'readable',catId:result.cat.id}));

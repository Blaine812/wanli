import {createClient} from '@supabase/supabase-js';
import {supabaseUrl,publishableKey,asset} from './config';
import type {Cat,Comment} from './cats';
const supabase=createClient(supabaseUrl,publishableKey);
let guestSession:Promise<string>|null=null;
async function visitorToken(){
 if(guestSession)return guestSession;
 guestSession=(async()=>{
  const {data:{session},error}=await supabase.auth.getSession();
  if(!error&&session)return session.access_token;
  const result=await supabase.auth.signInAnonymously();
  if(result.error||!result.data.session)throw new Error(result.error?.message.includes('disabled')?'暂时无法进入小院，请联系站主启用匿名访问':'暂时没能连接小院，请稍后再试');
  return result.data.session.access_token;
 })();
 try{return await guestSession;}finally{guestSession=null;}
}
async function request<T>(path:string,options:RequestInit={}):Promise<T>{
 const headers=new Headers(options.headers);headers.set('apikey',publishableKey);
 if(options.method==='POST')headers.set('Authorization',`Bearer ${await visitorToken()}`);
 let response:Response;
 try{response=await fetch(`${supabaseUrl}/functions/v1/miaomiao-api${path}`,{...options,headers,signal:AbortSignal.timeout(90000)});}
 catch{throw new Error('暂时没能连接小院，请检查网络后重试；填写的内容还在。');}
 let result:Record<string,unknown>;try{result=await response.json();}catch{throw new Error('小院暂时没有响应，请稍后重试');}
 if(!response.ok)throw new Error(typeof result.error==='string'?result.error:'这次提交没有成功，请稍后重试');
 return result as T;
}
export async function listCats(offset=0){const result=await request<{cats:Cat[];total:number;nextOffset:number|null}>(`/cats?offset=${offset}`);return {...result,cats:result.cats.map(cat=>cat.demo?{...cat,image:asset(cat.image)}:cat)};}
export const listComments=(catId:string)=>request<{comments:Comment[]}>(`/comments?catId=${encodeURIComponent(catId)}`);
export const uploadCat=(form:FormData)=>request<{cat:Cat}>('/cats',{method:'POST',body:form});
export const postComment=(data:{catId:string;nickname:FormDataEntryValue|null;body:FormDataEntryValue|null})=>request<{comment:Comment}>('/comments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});

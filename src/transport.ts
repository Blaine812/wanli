import {createClient} from '@supabase/supabase-js';
import {supabaseUrl,publishableKey} from './config';
import {localPreview} from './local-preview';
const supabase=localPreview?null:createClient(supabaseUrl,publishableKey);
let guestSession:Promise<string>|null=null;
async function visitorToken(){
 if(!supabase)throw new Error('本地样例不会连接线上访客会话');
 const client=supabase;
 if(guestSession)return guestSession;
 guestSession=(async()=>{
  const {data:{session},error}=await client.auth.getSession();
  if(!error&&session)return session.access_token;
  const result=await client.auth.signInAnonymously();
  if(result.error||!result.data.session)throw new Error(result.error?.message.includes('disabled')?'暂时无法进入小院，请联系站主启用匿名访问':'暂时没能连接小院，请稍后再试');
  return result.data.session.access_token;
 })();
 try{return await guestSession;}finally{guestSession=null;}
}
export async function request<T>(path:string,options:RequestInit={}):Promise<T>{
 const headers=new Headers(options.headers);headers.set('apikey',publishableKey);
 if(options.method==='POST')headers.set('Authorization',`Bearer ${await visitorToken()}`);
 let response:Response;
 try{response=await fetch(`${supabaseUrl}/functions/v1/miaomiao-api${path}`,{...options,headers,signal:AbortSignal.timeout(90000)});}
 catch{throw new Error('暂时没能连接小院，请检查网络后重试；填写的内容还在。');}
 let result:Record<string,unknown>;try{result=await response.json();}catch{throw new Error('小院暂时没有响应，请稍后重试');}
 if(!response.ok)throw new Error(typeof result.error==='string'?result.error:'这次提交没有成功，请稍后重试');
 return result as T;
}

import {localPreview} from './local-preview';
import {supabaseUrl,publishableKey} from './config';
let token='';
if(!localPreview){try{token=sessionStorage.getItem('miaomiao.admin.session')||'';}catch{}}
function remember(value:string){token=value;try{if(value)sessionStorage.setItem('miaomiao.admin.session',value);else sessionStorage.removeItem('miaomiao.admin.session');}catch{}}
export async function adminApi<T>(path:string,body?:unknown):Promise<T>{
 let response:Response;
 try{
  if(localPreview)response=await fetch('/__review/admin'+path,{credentials:'same-origin',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  else{
   const [route,query]=path.split('?'),params=new URLSearchParams(query);
   const value=route==='/data'?{kind:params.get('kind'),query:params.get('query')||'',page:Number(params.get('page')||0)}:body||{};
   response=await fetch(supabaseUrl+'/functions/v1/miaomiao-api/admin'+route,{method:'POST',headers:{apikey:publishableKey,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(value),signal:AbortSignal.timeout(30000)});
  }
 }catch{throw new Error(localPreview?'没有连接到本地小院，请确认本地服务正在运行':'暂时没有连接到管理室，请稍后重试');}
 const value=await response.json();
 if(!response.ok){if(!localPreview&&response.status===401)remember('');const error=new Error(value.error||'操作没有完成，请重试') as Error&{status:number};error.status=response.status;throw error;}
 if(!localPreview){if(typeof value.token==='string')remember(value.token);if(path==='/logout')remember('');}
 return value;
}

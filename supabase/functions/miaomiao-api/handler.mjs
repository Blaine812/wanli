import {createCommunityHandler,communityRoutes} from './community.mjs';
const MB=1024*1024;
class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new ApiError(status,message);};
function dbError(error){
 const message=String(error?.message||'');
 if(message.includes('MIAOMIAO_RATE_LIMIT'))fail(429,'先让小猫休息一下吧，稍后再来分享');
 if(message.includes('MIAOMIAO_STORAGE_FULL'))fail(507,'小院相册空间暂满，请稍后再试');
 if(message.includes('MIAOMIAO_CAT_NOT_FOUND'))fail(404,'这只小猫还没有来到小院');
 if(error?.code==='22023')fail(400,'填写的内容不符合要求，请检查后重试');
 fail(503,'小院暂时有点忙，请稍后重试');
}
export function imageMime(bytes){
 if(bytes.length<12)return null;
 if([137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))return 'image/png';
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 const text=new TextDecoder('ascii');
 if(text.decode(bytes.subarray(0,4))==='RIFF'&&text.decode(bytes.subarray(8,12))==='WEBP')return 'image/webp';
 return null;
}
async function limitedBody(request,max){
 const declared=Number(request.headers.get('content-length'));
 if(Number.isFinite(declared)&&declared>max)fail(413,'内容太大啦，请缩小后重试');
 if(!request.body)return new Uint8Array();
 const reader=request.body.getReader(),chunks=[];let length=0;
 try{while(true){const result=await reader.read();if(result.done)break;length+=result.value.length;if(length>max){await reader.cancel();fail(413,'内容太大啦，请缩小后重试');}chunks.push(result.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
export function createHandler({backend,demos,allowedOrigins,ipSalt}){
 if(!ipSalt)throw new Error('IP hashing key is not configured.');
 const origins=new Set(allowedOrigins);
 const signingKey=crypto.subtle.importKey('raw',new TextEncoder().encode(ipSalt),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 async function ipHash(req){
  // Supabase's gateway supplies the connecting address. The last forwarded hop
  // is used so prepending a client-supplied IP cannot change the rate-limit key.
  const value=(req.headers.get('x-forwarded-for')||'unknown').split(',').at(-1).trim();
  const bytes=await crypto.subtle.sign('HMAC',await signingKey,new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
 }
 async function rpc(name,args){const {data,error}=await backend.rpc(name,args);if(error)dbError(error);return data;}
 const catDto=cat=>{const {imagePath,imagePaths,...fields}=cat;return {...fields,image:backend.photoUrl(imagePath),images:(imagePaths||[imagePath]).map(backend.photoUrl)};};
 const commentDto=comment=>{const {imagePaths,...fields}=comment;return {...fields,images:(imagePaths||[]).map(backend.photoUrl)};};
 const community=createCommunityHandler({backend,rpc,fail,readBody:limitedBody,imageMime,catDto,commentDto,demos});
 return async function handle(req){
  const origin=req.headers.get('origin');
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
  const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(origin&&!origins.has(origin))return response({error:'请从小院页面访问'},403);
  if(origin)headers['Access-Control-Allow-Origin']=origin;
  headers['Access-Control-Allow-Headers']='authorization, apikey, x-client-info, content-type';
  headers['Access-Control-Allow-Methods']='GET, POST, OPTIONS';
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  try{
   const url=new URL(req.url);const marker='/miaomiao-api';const at=url.pathname.indexOf(marker);
   const route=at<0?url.pathname:url.pathname.slice(at+marker.length)||'/';
   if(req.method==='GET'&&route==='/health')return response({status:'ok',version:2});
   if(req.method==='GET'&&route==='/state')return response(await rpc('miaomiao_community_state',{p_actor:null}));
   if(req.method==='GET'&&route==='/cat-options')return response({cats:[...await rpc('miaomiao_cat_options',{}),...demos.map(({id,name,breed})=>({id,name,breed}))]});
   if(req.method==='GET'&&route==='/cats'){
    const offset=Number(url.searchParams.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0||offset>10000000)fail(400,'相册页码不正确');
    const data=await rpc('miaomiao_gallery',{p_offset:offset});
    const cats=data.cats.map(catDto);
    if(data.nextOffset===null)cats.push(...demos.map(cat=>({...cat,images:[cat.image,...(data.demoPhotos?.[cat.id]||[]).map(backend.photoUrl)],commentCount:Number(data.demoCounts[cat.id]||0)})));
    return response({cats,total:Number(data.uploadedTotal)+demos.length,nextOffset:data.nextOffset});
   }
   if(req.method==='GET'&&route==='/comments'){
    const id=url.searchParams.get('catId')||'courtyard';if(id.length>60)fail(400,'小猫档案地址不正确');
    const data=await rpc('miaomiao_comments_get',{p_cat_id:id});return response({comments:data.comments.map(commentDto)});
   }
   if(req.method!=='POST')return response({error:'没有找到这个地址'},404);
   if(route!=='/cats'&&route!=='/comments'&&!communityRoutes.has(route))return response({error:'没有找到这个地址'},404);
   const authorization=req.headers.get('authorization')||'';
   if(!/^Bearer [^\s]+$/.test(authorization))fail(401,'请刷新页面后再试');
   const {user,error}=await backend.user(authorization.slice(7));
   if(error||!user?.id||!user?.aud||user.aud!=='authenticated')fail(401,'访客会话已过期，请刷新页面后再试');
   const hash=await ipHash(req);
   if(communityRoutes.has(route)){const result=await community(req,route,user.id,hash);return response(result.body,result.status||200);}
   if(route==='/comments'){
    if(!req.headers.get('content-type')?.startsWith('application/json'))fail(415,'留言格式不正确');
    const raw=await limitedBody(req,8192);let value;try{value=JSON.parse(new TextDecoder().decode(raw));}catch{fail(400,'留言格式不正确');}
    if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'留言格式不正确');
    const nickname=typeof value.nickname==='string'?value.nickname.trim():'',body=typeof value.body==='string'?value.body.trim():'';
    const catId=typeof value.catId==='string'?value.catId:'courtyard';
    if(!nickname||nickname.length>24||!body||body.length>500||catId.length>60)fail(400,'请填写昵称（24字以内）和留言（500字以内）');
    return response(await rpc('miaomiao_comment_create',{p_actor:user.id,p_ip_hash:hash,p_cat_id:catId,p_nickname:nickname,p_body:body}),201);
   }
   const raw=await limitedBody(req,9*MB);let form;
   try{form=await new Request(req.url,{method:'POST',headers:{'content-type':req.headers.get('content-type')||''},body:raw}).formData();}catch{fail(400,'照片上传格式不正确');}
   const name=form.get('name'),intro=form.get('intro'),label=form.get('breed');
   if(typeof name!=='string'||!name.trim()||name.trim().length>24||typeof intro!=='string'||!intro.trim()||intro.trim().length>400||label!==null&&typeof label!=='string'||typeof label==='string'&&label.trim().length>24)fail(400,'请填写名字（24字以内）和介绍（400字以内）');
   const breed=typeof label==='string'&&label.trim()?label.trim():'小猫咪',photo=form.get('photo');
   if(!(photo instanceof File)||photo.size===0||photo.size>8*MB)fail(400,'请选择8MB以内的 JPG、PNG 或 WebP 图片');
   const bytes=new Uint8Array(await photo.arrayBuffer()),mime=imageMime(bytes);
   if(!mime)fail(400,'仅支持真实的 JPG、PNG 或 WebP 图片');
   const reservation=await rpc('miaomiao_reserve_upload',{p_actor:user.id,p_ip_hash:hash,p_name:name.trim(),p_intro:intro.trim(),p_breed:breed,p_bytes:bytes.length,p_mime:mime});
   let uploadError;try{const result=await backend.upload(reservation.imagePath,bytes,mime);uploadError=result.error;}catch(error){uploadError=error;}
   if(uploadError){
    // No publish was attempted, so removing this newly generated object is safe.
    await backend.remove(reservation.imagePath).catch(()=>{});
    await backend.rpc('miaomiao_cancel_upload',{p_id:reservation.id,p_actor:user.id}).catch(()=>{});
    fail(503,'照片暂时没有上传成功，你填写的内容还在');
   }
   let result=await backend.rpc('miaomiao_finish_upload',{p_id:reservation.id,p_actor:user.id}).catch(()=>({error:{message:'Network error'}}));
   if(result.error)result=await backend.rpc('miaomiao_finish_upload',{p_id:reservation.id,p_actor:user.id}).catch(()=>({error:{message:'Network error'}}));
   // The commit may have succeeded even if the response was lost. Never remove
   // the image after an uncertain finish; finish_upload is idempotent.
   if(result.error)dbError(result.error);
   return response({cat:catDto(result.data)},201);
  }catch(error){
   if(error instanceof ApiError)return response({error:error.message},error.status);
   console.error('miaomiao-api request failed:',error?.code||error?.name||'Error');
   return response({error:'小院暂时有点忙，请稍后重试'},503);
  }
 };
}

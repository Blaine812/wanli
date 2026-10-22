const MB=1024*1024;
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const communityRoutes=new Set(['/state','/like','/offer','/blessing-recipient','/media-start','/media-file','/media-finish','/media-cancel']);
export function createCommunityHandler({backend,rpc,fail,readBody,imageMime,catDto,commentDto,demos}){
 async function json(req){if(!req.headers.get('content-type')?.startsWith('application/json'))fail(415,'提交格式不正确');let value;try{value=JSON.parse(new TextDecoder().decode(await readBody(req,16384)));}catch(error){if(error?.status)throw error;fail(400,'提交格式不正确');}if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'提交格式不正确');return value;}
 return async(req,route,actor,hash)=>{
  if(route==='/media-file'){
   const url=new URL(req.url),id=url.searchParams.get('batchId'),index=Number(url.searchParams.get('index'));
   if(!uuid(id)||!Number.isInteger(index)||index<0||index>8)fail(400,'照片地址不正确');
   const reserved=await rpc('miaomiao_media_file',{p_actor:actor,p_id:id,p_index:index});
   const raw=await readBody(req,9*MB);let form;try{form=await new Request(req.url,{method:'POST',headers:{'content-type':req.headers.get('content-type')||''},body:raw}).formData();}catch{fail(400,'照片格式不正确');}
   const file=form.get('photo');if(!(file instanceof File)||!file.size||file.size>8*MB)fail(400,'请选择8MB以内的 JPG、PNG 或 WebP 图片');
   const bytes=new Uint8Array(await file.arrayBuffer()),mime=imageMime(bytes);
   if(!mime||mime!==reserved.mime||bytes.length!==reserved.bytes)fail(400,'照片与选择时的格式或大小不符，请重新分享');
   if(!reserved.uploaded){let result;try{result=await backend.upload(reserved.imagePath,bytes,mime);}catch{fail(503,'照片暂时没有上传成功，请重试');}if(result.error)fail(503,'照片暂时没有上传成功，请重试');}
   return {body:{uploaded:true}};
  }
  const value=await json(req);
  if(['/state','/like','/offer','/blessing-recipient'].includes(route)){
   if(route==='/blessing-recipient'&&(!uuid(value.awardId)||value.name!==undefined&&typeof value.name!=='string'||typeof value.name==='string'&&value.name.trim().length>24||value.catId!==undefined&&typeof value.catId!=='string'))fail(400,'请填写24字以内的名字，或选择小猫');
   if(route==='/like'&&(typeof value.catId!=='string'||value.catId.length>60))fail(400,'小猫档案地址不正确');
   return {body:await rpc('miaomiao_community_action',{p_actor:actor,p_action:route.slice(1),p_value:value})};
  }
  if(route==='/media-start'){
   if(!['cat','append','comment'].includes(value.kind)||!value.payload||typeof value.payload!=='object'||Array.isArray(value.payload)||!Array.isArray(value.files)||value.files.length<1||value.files.length>9||value.files.some(file=>!file||!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>8*MB||!['image/jpeg','image/png','image/webp'].includes(file.mime)))fail(400,'每次可分享1至9张，每张8MB以内的照片');
   return {body:await rpc('miaomiao_media_start',{p_actor:actor,p_ip_hash:hash,p_kind:value.kind,p_payload:value.payload,p_files:value.files}),status:201};
  }
  if(!uuid(value.batchId))fail(400,'这次分享的地址不正确');
  if(route==='/media-cancel'){
   const paths=await rpc('miaomiao_media_cancel',{p_actor:actor,p_id:value.batchId});
   for(const path of paths||[])await backend.remove(path).catch(()=>{});
   return {body:{cancelled:true}};
  }
  // Finish is idempotent. A lost response must never delete a published image.
  let result=await backend.rpc('miaomiao_media_finish',{p_actor:actor,p_id:value.batchId}).catch(()=>({error:true}));
  if(result.error)result=await rpc('miaomiao_media_finish',{p_actor:actor,p_id:value.batchId});else result=result.data;
  if(result.cat)return {body:{cat:catDto(result.cat)},status:201};
  if(result.comment)return {body:{comment:commentDto(result.comment)},status:201};
  const demo=demos.find(cat=>cat.id===result.catId);if(!demo)fail(503,'小院暂时有点忙，请稍后重试');
  const comments=await rpc('miaomiao_comments_get',{p_cat_id:demo.id});
  return {body:{cat:{...demo,images:[demo.image,...result.imagePaths.map(backend.photoUrl)],commentCount:comments.comments.length}},status:201};
 };
}

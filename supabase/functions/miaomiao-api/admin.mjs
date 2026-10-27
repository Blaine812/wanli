// Administrator sessions are separate from public visitor identities.
export function createAdminHandler({backend,fail,readBody,demos,catDto,commentDto,demoDto}){
 const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
 return async(req,route,ipHash)=>{
  if(req.method!=='POST')fail(405,'请使用管理页面完成操作');
  if(!req.headers.get('content-type')?.startsWith('application/json'))fail(415,'提交格式不正确');
  let body;try{body=JSON.parse(new TextDecoder().decode(await readBody(req,16384)));}catch(error){if(error?.status)throw error;fail(400,'提交格式不正确');}
  if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'提交格式不正确');
  const action=route.slice('/admin/'.length);if(!['login','session','logout','password','data','delete'].includes(action))fail(404,'没有找到这个管理操作');
  const token=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
  if(action!=='login'&&!/^[a-f0-9]{64}$/.test(token))fail(401,'请先登录管理后台');
  if(action==='login'&&(typeof body.username!=='string'||typeof body.password!=='string'||new TextEncoder().encode(body.password).length>72))fail(400,'请检查账号和密码');
  if(action==='password'&&(['currentPassword','newPassword'].some(key=>typeof body[key]!=='string'||new TextEncoder().encode(body[key]).length>72)||body.newPassword.length<6))fail(400,'密码请填写至少6位，且不超过72字节');
  if(action==='data'&&(!['cats','comments','blessings'].includes(body.kind)||typeof body.query!=='string'||body.query.length>100||!Number.isSafeInteger(body.page)||body.page<0||body.page>100000))fail(400,'查询条件不正确');
  const value={...body};
  if(action==='delete'){
   if(!['photo','comment','blessing'].includes(body.kind))fail(400,'不支持这个删除操作');
   if(body.kind==='photo'){
    const demo=demos.find(cat=>cat.id===body.catId&&cat.image===body.image),prefix=backend.photoUrl('');
    if(demo)value.imagePath=demo.image;
    else if(typeof body.image==='string'&&body.image.startsWith(prefix)&&body.image.length>prefix.length)value.imagePath=body.image.slice(prefix.length);
    else fail(400,'照片地址不正确');
   }
  }
  const newToken=['login','password'].includes(action)?Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''):'';
  const {data,error}=await backend.rpc('miaomiao_admin_action',{p_action:action,p_session_hash:action==='login'?'':await digest(token),p_new_session_hash:newToken?await digest(newToken):'',p_ip_hash:ipHash,p_value:value,p_demos:demos});
  if(error)fail(503,'管理室暂时有点忙，请稍后重试');
  if(data?.error)fail(data.status||400,data.error);
  if(action==='data')data.items=data.items.map(item=>body.kind==='cats'?(item.demo?demoDto(item,item):catDto(item)):body.kind==='comments'?commentDto(item):item);
  return {...data,...(newToken?{token:newToken}:{})};
 };
}

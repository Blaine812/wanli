import {createClient} from 'npm:@supabase/supabase-js@2';
import {createHandler} from './handler.mjs';
import demos from './demos.json' with {type:'json'};
const projectUrl=Deno.env.get('SUPABASE_URL')!;
const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const secret=keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if(!projectUrl||!secret)throw new Error('Supabase server credentials are missing.');
const admin=createClient(projectUrl,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const photos=admin.storage.from('miaomiao-photos');
const handler=createHandler({
 backend:{
  rpc:async(name:string,args:Record<string,unknown>)=>await admin.rpc(name,args),
  user:async(token:string)=>{const {data,error}=await admin.auth.getUser(token);return {user:data.user,error};},
  upload:(name:string,bytes:Uint8Array,mime:string)=>photos.upload(name,bytes,{contentType:mime,cacheControl:'86400',upsert:false}),
  remove:(name:string)=>photos.remove([name]),
  photoUrl:(name:string)=>photos.getPublicUrl(name).data.publicUrl,
 },
 demos,
 ipSalt:Deno.env.get('MIAOMIAO_IP_SALT')||secret,
 allowedOrigins:['https://blaine812.github.io','https://miaomiaojiao.cn','https://www.miaomiaojiao.cn','http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:4173','http://localhost:4173'],
});
Deno.serve(handler);

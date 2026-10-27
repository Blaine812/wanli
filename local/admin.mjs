import {readFileSync,writeFileSync,existsSync,renameSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';

const digest=value=>createHash('sha256').update(value).digest('hex');
export function createAdminService(root,store,{now=Date.now}={}){
 mkdirSync(root,{recursive:true});const file=join(root,'admin-auth.json');
 const passwordRecord=password=>{const salt=randomBytes(16).toString('hex');return {salt,hash:scryptSync(password,salt,64).toString('hex')};};
 let credentials=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{username:'admin',...passwordRecord('123456')};
 const save=()=>{writeFileSync(file+'.tmp',JSON.stringify(credentials),{mode:0o600});renameSync(file+'.tmp',file);};
 if(!existsSync(file))save();
 const sessions=new Map(),attempts=new Map();
 function fail(status,message){const error=new Error(message);error.status=status;throw error;}
 const matches=password=>{if(typeof password!=='string'||password.length>200)return false;const actual=scryptSync(password,credentials.salt,64),expected=Buffer.from(credentials.hash,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected);};
 const issue=()=>{const token=randomBytes(32).toString('hex');sessions.set(digest(token),now()+8*60*60*1000);return token;};
 const verify=token=>{const key=digest(token||''),expiry=sessions.get(key);if(!expiry||expiry<=now()){sessions.delete(key);fail(401,'请先登录管理后台');}return key;};
 return {
  act(path,method,body={},token='',ip='local',query=new URLSearchParams()){
   if(path==='/login'&&method==='POST'){
    for(const [key,value] of attempts)if(value.expires<=now())attempts.delete(key);
    const before=attempts.get(ip);if(before&&before.count>=8)fail(429,'尝试次数较多，请稍后再登录');
    if(body.username!==credentials.username||!matches(body.password)){attempts.set(ip,{count:(before?.count||0)+1,expires:before?.expires||now()+60*1000});fail(401,'账号或密码不正确');}
    attempts.delete(ip);return {body:{username:credentials.username},token:issue()};
   }
   const session=verify(token);
   if(path==='/session'&&method==='GET')return {body:{username:credentials.username}};
   if(path==='/logout'&&method==='POST'){sessions.delete(session);return {body:{ok:true},token:''};}
   if(path==='/password'&&method==='POST'){
    if(!matches(body.currentPassword))fail(400,'当前密码不正确');
    if(typeof body.newPassword!=='string'||body.newPassword.length<6||body.newPassword.length>200)fail(400,'新密码请填写6至200位');
    credentials={username:credentials.username,...passwordRecord(body.newPassword)};save();sessions.clear();return {body:{ok:true,username:credentials.username},token:issue()};
   }
   if(path==='/data'&&method==='GET')return {body:store.adminList(query.get('kind')||'cats',query.get('query')||'',Number(query.get('page')||0))};
   if(path==='/delete'&&method==='POST')return {body:store.adminDelete(body)};
   fail(404,'没有找到这个管理操作');
  }
 };
}

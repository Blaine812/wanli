import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createReviewStore,reviewApi} from '../local/server.mjs';
import {createAdminService} from '../local/admin.mjs';
const root=()=>mkdtempSync(join(tmpdir(),'miaomiao-admin-'));
const image='data:image/png;base64,'+readFileSync(new URL('../public/cat-god.png',import.meta.url)).toString('base64');
const login=service=>service.act('/login','POST',{username:'admin',password:'123456'}).token;

test('management requires server authentication and stores a salted hash',()=>{
 const folder=root(),store=createReviewStore(folder),admin=createAdminService(folder,store);
 for(const [path,method] of [['/data','GET'],['/delete','POST'],['/password','POST']])assert.throws(()=>admin.act(path,method,{}),error=>error.status===401);
 assert.throws(()=>admin.act('/login','POST',{username:'admin',password:'wrong'}),error=>error.status===401);
 assert.throws(()=>admin.act('/login','POST',{username:'other',password:'123456'}),error=>error.status===401);
 const token=login(admin);assert.equal(admin.act('/session','GET',{},token).body.username,'admin');
 assert.ok(admin.act('/data','GET',{},token).body.total>0);
 const credentials=readFileSync(join(folder,'admin-auth.json'),'utf8');assert.ok(!credentials.includes('123456'));assert.equal(JSON.parse(credentials).hash.length,128);
 admin.act('/logout','POST',{},token);assert.throws(()=>admin.act('/session','GET',{},token),error=>error.status===401);
});
test('password changes persist, validate current password, and revoke every previous session',()=>{
 const folder=root(),store=createReviewStore(folder),admin=createAdminService(folder,store),one=login(admin),two=login(admin);
 assert.throws(()=>admin.act('/password','POST',{currentPassword:'bad',newPassword:'newpass88'},one));
 assert.throws(()=>admin.act('/password','POST',{currentPassword:'123456',newPassword:'123'},one));
 const replacement=admin.act('/password','POST',{currentPassword:'123456',newPassword:'newpass88'},one).token;
 for(const token of [one,two])assert.throws(()=>admin.act('/session','GET',{},token),error=>error.status===401);
 assert.equal(admin.act('/session','GET',{},replacement).body.username,'admin');
 const restarted=createAdminService(folder,store);assert.throws(()=>login(restarted),error=>error.status===401);
 assert.ok(restarted.act('/login','POST',{username:'admin',password:'newpass88'}).token);
});
test('login rate limiting and session expiration are enforced',()=>{
 let now=1000;const folder=root(),admin=createAdminService(folder,createReviewStore(folder),{now:()=>now});
 for(let i=0;i<8;i++)assert.throws(()=>admin.act('/login','POST',{username:'admin',password:'bad'}));
 assert.throws(()=>login(admin),error=>error.status===429);now+=60001;const token=login(admin);now+=8*60*60*1000;
 assert.throws(()=>admin.act('/session','GET',{},token),error=>error.status===401);
});
test('single-photo deletion preserves other photos, metadata, demos and later additions',()=>{
 const store=createReviewStore(root()),cat=store.act('a','/cats',{name:'奶盖',intro:'爱晒太阳',images:[image,image]}).cat;
 assert.equal(store.mediaVisible(cat.images[0].split('/').pop()),true);store.adminDelete({kind:'photo',catId:cat.id,image:cat.images[0]});let saved=store.cats().cats.find(row=>row.id===cat.id);
 assert.equal(store.mediaVisible(cat.images[0].split('/').pop()),false);
 assert.deepEqual(saved.images,[cat.images[1]]);assert.equal(saved.image,cat.images[1]);
 store.adminDelete({kind:'photo',catId:cat.id,image:cat.images[1]});saved=store.cats().cats.find(row=>row.id===cat.id);
 assert.equal(saved.name,'奶盖');assert.equal(saved.intro,'爱晒太阳');assert.deepEqual(saved.images,[]);assert.equal(saved.image,'');
 const updated=store.act('b','/photos',{catId:cat.id,images:[image]}).cat;assert.equal(updated.images.length,1);assert.equal(updated.image,updated.images[0]);
 const demos=store.cats().cats.filter(row=>row.demo);store.adminDelete({kind:'photo',catId:demos[0].id,image:demos[0].image});
 assert.deepEqual(store.cats().cats.find(row=>row.id===demos[0].id).images,[]);assert.equal(store.cats().cats.find(row=>row.id===demos[1].id).image,demos[1].image);
 assert.equal(createReviewStore(store.root).cats().cats.find(row=>row.id===demos[0].id).image,'');
});
test('one comment can be removed without affecting other comments or cats',()=>{
 const store=createReviewStore(root()),cat=store.cats().cats[0];
 const first=store.act('a','/comments',{catId:cat.id,nickname:'小满',body:'可爱',images:[image]}).comment;
 const second=store.act('b','/comments',{catId:cat.id,nickname:'云朵',body:'晚安'}).comment;
 store.adminDelete({kind:'comment',id:first.id});assert.deepEqual(store.comments(cat.id).comments.map(row=>row.id),[second.id]);assert.equal(store.cats().cats.find(row=>row.id===cat.id).commentCount,1);
 assert.throws(()=>store.adminDelete({kind:'comment',id:first.id}));assert.equal(store.adminList('comments','云朵').total,1);
});
test('deleting a blessing hides it for every visitor and after restart but preserves offering history',()=>{
 const store=createReviewStore(root(),()=>0);const first=store.act('a','/offer').award;
 store.act('a','/blessing-recipient',{awardId:first.id,name:'小满'});const pending=store.act('a','/offer').award;
 store.adminDelete({kind:'blessing',id:first.id});assert.equal(store.snapshot('b').feed.length,0);
 store.adminDelete({kind:'blessing',id:pending.id});assert.equal(store.snapshot('a').lastAward,null);assert.equal(store.adminList('blessings').total,0);
 assert.throws(()=>store.act('a','/blessing-recipient',{awardId:pending.id,name:'再次出现'}));
 const restored=createReviewStore(store.root);assert.equal(restored.snapshot('a').lastAward,null);assert.deepEqual(restored.snapshot('b').totals,{incense:2,blessings:2});
 assert.equal(restored.snapshot('a').ritual.blessings,2);assert.equal(JSON.parse(readFileSync(join(store.root,'community.json'),'utf8')).adminTrash.length,2);
});
test('HTTP management endpoints authenticate, reject cross-site changes, and issue HttpOnly cookies',async()=>{
 const previous=process.env.REVIEW_DATA_DIR;process.env.REVIEW_DATA_DIR=root();let middleware;reviewApi().configureServer({middlewares:{use:value=>{middleware=value;}}});
 if(previous===undefined)delete process.env.REVIEW_DATA_DIR;else process.env.REVIEW_DATA_DIR=previous;
 const server=createServer((req,res)=>middleware(req,res,()=>{res.statusCode=404;res.end();}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}/__review/admin`;
 try{
  const denied=await fetch(base+'/data');assert.equal(denied.status,401);assert.ok(!(await denied.text()).includes('cats'));
  const cross=await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://unrelated.example'},body:JSON.stringify({username:'admin',password:'123456'})});assert.equal(cross.status,400);
  const response=await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'123456'})});assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
  const result=await fetch(base+'/data?kind=cats',{headers:{Cookie:cookie.split(';')[0]}});assert.equal(result.status,200);assert.ok((await result.json()).items.length);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

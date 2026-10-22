import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {offerIncense,normalizeProgress,normalizeLikes} from '../src/ritual.ts';
import demos from '../shared/demo-cats.json' with {type:'json'};

export function createReviewStore(root,random=Math.random){
 mkdirSync(root,{recursive:true});const file=join(root,'community.json');
 let state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{version:0,cats:[],comments:{},likes:{},visitors:{},feed:[],incense:0,blessings:0};
 const visitor=(data,id)=>data.visitors[id]||{progress:normalizeProgress(null),lastAward:null,imported:false};
 const snapshot=id=>({version:state.version,likes:state.likes,totals:{incense:state.incense,blessings:state.blessings},ritual:visitor(state,id).progress,lastAward:visitor(state,id).lastAward,feed:state.feed});
 const commit=fn=>{const next=structuredClone(state);const result=fn(next);next.version++;writeFileSync(file+'.tmp',JSON.stringify(next));renameSync(file+'.tmp',file);state=next;return result;};
 const text=(value,max,required=false)=>{const s=String(value||'').trim();if(s.length>max||required&&!s)throw new Error('请检查文字是否填写完整或超过长度');return s;};
 const allCats=data=>[...data.cats,...demos.filter(cat=>!data.cats.some(item=>item.id===cat.id))].map(cat=>({...cat,images:cat.images||[cat.image],commentCount:(data.comments[cat.id]||[]).length}));
 const findCat=(data,id)=>{if(!allCats(data).some(c=>c.id===id))throw new Error('没有找到这只小猫');};
 const images=(values,required=false)=>{
  if(!Array.isArray(values)||values.length>9||required&&!values.length)throw new Error('每次可选择 1 至 9 张照片');
  return values.map(value=>{
   const match=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(value));if(!match)throw new Error('请选择 JPG、PNG 或 WebP 图片');
   const bytes=Buffer.from(match[2],'base64');if(!bytes.length||bytes.length>8*1024*1024)throw new Error('每张图片需在 8MB 以内');
   const valid=match[1]==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:match[1]==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
   if(!valid)throw new Error('图片内容与格式不匹配，请重新选择');
   const name=randomUUID()+'.'+({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[match[1]]);writeFileSync(join(root,name),bytes);return '/__review/media/'+name;
  });
 };
 return {snapshot,root,
  cats:()=>({cats:allCats(state),total:allCats(state).length,nextOffset:null}),
  comments:id=>({comments:state.comments[id]||[]}),
  act(id,path,body={}){
   if(path==='/import'){
    if(visitor(state,id).imported)return snapshot(id);
    commit(data=>{const current=visitor(data,id);current.imported=true;
     if(current.progress.incense===0){current.progress=normalizeProgress(body.ritual);data.incense+=current.progress.incense;data.blessings+=current.progress.blessings;}
     for(const [cat,count] of Object.entries(normalizeLikes(body.likes)))data.likes[cat]=(data.likes[cat]||0)+count;
     data.visitors[id]=current;
    });return snapshot(id);
   }
   if(path==='/offer'){
    let award=null;commit(data=>{const current=visitor(data,id);const result=offerIncense(current.progress,random);current.progress=result.progress;data.incense++;
     if(result.newBlessing){award={id:randomUUID(),blessingId:result.newBlessing.id,name:'',recipientSet:false,createdAt:Date.now()};data.blessings++;current.lastAward=award;current.awards={...current.awards,[award.id]:award};}
     data.visitors[id]=current;
    });return {...snapshot(id),award};
   }
   if(path==='/blessing-recipient'){
    const current=visitor(state,id);const saved=current.awards?.[body.awardId]||(current.lastAward?.id===body.awardId?current.lastAward:null);
    if(!saved)throw new Error('没有找到属于你的这份祝福');
    // A recipient is chosen once, after the blessing has been earned. Retrying is safe.
    if(saved.recipientSet!==false)return {...snapshot(id),award:saved};
    const cat=body.catId?allCats(state).find(cat=>cat.id===body.catId):null;
    if(body.catId&&!cat)throw new Error('这只小猫暂时不在小院里，请重新选择');
    const name=cat?cat.name:text(body.name,24)||'一位小院朋友';let award;
    commit(data=>{const owner=visitor(data,id);award={...saved,name,catId:cat?.id||null,recipientSet:true};owner.awards={...owner.awards,[award.id]:award};if(owner.lastAward?.id===award.id)owner.lastAward=award;data.visitors[id]=owner;data.feed.unshift(award);});
    return {...snapshot(id),award};
   }
   if(path==='/like'){findCat(state,body.catId);commit(data=>{data.likes[body.catId]=(data.likes[body.catId]||0)+1;});return snapshot(id);}
   if(path==='/cats'){
    const cat={id:randomUUID(),name:text(body.name,24,true),breed:text(body.breed,24)||'小猫咪',intro:text(body.intro,400,true),images:images(body.images,true),createdAt:Date.now()};cat.image=cat.images[0];commit(data=>data.cats.unshift(cat));return {cat};
   }
   if(path==='/photos'){
    findCat(state,body.catId);const added=images(body.images,true);let updated;
    commit(data=>{let cat=data.cats.find(c=>c.id===body.catId);if(!cat){cat=structuredClone(demos.find(c=>c.id===body.catId));data.cats.push(cat);}cat.images=[...(cat.images||[cat.image]),...added];updated={...cat,commentCount:(data.comments[cat.id]||[]).length};});return {cat:updated};
   }
   if(path==='/comments'){
    if(body.catId!=='courtyard')findCat(state,body.catId);
    const comment={id:randomUUID(),nickname:text(body.nickname,24,true),body:text(body.body,500),images:images(body.images||[]),createdAt:Date.now()};if(!comment.body&&!comment.images.length)throw new Error('写一句话或分享一张照片吧');
    commit(data=>{data.comments[body.catId]=[comment,...(data.comments[body.catId]||[])];});return {comment};
   }
   throw new Error('没有找到这个操作');
  }
 };
}

export function reviewApi(){
 const store=createReviewStore(resolve(process.env.REVIEW_DATA_DIR||'outputs/review-data'));
 const middleware=async(req,res,next)=>{
  if(!req.url?.startsWith('/__review/'))return next();
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  try{
   const url=new URL(req.url,'http://localhost'),path=url.pathname.slice('/__review'.length);
   if(path.startsWith('/media/')){
    const name=path.slice(7);if(!/^[a-f0-9-]+\.(jpg|png|webp)$/.test(name))throw new Error('图片不存在');
    res.setHeader('Content-Type',name.endsWith('.jpg')?'image/jpeg':name.endsWith('.png')?'image/png':'image/webp');res.end(readFileSync(join(store.root,name)));return;
   }
   // Same-origin local API only; do not accept cross-site mutations.
   if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)throw new Error('请在本地预览页面操作');
   const cookie=/review_visitor=([a-f0-9-]{36})/.exec(req.headers.cookie||'');const id=cookie?.[1]||randomUUID();
   if(!cookie)res.setHeader('Set-Cookie',`review_visitor=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);
   let result;
   if(req.method==='GET')result=path==='/state'?store.snapshot(id):path==='/cats'?store.cats():path==='/comments'?store.comments(url.searchParams.get('catId')):null;
   else if(req.method==='POST'){
    if(!String(req.headers['content-type']).startsWith('application/json'))throw new Error('请求格式有误');
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>100*1024*1024)throw new Error('一次选择的图片太大了，请分批分享');chunks.push(chunk);}
    result=store.act(id,path,JSON.parse(Buffer.concat(chunks).toString('utf8')));
   }
   if(!result){res.statusCode=404;result={error:'没有找到这个页面'};}
   res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(result));
  }catch(error){res.statusCode=400;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({error:error instanceof Error?error.message:'操作失败，请重试'}));}
 };
 return {name:'local-review-api',configureServer(server){server.middlewares.use(middleware);},configurePreviewServer(server){server.middlewares.use(middleware);}};
}

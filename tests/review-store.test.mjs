import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createReviewStore} from '../local/server.mjs';
const make=(random=()=>.9)=>createReviewStore(mkdtempSync(join(tmpdir(),'miaomiao-review-')),random);
const image='data:image/png;base64,'+readFileSync(new URL('../public/cat-god.png',import.meta.url)).toString('base64');
test('global offerings sum across independent visitors while hidden rules stay personal',()=>{
 const store=make();for(let i=0;i<40;i++)store.act('alice','/offer',{name:'小满'});for(let i=0;i<27;i++)store.act('bob','/offer',{name:'阿福'});
 assert.equal(store.snapshot('alice').totals.incense,67);assert.equal(store.snapshot('bob').totals.incense,67);assert.equal(store.snapshot('alice').ritual.incense,40);assert.equal(store.snapshot('bob').ritual.incense,27);assert.equal(store.snapshot('bob').feed.length,0);
 for(let i=0;i<27;i++)store.act('alice','/offer');assert.equal(store.snapshot('bob').feed.length,0);store.act('alice','/blessing-recipient',{awardId:store.snapshot('alice').lastAward.id,name:'小满'});assert.equal(store.snapshot('bob').feed[0].name,'小满');assert.equal(store.snapshot('bob').totals.blessings,1);assert.equal(store.snapshot('bob').lastAward,null);
 assert.equal(createReviewStore(store.root).snapshot('alice').totals.incense,94);
});
test('earned names and type are persisted, later chance can miss or award',()=>{
 let roll=.5;const store=make(()=>roll);for(let i=0;i<67;i++)store.act('alice','/offer',{name:'春日'});
 const pending=store.snapshot('alice').lastAward;assert.equal(pending.name,'');const first=store.act('alice','/blessing-recipient',{awardId:pending.id,name:'春日'}).award;assert.equal(first.name,'春日');
 roll=.9;assert.equal(store.act('alice','/offer',{name:'云朵'}).award,null);assert.equal(store.snapshot('alice').lastAward.name,'春日');
 roll=0;const drawn=store.act('alice','/offer').award;const next=store.act('alice','/blessing-recipient',{awardId:drawn.id,name:'云朵'}).award;assert.equal(next.name,'云朵');assert.notEqual(next.blessingId,first.blessingId);assert.equal(store.snapshot('bob').feed.length,2);
});
test('multiple photos, append to both uploaded and demo cats, image-only comments',()=>{
 const store=make();const cat=store.act('alice','/cats',{name:'小饼',intro:'爱晒太阳',images:[image,image]}).cat;
 assert.equal(cat.images.length,2);const updated=store.act('bob','/photos',{catId:cat.id,images:[image]}).cat;assert.equal(updated.images.length,3);
 const demo=store.cats().cats.find(c=>c.demo);store.act('bob','/photos',{catId:demo.id,images:[image]});assert.equal(store.cats().cats.filter(c=>c.id===demo.id).length,1);assert.equal(store.cats().cats.find(c=>c.id===demo.id).images.length,2);
 const comment=store.act('bob','/comments',{catId:cat.id,nickname:'小院朋友',body:'',images:[image,image]}).comment;assert.equal(comment.images.length,2);assert.equal(store.comments(cat.id).comments.length,1);
 assert.throws(()=>store.act('bob','/comments',{catId:cat.id,nickname:'喵',body:'',images:[]}));
 assert.throws(()=>store.act('bob','/photos',{catId:cat.id,images:['data:image/png;base64,aGVsbG8=']}));
 assert.throws(()=>store.act('bob','/cats',{name:'坏图',intro:'x',images:Array(10).fill(image)}));
});
test('likes accumulate globally, local progress migration only runs once',()=>{
 const store=make();const cat=store.cats().cats[0];for(let i=0;i<1000;i++)store.act(i%2?'alice':'bob','/like',{catId:cat.id});assert.equal(store.snapshot('bob').likes[cat.id],1000);
 store.act('old','/import',{ritual:{incense:90,blessings:2,lastBlessingId:'joy'},likes:{[cat.id]:3}});store.act('old','/import',{ritual:{incense:90,blessings:2,lastBlessingId:'joy'},likes:{[cat.id]:3}});
 assert.equal(store.snapshot('bob').totals.incense,90);assert.equal(store.snapshot('bob').likes[cat.id],1003);
});

test('only the visitor who earned a blessing can choose a recipient, once, without redrawing',()=>{
 const store=make();for(let i=0;i<67;i++)store.act('alice','/offer');const pending=store.snapshot('alice').lastAward;
 assert.equal(pending.recipientSet,false);assert.equal(store.snapshot('bob').feed.length,0);
 assert.throws(()=>store.act('bob','/blessing-recipient',{awardId:pending.id,name:'他人'}));
 assert.throws(()=>store.act('alice','/blessing-recipient',{awardId:pending.id,catId:'missing'}));
 const cat=store.cats().cats[0];const chosen=store.act('alice','/blessing-recipient',{awardId:pending.id,catId:cat.id,name:'覆盖名字'}).award;
 assert.equal(chosen.name,cat.name);assert.equal(chosen.catId,cat.id);assert.equal(chosen.blessingId,pending.blessingId);
 store.act('alice','/blessing-recipient',{awardId:pending.id,name:'另一个人'});
 assert.equal(store.snapshot('bob').feed.length,1);assert.equal(store.snapshot('bob').feed[0].name,cat.name);assert.equal(store.snapshot('bob').totals.blessings,1);assert.equal(store.snapshot('alice').ritual.incense,67);
});
test('blank recipient can be accepted and pending blessings survive a server restart',()=>{
 const store=make();for(let i=0;i<67;i++)store.act('alice','/offer');const award=store.snapshot('alice').lastAward;
 const restored=createReviewStore(store.root);assert.equal(restored.snapshot('alice').lastAward.recipientSet,false);
 restored.act('alice','/blessing-recipient',{awardId:award.id,name:'   '});
 assert.equal(restored.snapshot('bob').feed[0].name,'一位小院朋友');assert.equal(restored.snapshot('alice').lastAward.recipientSet,true);
 assert.equal(restored.snapshot('bob').totals.blessings,1);
});

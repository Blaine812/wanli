import test from 'node:test';
import assert from 'node:assert/strict';
import {offerIncense,normalizeProgress,normalizeLikes,addCatLike,BLESSINGS} from '../src/ritual.ts';
const samples=(...values)=>()=>{assert.ok(values.length,'Unexpected random draw');return values.shift();};
test('the first blessing stays hidden until the required offering',()=>{
 let progress=normalizeProgress(null);
 for(let i=1;i<67;i++){
  const result=offerIncense(progress,()=>{throw new Error('No chance draw before the hidden threshold');});
  progress=result.progress;assert.equal(progress.incense,i);assert.equal(result.newBlessing,null);
 }
 const result=offerIncense(progress,()=>.4);assert.equal(result.progress.incense,67);assert.equal(result.progress.blessings,1);assert.ok(result.newBlessing);
});
test('later offerings can either miss or award another random blessing',()=>{
 const start={incense:67,blessings:1,lastBlessingId:'peace'};
 const missed=offerIncense(start,samples(.9));assert.equal(missed.newBlessing,null);assert.equal(missed.progress.blessings,1);
 const won=offerIncense(missed.progress,samples(.01,.6));assert.ok(won.newBlessing);assert.equal(won.progress.blessings,2);assert.notEqual(won.newBlessing.id,'peace');
});
test('all blessing types can be drawn and consecutive rewards vary',()=>{
 const seen=new Set();for(let i=0;i<BLESSINGS.length;i++)seen.add(offerIncense({incense:66,blessings:0,lastBlessingId:null},()=>i/BLESSINGS.length).newBlessing.id);
 assert.equal(seen.size,BLESSINGS.length);
 const again=offerIncense({incense:90,blessings:2,lastBlessingId:'peace'},samples(0,0));assert.notEqual(again.newBlessing.id,'peace');
});
test('saved progress preserves the actual reward count without inventing rewards',()=>{
 const saved=normalizeProgress(JSON.parse(JSON.stringify({incense:100,blessings:4,lastBlessingId:'joy'})));
 assert.equal(saved.blessings,4);assert.equal(saved.lastBlessingId,'joy');
 assert.equal(offerIncense(saved,()=>.9).progress.blessings,4);
 assert.equal(normalizeProgress({incense:67}).blessings,0);
 for(const incense of [-1,NaN,Infinity,3.5,'66'])assert.equal(normalizeProgress({incense,blessings:4}).incense,0);
});
test('one visitor can keep adding likes without toggling or changing another cat',()=>{
 const original={milk:2};let likes=original;for(let i=0;i<1000;i++)likes=addCatLike(likes,'cloud');
 assert.equal(likes.cloud,1000);assert.equal(likes.milk,2);assert.deepEqual(original,{milk:2});
});
test('older preview likes migrate to counts and invalid counts are discarded',()=>{
 assert.deepEqual(normalizeLikes({milk:true,cloud:false,cookie:42,bad:-1,text:'5'}),{milk:1,cloud:0,cookie:42,bad:0,text:0});
 assert.deepEqual(normalizeLikes(null),{});
});

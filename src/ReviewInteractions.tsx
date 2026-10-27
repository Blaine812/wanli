import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {Heart,PawPrint,Sparkles,ArrowUpRight,X,Gift,ShieldCheck,Coins,BookOpen,Leaf,Sun} from 'lucide-react';
import {asset} from './config';
import {createPortal} from 'react-dom';
import {normalizeProgress,getBlessing,type Blessing} from './ritual';
import {reviewRequest,type SharedState,type Award} from './preview-data';
import {localPreview} from './local-preview';
import type {Cat} from './cats';
import {listCatOptions} from './api';
const emptyState:SharedState={version:-1,likes:{},totals:{incense:0,blessings:0},ritual:normalizeProgress(null),lastAward:null,feed:[]};
export function useReviewInteractions(){
 const [state,setState]=useState(emptyState),[storageError,setStorageError]=useState('');
 const current=useRef(state),ready=useRef<Promise<void>|null>(null),queue=useRef<Promise<unknown>>(Promise.resolve());
 function apply(next:SharedState){if(next.version>=current.current.version){current.current=next;setState(next);}setStorageError('');}
 function initialize(){if(!ready.current)ready.current=(async()=>{const next=await reviewRequest<SharedState>('/state');if(!localPreview){apply(next);return;}let old={};try{old=JSON.parse(localStorage.getItem('miaomiao.review.interactions.v1')||'{}');}catch{}apply(await reviewRequest<SharedState>('/import',old));})().catch(error=>{ready.current=null;throw error;});return ready.current;}
 useEffect(()=>{let active=true;initialize().catch(error=>{ready.current=null;if(active)setStorageError(error.message);});
 const timer=setInterval(()=>{if(!document.hidden)initialize().then(()=>reviewRequest<SharedState>('/state')).then(next=>{if(active)apply(next);}).catch(error=>{if(active)setStorageError(error.message);});},3000);
 return()=>{active=false;clearInterval(timer);};},[]);
 function action(path:string,data:unknown){const pending=queue.current.catch(()=>{}).then(()=>initialize()).then(()=>reviewRequest<SharedState&{award?:Award|null}>(path,data)).then(next=>{apply(next);return next;}).catch(error=>{setStorageError(error.message);throw error;});queue.current=pending;return pending;}
 return {...state,storageError,
  addLike:(catId:string)=>{void action('/like',{catId}).catch(()=>{});},
  offer:async()=>{try{return (await action('/offer',{})).award||null;}catch{return null;}},
  assignRecipient:async(awardId:string,recipient:{name?:string;catId?:string})=>(await action('/blessing-recipient',{awardId,...recipient})).award as Award,
 };
}
export function blessingLine(award:Award){
 const name='「'+award.name+'」';
 const lines={peace:name+' 的每一程，都有平安轻轻同行。',fortune:'一袋小鱼干般的好收获，正奔向 '+name+'。',study:name+' 认真翻过的书页，终会亮成星光。',career:'愿好机会看见 '+name+'，让每份努力有回响。',joy:'猫猫神把今日的快乐，悄悄放进 '+name+' 的口袋。',friendship:'给 '+name+' 留一盏暖灯，愿温柔的人如约而至。'};
 return lines[award.blessingId];
}
export function DeityForm({id,className=''}:{id:Blessing['id'];className?:string}){return <img src={asset('/deities/'+id+'.png')} alt={getBlessing(id)?.title+'形态的猫猫神'} className={className}/>;}
export function LikeButton({name,count,onClick}:{name:string;count:number;onClick:()=>void}){
 const [pulse,setPulse]=useState(0);
 return <button type="button" className={`like-button ${count?'is-liked':''}`} onClick={()=>{setPulse(value=>value+1);onClick();}} aria-label={`给${name}点赞，累计${count}次`}><Heart key={pulse} size={16} fill={count?'currentColor':'none'}/><span>点赞</span><b>{count.toLocaleString('zh-CN')}</b>{pulse>0&&<span className="like-increment" key={`like-${pulse}`} aria-hidden="true">+1</span>}</button>;
}
const blessingIcons={shield:ShieldCheck,coins:Coins,book:BookOpen,leaf:Leaf,sun:Sun,heart:Heart};
export function CatShrine({state,cats,onOffer,onAssignRecipient}:{state:SharedState;cats:Cat[];onOffer:()=>Promise<Award|null>;onAssignRecipient:(awardId:string,recipient:{name?:string;catId?:string})=>Promise<Award>}){
 const [catOptions,setCatOptions]=useState<Pick<Cat,'id'|'name'|'breed'>[]>(cats);
 const [name,setName]=useState(''),[catId,setCatId]=useState(''),[recipientBusy,setRecipientBusy]=useState(false),[recipientError,setRecipientError]=useState(''),[offering,setOffering]=useState(false),[activeAward,setActiveAward]=useState<Award|null>(null),[feedIndex,setFeedIndex]=useState(0);
 useEffect(()=>{const timer=setInterval(()=>setFeedIndex(index=>index+1),4500);return()=>clearInterval(timer);},[]);
 const [puff,setPuff]=useState(0),[blessingOpen,setBlessingOpen]=useState(false),[activeBlessing,setActiveBlessing]=useState<Blessing|null>(null);
 useEffect(()=>{if(!blessingOpen)return;let active=true;listCatOptions().then(options=>{if(active)setCatOptions(options);}).catch(()=>{});return()=>{active=false;};},[blessingOpen]);
 const blessingDialog=useRef<HTMLDialogElement>(null),offerInFlight=useRef(false),finishInFlight=useRef(false);
 const lastBlessing=getBlessing(state.lastAward?.blessingId);
 const feedEntry=state.feed.length?state.feed[feedIndex%state.feed.length]:null;
 useEffect(()=>{
  if(!blessingOpen){blessingDialog.current?.close();return;}
  const previous=document.body.style.overflow;document.body.style.overflow='hidden';
  if(blessingDialog.current?.isConnected&&!blessingDialog.current.open)blessingDialog.current.showModal();
  return()=>{document.body.style.overflow=previous;};
 },[blessingOpen]);
 async function offer(){if(offerInFlight.current||blessingOpen)return;offerInFlight.current=true;setOffering(true);setPuff(value=>value+1);try{const award=await onOffer();if(award){setName('');setCatId('');setRecipientError('');setActiveAward(award);setActiveBlessing(getBlessing(award.blessingId));setBlessingOpen(true);}}finally{offerInFlight.current=false;setOffering(false);}}
 async function finish(skip=false){if(finishInFlight.current)return;if(activeAward?.recipientSet!==false){setBlessingOpen(false);return;}finishInFlight.current=true;setRecipientBusy(true);setRecipientError('');try{const award=await onAssignRecipient(activeAward.id,skip?{}:catId?{catId}:{name});setActiveAward(award);setBlessingOpen(false);}catch(error){setRecipientError(error instanceof Error?error.message:'祝福暂时没有送出，请重试');}finally{finishInFlight.current=false;setRecipientBusy(false);}}
 function revisit(){if(lastBlessing){setName('');setCatId('');setRecipientError('');setActiveAward(state.lastAward);setActiveBlessing(lastBlessing);setBlessingOpen(true);}}
 const BlessingIcon=activeBlessing?blessingIcons[activeBlessing.icon]:Sparkles;
 return <section id="cat-god" className="shrine section-wrap" aria-labelledby="cat-god-title">
  <div className="shrine-card">
   <div className="shrine-heading"><span className="section-kicker"><Sparkles size={12}/> A LITTLE RITUAL, A LOT OF LUCK</span><h1 id="cat-god-title">喵喵神在此，<span>好运慢慢来</span><i>✦</i></h1><p>把小小的心愿，轻轻交给猫猫神。</p></div>
   <div className="shrine-scene">
    <span className="shrine-orbit orbit-one"/><span className="shrine-orbit orbit-two"/>
    <span className="shrine-scene-star star-one">✦</span><span className="shrine-scene-star star-two">✧</span><span className="shrine-scene-star star-three">✦</span>
    <img className="cat-god-image" src={asset('/cat-god.png')} alt="戴着金色小皇冠、坐在云朵上微笑赐福的软萌喵喵神"/>
    <span className="shrine-cloud cloud-left"/><span className="shrine-cloud cloud-right"/>
   </div>
   <div className="shrine-ritual">
    <button type="button" className={`incense-altar ${puff?'is-lit':''}`} onClick={offer} disabled={offering} aria-label="给猫猫神上香" title="点香台，上一炷香">
     <span className="incense-smoke" key={puff} aria-hidden="true"><i/><i/><i/></span>
     <span className="incense-sticks" aria-hidden="true"><i/><i/><i/></span><span className="incense-bowl" aria-hidden="true"><PawPrint size={28}/></span><span className="altar-shadow" aria-hidden="true"/>
    </button>
    {puff>0&&<span key={`offering-${puff}`} className="offering-float" aria-hidden="true">心意 +1 <Heart size={13} fill="currentColor"/></span>}
   </div>
   <p className="altar-hint"><span/> 点击香台，送上一炷香 <span/></p>
   <div className="ritual-stats" aria-live="polite" aria-atomic="true"><span>大家已送出 <strong>{state.totals.incense.toLocaleString('zh-CN')}</strong> 份心意</span><i/><span>共收获 <strong>{state.totals.blessings.toLocaleString('zh-CN')}</strong> 份保佑</span></div>
   {lastBlessing&&<button className={`blessing-revisit tone-${lastBlessing.tone}`} onClick={revisit}><Gift size={14}/> 猫猫神送来了「{lastBlessing.title}」<ArrowUpRight size={13}/></button>}
   <p className="shrine-whisper">愿每一份小心意，都有温柔的回应。</p>

  </div>
   {createPortal(<aside className="blessing-feed" aria-label="小院祝福笺"><span><Sparkles size={13}/> 小院祝福笺 <b>{state.feed.length} 份温柔</b></span>{feedEntry?<p key={feedEntry.id} className="blessing-feed-line">{blessingLine(feedEntry)}</p>:<p>第一份被珍藏的祝福，正在来的路上。</p>}<span className="feed-dots" aria-hidden="true">•••</span></aside>,document.body)}
  <dialog ref={blessingDialog} className={`blessing-modal tone-${activeBlessing?.tone||'gold'}`} onCancel={event=>{event.preventDefault();void finish(true);}} aria-labelledby="blessing-title">
   <button type="button" className="close-button" onClick={()=>void finish(true)} disabled={recipientBusy} aria-label="关闭保佑特效"><X size={20}/></button>
   <div className="blessing-confetti" aria-hidden="true">{Array.from({length:18},(_,i)=><span key={i} style={{'--x':`${4+i*5.3}%`,'--delay':`${(i%5)*.13}s`,'--drift':`${(i%2?1:-1)*(20+i*3)}px`,'--rotate':`${i*29}deg`} as CSSProperties}>{i%3===0?<PawPrint size={19}/>:i%2?'✦':'♡'}</span>)}</div>
   <div className="blessing-halo"/>{activeBlessing&&<DeityForm id={activeBlessing.id} className="blessing-cat"/>}
   <span className="blessing-eyebrow">你的心意，猫猫神收到啦</span><h2 id="blessing-title">{activeBlessing?.title}<span>✦</span></h2><span className="blessing-subtitle">{activeAward&&activeAward.recipientSet!==false?`这一份温柔，送给「${activeAward.name}」`:"猫猫神悄悄送你一份保佑"}</span>
   <p>{activeBlessing?.wish}</p>
   <div className="blessing-ticket"><BlessingIcon size={25}/><div><b>喵喵神的专属保佑</b><span>{activeBlessing?.caption}</span></div><strong>好运</strong></div>
   {activeAward?.recipientSet===false?<form className="blessing-recipient" onSubmit={event=>{event.preventDefault();void finish();}}>
    <h3>这份祝福，想送给谁？</h3><p>选一只小院里的小猫，或写下你惦记的名字。</p>
    <label>送给小猫<select aria-label="选择小院里的小猫" value={catId} disabled={recipientBusy} onChange={event=>{setCatId(event.target.value);setName('');}}><option value="">暂不选择小猫</option>{catOptions.map(cat=><option key={cat.id} value={cat.id}>{cat.name} · {cat.breed}</option>)}</select></label>
    <span className="recipient-or">或者</span><label>自己填写<input aria-label="被保佑人的名字或昵称" maxLength={24} value={name} disabled={recipientBusy} onChange={event=>{setName(event.target.value);setCatId('');}} placeholder="名字或昵称，也可以留空"/></label>
    <small>送出的祝福会出现在屏幕右下角，可用昵称。</small>
    {recipientError&&<p className="error" role="alert">{recipientError}</p>}
    <button className="blessing-accept" disabled={recipientBusy}><Sparkles size={17}/> {recipientBusy?'正在送出…':catId||name.trim()?'送出这份祝福':'直接收下这份喵运'}</button>
    <button type="button" className="recipient-skip" disabled={recipientBusy} onClick={()=>void finish(true)}>暂不填写，直接收下</button>
   </form>:<button className="blessing-accept" onClick={()=>setBlessingOpen(false)} autoFocus><Sparkles size={17}/> 收下这份喵运</button>}<small className="blessing-note">愿你今天，刚好遇见一点小幸运。</small>
  </dialog>
 </section>;
}

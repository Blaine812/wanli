// Internal rules only: never show the trigger threshold or chance in the UI.
const BLESSING_CHANCE=.2;
const MAX_WAIT=10;
export const BLESSINGS=[
 {id:'peace',title:'平安顺遂',wish:'愿你走过的每一段路，\n都有温柔与平安相伴。',caption:'平安常伴 · 万事顺心',tone:'sage',icon:'shield'},
 {id:'fortune',title:'财运喵喵',wish:'愿你的小鱼干满满当当，\n努力的每一天，都有好收获。',caption:'小鱼干满仓 · 好收获常来',tone:'gold',icon:'coins'},
 {id:'study',title:'学业进步',wish:'愿你认真读过的每一页，\n都在需要的时候闪闪发光。',caption:'灵感上线 · 所学皆有所得',tone:'blue',icon:'book'},
 {id:'career',title:'事业顺风',wish:'愿你的认真被看见，\n手里的事情，都慢慢变顺利。',caption:'努力有回应 · 好机会靠近',tone:'clay',icon:'leaf'},
 {id:'joy',title:'开心常驻',wish:'愿你今天的烦恼轻一点，\n快乐像小猫一样，悄悄黏上你。',caption:'烦恼退散 · 快乐加倍',tone:'peach',icon:'sun'},
 {id:'friendship',title:'好缘相伴',wish:'愿你遇见温柔的人，\n也被这个世界，好好地喜欢。',caption:'温柔相遇 · 陪伴常在',tone:'rose',icon:'heart'},
] as const;
export type Blessing=(typeof BLESSINGS)[number];
export type RitualProgress={incense:number;blessings:number;lastBlessingId:Blessing['id']|null;sinceBlessing?:number};
const validCount=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:0;
export function getBlessing(id:unknown):Blessing|null{return BLESSINGS.find(blessing=>blessing.id===id)||null;}
export function normalizeProgress(value:unknown):RitualProgress{
 const data=value&&typeof value==='object'?value as Record<string,unknown>:{};
 const incense=validCount(data.incense);
 const blessings=Math.min(validCount(data.blessings),incense);
 const last=blessings?(getBlessing(data.lastBlessingId)||BLESSINGS[0]):null;
 return {incense,blessings,lastBlessingId:last?.id||null,sinceBlessing:Math.min(MAX_WAIT-1,validCount(data.sinceBlessing))};
}
export function offerIncense(progress:RitualProgress,random:()=>number=Math.random){
 const before=normalizeProgress(progress);
 const incense=Math.min(Number.MAX_SAFE_INTEGER,before.incense+1);
 const sinceBlessing=(before.sinceBlessing||0)+1;
 const awarded=sinceBlessing>=MAX_WAIT||random()<BLESSING_CHANCE;
 let newBlessing:Blessing|null=null;
 if(awarded){
  const choices=BLESSINGS.filter(blessing=>blessing.id!==before.lastBlessingId);
  const index=Math.min(choices.length-1,Math.max(0,Math.floor(random()*choices.length)));
  newBlessing=choices[index];
 }
 return {progress:{incense,blessings:before.blessings+(newBlessing?1:0),lastBlessingId:newBlessing?.id||before.lastBlessingId,sinceBlessing:newBlessing?0:sinceBlessing},newBlessing};
}
export function normalizeLikes(value:unknown):Record<string,number>{
 if(!value||typeof value!=='object'||Array.isArray(value))return {};
 return Object.fromEntries(Object.entries(value).filter(([id])=>id.length<=80).map(([id,count])=>[id,count===true?1:validCount(count)]));
}
export function addCatLike(likes:Record<string,number>,catId:string){
 return {...likes,[catId]:Math.min(Number.MAX_SAFE_INTEGER,validCount(likes[catId])+1)};
}

import {request} from './transport';
import {localPreview} from './local-preview';
import type {Cat,Comment} from './cats';
import type {Blessing,RitualProgress} from './ritual';
export type Award={id:string;blessingId:Blessing['id'];name:string;createdAt:number;recipientSet?:boolean;catId?:string|null};
export type SharedState={version:number;likes:Record<string,number>;totals:{incense:number;blessings:number};ritual:RitualProgress;lastAward:Award|null;feed:Award[]};
export async function reviewRequest<T>(path:string,data?:unknown):Promise<T>{
 if(!localPreview){const action=path==='/import'?'/state':path;return request<T>(action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(path==='/import'?{}:data||{})});}
 let response:Response;try{response=await fetch('/__review'+path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}catch{throw new Error('本地小院暂时没有连接上，请稍后重试。');}
 const result=await response.json();if(!response.ok)throw new Error(result.error||'提交失败，请重试');return result;
}
export const filesToImages=(files:File[])=>Promise.all(files.map(file=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('照片读取失败，请重试'));reader.readAsDataURL(file);})));
export const previewCats=()=>reviewRequest<{cats:Cat[];total:number;nextOffset:number|null}>('/cats');
export const previewComments=(catId:string)=>reviewRequest<{comments:Comment[]}>('/comments?catId='+encodeURIComponent(catId));
export async function previewComment(value:{catId:string;nickname:FormDataEntryValue|null;body:FormDataEntryValue|null;photos?:File[]}){return reviewRequest<{comment:Comment}>('/comments',{...value,photos:undefined,images:await filesToImages(value.photos||[])});}
export async function previewUpload(form:FormData){const photos=form.getAll('photos').filter((value):value is File=>value instanceof File);return reviewRequest<{cat:Cat}>('/cats',{name:form.get('name'),breed:form.get('breed'),intro:form.get('intro'),images:await filesToImages(photos.length?photos:[form.get('photo') as File])});}
export const appendCatPhotos=async(catId:string,photos:File[])=>localPreview?reviewRequest<{cat:Cat}>('/photos',{catId,images:await filesToImages(photos)}):publishMedia('append',{catId},photos) as Promise<{cat:Cat}>;

export async function publishMedia(kind:'cat'|'append'|'comment',payload:Record<string,string>,files:File[]){
 if(!files.length||files.length>9)throw new Error('每次请选择1至9张照片');
 const json=(value:unknown)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
 const batch=await request<{id:string}>('/media-start',json({kind,payload,files:files.map(file=>({bytes:file.size,mime:file.type}))}));
 try{for(let index=0;index<files.length;index++){const form=new FormData();form.set('photo',files[index]);await request('/media-file?batchId='+batch.id+'&index='+index,{method:'POST',body:form});}}
 catch(error){await request('/media-cancel',json({batchId:batch.id})).catch(()=>{});throw error;}
 // Once commit starts, do not cancel or remove uploads on an uncertain response.
 return request<{cat?:Cat;comment?:Comment}>('/media-finish',json({batchId:batch.id}));
}

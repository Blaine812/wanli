import type {Cat,Comment} from './cats';
import {asset} from './config';
import {localPreview} from './local-preview';
import {previewCats,previewComments,previewComment,previewUpload,publishMedia} from './preview-data';
import {request} from './transport';
const catAssets=(cat:Cat)=>({...cat,image:cat.image.startsWith('/cats/')?asset(cat.image):cat.image,images:cat.images?.map(src=>src.startsWith('/cats/')?asset(src):src)});
export async function listCats(offset=0){if(localPreview)return previewCats();const result=await request<{cats:Cat[];total:number;nextOffset:number|null}>('/cats?offset='+offset);return {...result,cats:result.cats.map(catAssets)};}
export const listComments=(catId:string)=>localPreview?previewComments(catId):request<{comments:Comment[]}>('/comments?catId='+encodeURIComponent(catId));
export async function uploadCat(form:FormData){if(localPreview)return previewUpload(form);const photos=form.getAll('photos').filter((value):value is File=>value instanceof File);if(!photos.length&&form.get('photo') instanceof File)photos.push(form.get('photo') as File);return publishMedia('cat',{name:String(form.get('name')||'').trim(),intro:String(form.get('intro')||'').trim(),breed:String(form.get('breed')||'').trim()||'小猫咪'},photos) as Promise<{cat:Cat}>;}
export async function postComment(data:{catId:string;nickname:FormDataEntryValue|null;body:FormDataEntryValue|null;photos?:File[]}){if(localPreview)return previewComment(data);if(data.photos?.length)return publishMedia('comment',{catId:data.catId,nickname:String(data.nickname||'').trim(),body:String(data.body||'').trim()},data.photos) as Promise<{comment:Comment}>;return request<{comment:Comment}>('/comments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}
export async function listCatOptions(){if(localPreview)return (await previewCats()).cats;return (await request<{cats:Pick<Cat,'id'|'name'|'breed'>[]}>('/cat-options')).cats;}

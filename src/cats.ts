import {asset} from "./config";
import demos from "../shared/demo-cats.json";
export type Cat = { id:string; name:string; intro:string; breed:string; image:string; images?:string[]; createdAt:number; demo?:boolean; commentCount?:number };
export type Comment = { id:string; nickname:string; body:string; images?:string[]; createdAt:number };
export const demoCats:Cat[]=demos.map(c=>({...c,image:asset(c.image)}));

create function public.miaomiao_gallery(p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare total bigint; cats jsonb; demo_counts jsonb;
begin
 if p_offset<0 or p_offset>10000000 then raise exception using errcode='22023',message='Invalid page'; end if;
 select count(*) into total from public.miaomiao_cats;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'intro',c.intro,'breed',c.breed,'imagePath',c.image_path,'createdAt',floor(extract(epoch from c.created_at)*1000),'commentCount',(select count(*) from public.miaomiao_comments m where m.cat_id=c.id::text)) order by c.created_at desc,c.id desc),'[]'::jsonb)
 into cats from (select * from public.miaomiao_cats order by created_at desc,id desc limit 60 offset p_offset) c;
 select coalesce(jsonb_object_agg(cat_id,n),'{}'::jsonb) into demo_counts
 from (select cat_id,count(*) n from public.miaomiao_comments where cat_id like 'demo-%' group by cat_id) d;
 return jsonb_build_object('cats',cats,'uploadedTotal',total,'demoCounts',demo_counts,'nextOffset',case when p_offset+jsonb_array_length(cats)<total then p_offset+jsonb_array_length(cats) else null end);
end $$;

create function public.miaomiao_valid_cat(p_id text)
returns boolean language sql stable security definer set search_path='' as $$
 select p_id=any(array['courtyard','demo-milk','demo-orange','demo-sesame','demo-cookie','demo-cloud','demo-pudding']) or exists(select 1 from public.miaomiao_cats where id::text=p_id);
$$;

create function public.miaomiao_comments_get(p_cat_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.miaomiao_valid_cat(p_cat_id) then raise exception using errcode='P0001',message='MIAOMIAO_CAT_NOT_FOUND'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'nickname',nickname,'body',body,'createdAt',floor(extract(epoch from created_at)*1000)) order by created_at desc,id desc),'[]'::jsonb)
 into result from (select * from public.miaomiao_comments where cat_id=p_cat_id order by created_at desc,id desc limit 100) c;
 return jsonb_build_object('comments',result);
end $$;

create function public.miaomiao_comment_create(p_actor uuid,p_ip_hash text,p_cat_id text,p_nickname text,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.miaomiao_comments%rowtype;
begin
 if p_nickname is null or char_length(btrim(p_nickname)) not between 1 and 24 or p_body is null or char_length(btrim(p_body)) not between 1 and 500 then raise exception using errcode='22023',message='Invalid comment'; end if;
 if p_cat_id is null or not public.miaomiao_valid_cat(p_cat_id) then raise exception using errcode='P0001',message='MIAOMIAO_CAT_NOT_FOUND'; end if;
 perform public.miaomiao_rate_limit(p_actor,p_ip_hash,'comment');
 insert into public.miaomiao_comments(owner_id,cat_id,nickname,body) values(p_actor,p_cat_id,btrim(p_nickname),btrim(p_body)) returning * into item;
 return jsonb_build_object('comment',jsonb_build_object('id',item.id,'nickname',item.nickname,'body',item.body,'createdAt',floor(extract(epoch from item.created_at)*1000)));
end $$;

-- Narrow privileges on every application function; leave unrelated project functions untouched.
revoke all on function public.miaomiao_rate_limit(uuid,text,text),public.miaomiao_reserve_upload(uuid,text,text,text,text,bigint,text),public.miaomiao_finish_upload(uuid,uuid),public.miaomiao_cancel_upload(uuid,uuid),public.miaomiao_gallery(integer),public.miaomiao_valid_cat(text),public.miaomiao_comments_get(text),public.miaomiao_comment_create(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.miaomiao_reserve_upload(uuid,text,text,text,text,bigint,text),public.miaomiao_finish_upload(uuid,uuid),public.miaomiao_cancel_upload(uuid,uuid),public.miaomiao_gallery(integer),public.miaomiao_comments_get(text),public.miaomiao_comment_create(uuid,text,text,text,text) to service_role;
notify pgrst,'reload schema';

-- Additive release: existing cats, comments and image objects are retained.
create table public.miaomiao_totals(singleton boolean primary key default true check(singleton), version bigint not null default 0, incense bigint not null default 0, blessings bigint not null default 0);
insert into public.miaomiao_totals(singleton) values(true);
create table public.miaomiao_likes(cat_id text primary key, likes bigint not null default 0 check(likes between 0 and 9007199254740991));
create table public.miaomiao_visitors(owner_id uuid primary key, incense bigint not null default 0, blessings bigint not null default 0, last_blessing_id text, last_award_id uuid);
create table public.miaomiao_blessings(id uuid primary key default gen_random_uuid(), owner_id uuid not null, blessing_id text not null check(blessing_id in ('peace','fortune','study','career','joy','friendship')), name text not null default '' check(char_length(name)<=24), cat_id text, recipient_set boolean not null default false, created_at timestamptz not null default now());
create index miaomiao_blessings_owner_time on public.miaomiao_blessings(owner_id,created_at desc);
create index miaomiao_blessings_feed on public.miaomiao_blessings(created_at desc,id desc) where recipient_set;
create table public.miaomiao_cat_photos(id uuid primary key default gen_random_uuid(),owner_id uuid not null,cat_id text not null,image_path text not null unique,image_bytes bigint not null check(image_bytes between 1 and 8388608),created_at timestamptz not null default now());
create index miaomiao_cat_photos_cat_time on public.miaomiao_cat_photos(cat_id,created_at,id);
alter table public.miaomiao_comments add column image_paths text[] not null default '{}';
alter table public.miaomiao_comments drop constraint miaomiao_comments_body_check;
alter table public.miaomiao_comments add constraint miaomiao_comments_content_check check(char_length(btrim(body))<=500 and (char_length(btrim(body))>0 or cardinality(image_paths)>0) and cardinality(image_paths)<=9);
create table public.miaomiao_media_batches(id uuid primary key default gen_random_uuid(),owner_id uuid not null,kind text not null check(kind in ('cat','append','comment')),payload jsonb not null,files jsonb not null,status text not null default 'active' check(status in ('active','complete','cancelled')),result jsonb,expires_at timestamptz not null default(now()+interval '30 minutes'));
create index miaomiao_media_batches_expiry on public.miaomiao_media_batches(expires_at) where status='active';
alter table public.miaomiao_totals enable row level security;
alter table public.miaomiao_likes enable row level security;
alter table public.miaomiao_visitors enable row level security;
alter table public.miaomiao_blessings enable row level security;
alter table public.miaomiao_cat_photos enable row level security;
alter table public.miaomiao_media_batches enable row level security;
revoke all on public.miaomiao_totals,public.miaomiao_likes,public.miaomiao_visitors,public.miaomiao_blessings,public.miaomiao_cat_photos,public.miaomiao_media_batches from public,anon,authenticated;
grant select,insert,update,delete on public.miaomiao_totals,public.miaomiao_likes,public.miaomiao_visitors,public.miaomiao_blessings,public.miaomiao_cat_photos,public.miaomiao_media_batches to service_role;

create function public.miaomiao_award_json(p_award public.miaomiao_blessings) returns jsonb language sql stable security invoker set search_path='' as $$
 select case when p_award.id is null then null else jsonb_build_object('id',p_award.id,'blessingId',p_award.blessing_id,'name',p_award.name,'catId',p_award.cat_id,'recipientSet',p_award.recipient_set,'createdAt',floor(extract(epoch from p_award.created_at)*1000)) end;
$$;
create function public.miaomiao_community_state(p_actor uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('version',t.version,'totals',jsonb_build_object('incense',t.incense,'blessings',t.blessings),
 'likes',coalesce((select jsonb_object_agg(cat_id,likes) from public.miaomiao_likes),'{}'::jsonb),
 'ritual',coalesce((select jsonb_build_object('incense',incense,'blessings',blessings,'lastBlessingId',last_blessing_id) from public.miaomiao_visitors where owner_id=p_actor),'{"incense":0,"blessings":0,"lastBlessingId":null}'::jsonb),
 'lastAward',(select public.miaomiao_award_json(b) from public.miaomiao_blessings b join public.miaomiao_visitors v on v.last_award_id=b.id where v.owner_id=p_actor),
 'feed',coalesce((select jsonb_agg(public.miaomiao_award_json(b) order by b.created_at desc,b.id desc) from public.miaomiao_blessings b where recipient_set),'[]'::jsonb)) from public.miaomiao_totals t where singleton;
$$;
create function public.miaomiao_community_action(p_actor uuid,p_action text,p_value jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare v public.miaomiao_visitors%rowtype; a public.miaomiao_blessings%rowtype; cat text; recipient text; choices text[]; awarded boolean:=false;
begin
 if p_actor is null then raise exception using errcode='22023',message='Invalid visitor'; end if;
 if p_action='state' then return public.miaomiao_community_state(p_actor); end if;
 -- All mutating interaction paths take the same lock first. Counts cannot lose increments.
 perform 1 from public.miaomiao_totals where singleton for update;
 if p_action='like' then
  cat:=p_value->>'catId';if cat is null or cat='courtyard' or not public.miaomiao_valid_cat(cat) then raise exception 'MIAOMIAO_CAT_NOT_FOUND'; end if;
  insert into public.miaomiao_likes(cat_id,likes) values(cat,1) on conflict(cat_id) do update set likes=least(9007199254740991,public.miaomiao_likes.likes+1);
 elsif p_action='offer' then
  insert into public.miaomiao_visitors(owner_id) values(p_actor) on conflict do nothing;
  select * into v from public.miaomiao_visitors where owner_id=p_actor for update;
  v.incense:=v.incense+1;
  awarded:=(v.incense>=67 and v.blessings=0) or (v.incense>67 and random()<0.12);
  if awarded then
   select array_agg(x) into choices from unnest(array['peace','fortune','study','career','joy','friendship']) x where x is distinct from v.last_blessing_id;
   v.last_blessing_id:=choices[1+floor(random()*cardinality(choices))::integer];
   insert into public.miaomiao_blessings(owner_id,blessing_id) values(p_actor,v.last_blessing_id) returning * into a;
   v.blessings:=v.blessings+1;v.last_award_id:=a.id;
  end if;
  update public.miaomiao_visitors set incense=v.incense,blessings=v.blessings,last_blessing_id=v.last_blessing_id,last_award_id=v.last_award_id where owner_id=p_actor;
  update public.miaomiao_totals set incense=incense+1,blessings=blessings+case when awarded then 1 else 0 end where singleton;
 elsif p_action='blessing-recipient' then
  select * into a from public.miaomiao_blessings where id=(p_value->>'awardId')::uuid and owner_id=p_actor for update;
  if not found then raise exception using errcode='22023',message='Blessing not owned'; end if;
  if a.recipient_set then return public.miaomiao_community_state(p_actor)||jsonb_build_object('award',public.miaomiao_award_json(a)); end if;
  cat:=nullif(p_value->>'catId','');
  if cat is not null then
   if cat='courtyard' or not public.miaomiao_valid_cat(cat) then raise exception 'MIAOMIAO_CAT_NOT_FOUND'; end if;
   select name into recipient from public.miaomiao_cats where id::text=cat;
   if recipient is null then recipient:=case cat when 'demo-milk' then '奶盖' when 'demo-orange' then '橘子' when 'demo-sesame' then '芝麻' when 'demo-cookie' then '曲奇' when 'demo-cloud' then '云朵' when 'demo-pudding' then '布丁' end;end if;
  else recipient:=coalesce(nullif(btrim(p_value->>'name'),''),'一位小院朋友');end if;
  if recipient is null or char_length(recipient)>24 then raise exception using errcode='22023',message='Invalid name'; end if;
  update public.miaomiao_blessings set name=recipient,cat_id=cat,recipient_set=true where id=a.id returning * into a;
 else raise exception using errcode='22023',message='Invalid action';end if;
 update public.miaomiao_totals set version=version+1 where singleton;
 return public.miaomiao_community_state(p_actor)||jsonb_build_object('award',public.miaomiao_award_json(a));
end $$;

create function public.miaomiao_cat_json(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',c.id,'name',c.name,'intro',c.intro,'breed',c.breed,'imagePath',c.image_path,
 'imagePaths',jsonb_build_array(c.image_path)||coalesce((select jsonb_agg(image_path order by created_at,id) from public.miaomiao_cat_photos where cat_id=c.id::text),'[]'::jsonb),
 'createdAt',floor(extract(epoch from c.created_at)*1000),'commentCount',(select count(*) from public.miaomiao_comments where cat_id=c.id::text)) from public.miaomiao_cats c where id=p_id;
$$;
create or replace function public.miaomiao_gallery(p_offset integer default 0) returns jsonb language plpgsql security invoker set search_path='' as $$
declare total bigint; cats jsonb; demo_counts jsonb; demo_photos jsonb;
begin
 if p_offset<0 or p_offset>10000000 then raise exception using errcode='22023',message='Invalid page';end if;
 select count(*) into total from public.miaomiao_cats;
 select coalesce(jsonb_agg(public.miaomiao_cat_json(c.id) order by c.created_at desc,c.id desc),'[]'::jsonb) into cats from (select id,created_at from public.miaomiao_cats order by created_at desc,id desc limit 60 offset p_offset) c;
 select coalesce(jsonb_object_agg(cat_id,n),'{}'::jsonb) into demo_counts from (select cat_id,count(*) n from public.miaomiao_comments where cat_id like 'demo-%' group by cat_id) d;
 select coalesce(jsonb_object_agg(cat_id,paths),'{}'::jsonb) into demo_photos from(select cat_id,jsonb_agg(image_path order by created_at,id) paths from public.miaomiao_cat_photos where cat_id like 'demo-%' group by cat_id)d;
 return jsonb_build_object('cats',cats,'uploadedTotal',total,'demoCounts',demo_counts,'demoPhotos',demo_photos,'nextOffset',case when p_offset+jsonb_array_length(cats)<total then p_offset+jsonb_array_length(cats) else null end);
end $$;
create or replace function public.miaomiao_comments_get(p_cat_id text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if not public.miaomiao_valid_cat(p_cat_id) then raise exception 'MIAOMIAO_CAT_NOT_FOUND';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'nickname',nickname,'body',body,'imagePaths',image_paths,'createdAt',floor(extract(epoch from created_at)*1000)) order by created_at desc,id desc),'[]'::jsonb) into result from(select * from public.miaomiao_comments where cat_id=p_cat_id order by created_at desc,id desc limit 100)c;
 return jsonb_build_object('comments',result);
end $$;
create function public.miaomiao_cat_options() returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'breed',breed) order by created_at desc,id desc),'[]'::jsonb) from public.miaomiao_cats;
$$;

create function public.miaomiao_media_start(p_actor uuid,p_ip_hash text,p_kind text,p_payload jsonb,p_files jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare batch_id uuid:=gen_random_uuid(); f jsonb; files jsonb:='[]'; i integer:=0; used_bytes bigint; reserved_bytes bigint; incoming bigint:=0; budget bigint;
begin
 if p_actor is null or p_kind is null or p_kind not in ('cat','append','comment') or jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) not between 1 and 9 or jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode='22023',message='Invalid media batch';end if;
 if p_kind='cat' then
  if coalesce(char_length(btrim(p_payload->>'name')),0) not between 1 and 24 or coalesce(char_length(btrim(p_payload->>'intro')),0) not between 1 and 400 or coalesce(char_length(p_payload->>'breed'),0) not between 1 and 24 then raise exception using errcode='22023',message='Invalid cat';end if;
 else
  if not public.miaomiao_valid_cat(p_payload->>'catId') or p_payload->>'catId' is null or p_kind='append' and p_payload->>'catId'='courtyard' then raise exception 'MIAOMIAO_CAT_NOT_FOUND';end if;
  if p_kind='comment' and (coalesce(char_length(btrim(p_payload->>'nickname')),0) not between 1 and 24 or coalesce(char_length(btrim(p_payload->>'body')),0)>500) then raise exception using errcode='22023',message='Invalid comment';end if;
 end if;
 perform public.miaomiao_rate_limit(p_actor,p_ip_hash,case when p_kind='comment' then 'comment' else 'upload' end);
 for f in select value from jsonb_array_elements(p_files) loop
  if (f->>'bytes')::bigint not between 1 and 8388608 or f->>'bytes' is null or f->>'mime' is null or f->>'mime' not in ('image/jpeg','image/png','image/webp') then raise exception using errcode='22023',message='Invalid image';end if;
  incoming:=incoming+(f->>'bytes')::bigint;
  files:=files||jsonb_build_array(jsonb_build_object('imagePath',batch_id::text||'/'||i::text||case f->>'mime' when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.webp' end,'bytes',(f->>'bytes')::bigint,'mime',f->>'mime'));i:=i+1;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('miaomiao_storage_quota',0));
 select max_storage_bytes into budget from public.miaomiao_settings where singleton;
 select coalesce(sum(coalesce((metadata->>'size')::bigint,0)),0) into used_bytes from storage.objects where bucket_id='miaomiao-photos';
 select coalesce(sum(r.image_bytes),0) into reserved_bytes from public.miaomiao_upload_reservations r where expires_at>now() and not exists(select 1 from storage.objects o where o.bucket_id='miaomiao-photos' and o.name=r.image_path);
 select reserved_bytes+coalesce(sum((batchfile.value->>'bytes')::bigint),0) into reserved_bytes from public.miaomiao_media_batches b cross join lateral jsonb_array_elements(b.files) as batchfile(value) where b.status='active' and b.expires_at>now() and not exists(select 1 from storage.objects o where o.bucket_id='miaomiao-photos' and o.name=batchfile.value->>'imagePath');
 if used_bytes+reserved_bytes+incoming>budget then raise exception 'MIAOMIAO_STORAGE_FULL';end if;
 insert into public.miaomiao_media_batches(id,owner_id,kind,payload,files) values(batch_id,p_actor,p_kind,p_payload,files);
 return jsonb_build_object('id',batch_id,'files',files);
end $$;
create function public.miaomiao_media_file(p_actor uuid,p_id uuid,p_index integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.miaomiao_media_batches%rowtype; f jsonb;
begin
 select * into b from public.miaomiao_media_batches where id=p_id and owner_id=p_actor;
 if not found or b.status<>'active' or b.expires_at<now() or p_index is null or p_index<0 or p_index>=jsonb_array_length(b.files) then raise exception using errcode='22023',message='Invalid upload reservation';end if;
 f:=b.files->p_index;
 return f||jsonb_build_object('uploaded',exists(select 1 from storage.objects where bucket_id='miaomiao-photos' and name=f->>'imagePath' and (metadata->>'size')::bigint=(f->>'bytes')::bigint and metadata->>'mimetype'=f->>'mime'));
end $$;
create function public.miaomiao_media_finish(p_actor uuid,p_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.miaomiao_media_batches%rowtype; f jsonb; paths text[]; final_result jsonb; item public.miaomiao_comments%rowtype;cat_id uuid:=gen_random_uuid(); target text;demo_image text;
begin
 select * into b from public.miaomiao_media_batches where id=p_id and owner_id=p_actor for update;
 if not found then raise exception using errcode='22023',message='Upload not found';end if;
 if b.status='complete' then return b.result;end if;
 if b.status<>'active' or b.expires_at<now() then raise exception using errcode='22023',message='Upload expired';end if;
 for f in select value from jsonb_array_elements(b.files) loop
  if not exists(select 1 from storage.objects where bucket_id='miaomiao-photos' and name=f->>'imagePath' and (metadata->>'size')::bigint=(f->>'bytes')::bigint and metadata->>'mimetype'=f->>'mime') then raise exception using errcode='22023',message='Photo missing or incomplete';end if;
 end loop;
 select array_agg(value->>'imagePath' order by ord) into paths from jsonb_array_elements(b.files) with ordinality x(value,ord);
 if b.kind='cat' then
  insert into public.miaomiao_cats(id,owner_id,name,intro,breed,image_path,image_bytes) values(cat_id,p_actor,btrim(b.payload->>'name'),btrim(b.payload->>'intro'),b.payload->>'breed',paths[1],(b.files->0->>'bytes')::bigint);
  insert into public.miaomiao_cat_photos(owner_id,cat_id,image_path,image_bytes,created_at) select p_actor,cat_id::text,value->>'imagePath',(value->>'bytes')::bigint,now()+ord*interval '1 microsecond' from jsonb_array_elements(b.files) with ordinality x(value,ord) where ord>1;
  final_result:=jsonb_build_object('cat',public.miaomiao_cat_json(cat_id));
 elsif b.kind='append' then
  target:=b.payload->>'catId';if not public.miaomiao_valid_cat(target) then raise exception 'MIAOMIAO_CAT_NOT_FOUND';end if;
  insert into public.miaomiao_cat_photos(owner_id,cat_id,image_path,image_bytes,created_at) select p_actor,target,value->>'imagePath',(value->>'bytes')::bigint,now()+ord*interval '1 microsecond' from jsonb_array_elements(b.files) with ordinality x(value,ord);
  if target like 'demo-%' then
   final_result:=jsonb_build_object('catId',target,'imagePaths',(select jsonb_agg(image_path order by created_at,id) from public.miaomiao_cat_photos where miaomiao_cat_photos.cat_id=target));
  else final_result:=jsonb_build_object('cat',public.miaomiao_cat_json(target::uuid));end if;
 else
  insert into public.miaomiao_comments(owner_id,cat_id,nickname,body,image_paths) values(p_actor,b.payload->>'catId',btrim(b.payload->>'nickname'),coalesce(btrim(b.payload->>'body'),''),paths) returning * into item;
  final_result:=jsonb_build_object('comment',jsonb_build_object('id',item.id,'nickname',item.nickname,'body',item.body,'imagePaths',item.image_paths,'createdAt',floor(extract(epoch from item.created_at)*1000)));
 end if;
 update public.miaomiao_media_batches set status='complete',result=final_result where id=p_id;
 return final_result;
end $$;
create function public.miaomiao_media_cancel(p_actor uuid,p_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.miaomiao_media_batches%rowtype;
begin
 select * into b from public.miaomiao_media_batches where id=p_id and owner_id=p_actor for update;
 if not found or b.status='complete' then return '[]'::jsonb;end if;
 update public.miaomiao_media_batches set status='cancelled' where id=p_id;
 return (select jsonb_agg(value->>'imagePath') from jsonb_array_elements(b.files));
end $$;

create or replace function public.miaomiao_reserve_upload(p_actor uuid,p_ip_hash text,p_name text,p_intro text,p_breed text,p_bytes bigint,p_mime text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item_id uuid:=gen_random_uuid(); file_path text; used_bytes bigint; reserved_bytes bigint; budget bigint;
begin
 if p_name is null or char_length(btrim(p_name)) not between 1 and 24 or p_intro is null or char_length(btrim(p_intro)) not between 1 and 400 or p_breed is null or char_length(btrim(p_breed)) not between 1 and 24 or p_bytes is null or p_bytes not between 1 and 8388608 or p_mime is null or p_mime not in ('image/jpeg','image/png','image/webp') then
  raise exception using errcode='22023',message='Invalid photo details';
 end if;
 perform public.miaomiao_rate_limit(p_actor,p_ip_hash,'upload');
 perform pg_advisory_xact_lock(hashtextextended('miaomiao_storage_quota',0));
 delete from public.miaomiao_upload_reservations where expires_at<now();
 select max_storage_bytes into budget from public.miaomiao_settings where singleton;
 select coalesce(sum(coalesce((metadata->>'size')::bigint,0)),0) into used_bytes
  from storage.objects where bucket_id='miaomiao-photos';
 select coalesce(sum(r.image_bytes),0) into reserved_bytes
  from public.miaomiao_upload_reservations r where not exists
   (select 1 from storage.objects o where o.bucket_id='miaomiao-photos' and o.name=r.image_path);
 select reserved_bytes+coalesce(sum((batchfile.value->>'bytes')::bigint),0) into reserved_bytes from public.miaomiao_media_batches b cross join lateral jsonb_array_elements(b.files) as batchfile(value) where b.status='active' and b.expires_at>now() and not exists(select 1 from storage.objects o where o.bucket_id='miaomiao-photos' and o.name=batchfile.value->>'imagePath');
 if used_bytes+reserved_bytes+p_bytes>budget then raise exception using errcode='P0001',message='MIAOMIAO_STORAGE_FULL'; end if;
 file_path:=item_id::text||case p_mime when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.webp' end;
 insert into public.miaomiao_upload_reservations(id,owner_id,name,intro,breed,image_path,image_bytes,mime_type)
 values(item_id,p_actor,btrim(p_name),btrim(p_intro),btrim(p_breed),file_path,p_bytes,p_mime);
 return jsonb_build_object('id',item_id,'imagePath',file_path);
end $$;


-- Every new RPC is invoker-only and service_role-only. No browser grants or Storage policies.
revoke all on function public.miaomiao_award_json(public.miaomiao_blessings),public.miaomiao_community_state(uuid),public.miaomiao_community_action(uuid,text,jsonb),public.miaomiao_cat_json(uuid),public.miaomiao_cat_options(),public.miaomiao_media_start(uuid,text,text,jsonb,jsonb),public.miaomiao_media_file(uuid,uuid,integer),public.miaomiao_media_finish(uuid,uuid),public.miaomiao_media_cancel(uuid,uuid) from public,anon,authenticated;
grant execute on function public.miaomiao_award_json(public.miaomiao_blessings),public.miaomiao_community_state(uuid),public.miaomiao_community_action(uuid,text,jsonb),public.miaomiao_cat_json(uuid),public.miaomiao_cat_options(),public.miaomiao_media_start(uuid,text,text,jsonb,jsonb),public.miaomiao_media_file(uuid,uuid,integer),public.miaomiao_media_finish(uuid,uuid),public.miaomiao_media_cancel(uuid,uuid),public.miaomiao_rate_limit(uuid,text,text),public.miaomiao_valid_cat(text) to service_role;
notify pgrst,'reload schema';

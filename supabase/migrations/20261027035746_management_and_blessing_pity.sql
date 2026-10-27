-- Additive migration: retain original records and Storage objects for recovery.
create schema if not exists miaomiao_private;
revoke all on schema miaomiao_private from public,anon,authenticated;
grant usage on schema miaomiao_private to service_role;
create table miaomiao_private.admin_credentials(username text primary key check(username='admin'),password_hash text,updated_at timestamptz not null default now());
insert into miaomiao_private.admin_credentials(username) values('admin');
create table miaomiao_private.admin_sessions(token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),expires_at timestamptz not null);
create index admin_sessions_expiry on miaomiao_private.admin_sessions(expires_at);
create table miaomiao_private.admin_audit(id uuid primary key default gen_random_uuid(),kind text not null,item_key text not null,record jsonb not null,created_at timestamptz not null default now());
alter table miaomiao_private.admin_credentials enable row level security;
alter table miaomiao_private.admin_sessions enable row level security;
alter table miaomiao_private.admin_audit enable row level security;
revoke all on all tables in schema miaomiao_private from public,anon,authenticated;
grant select,insert,update,delete on all tables in schema miaomiao_private to service_role;
create table public.miaomiao_removed_photos(image_path text primary key,cat_id text not null,deleted_at timestamptz not null default now());
alter table public.miaomiao_removed_photos enable row level security;
revoke all on public.miaomiao_removed_photos from public,anon,authenticated;
grant select,insert on public.miaomiao_removed_photos to service_role;
alter table public.miaomiao_comments add column deleted_at timestamptz;
alter table public.miaomiao_blessings add column deleted_at timestamptz;
alter table public.miaomiao_visitors add column since_blessing integer not null default 0 check(since_blessing between 0 and 9);

create function public.miaomiao_admin_action(p_action text,p_session_hash text,p_new_session_hash text,p_ip_hash text,p_value jsonb,p_demos jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare credentials miaomiao_private.admin_credentials%rowtype; tries integer; rate_key text; records jsonb; cats jsonb; comments jsonb; awards jsonb; stats jsonb; selected jsonb; total integer; page integer; query text; target text; path text; previous jsonb; affected integer;
begin
 select * into credentials from miaomiao_private.admin_credentials where username='admin' for update;
 if p_action in ('login','password') then
  rate_key:='admin-'||p_action||':'||coalesce(p_ip_hash,'unknown');
  insert into public.miaomiao_rate_limits(key,attempts,expires_at) values(rate_key,1,now()+interval '1 minute')
  on conflict(key) do update set attempts=case when miaomiao_rate_limits.expires_at<=now() then 1 else miaomiao_rate_limits.attempts+1 end,expires_at=case when miaomiao_rate_limits.expires_at<=now() then now()+interval '1 minute' else miaomiao_rate_limits.expires_at end returning attempts into tries;
  if tries>8 then return jsonb_build_object('error','尝试次数较多，请一分钟后再试','status',429);end if;
 end if;
 if p_action='login' then
  if credentials.password_hash is null or p_value->>'username' is distinct from 'admin' or p_value->>'password' is null or octet_length(p_value->>'password')>72 or extensions.crypt(p_value->>'password',credentials.password_hash) is distinct from credentials.password_hash then return jsonb_build_object('error','账号或密码不正确','status',401);end if;
  if p_new_session_hash is null or p_new_session_hash !~ '^[a-f0-9]{64}$' then raise exception using errcode='22023',message='Invalid session';end if;
  delete from miaomiao_private.admin_sessions where expires_at<=now();
  insert into miaomiao_private.admin_sessions values(p_new_session_hash,now()+interval '8 hours');
  delete from public.miaomiao_rate_limits where key=rate_key;
  return jsonb_build_object('username','admin');
 end if;
 if not exists(select 1 from miaomiao_private.admin_sessions where token_hash=p_session_hash and expires_at>now()) then return jsonb_build_object('error','登录已过期，请重新登录','status',401);end if;
 if p_action='session' then return jsonb_build_object('username','admin');end if;
 if p_action='logout' then delete from miaomiao_private.admin_sessions where token_hash=p_session_hash;return jsonb_build_object('ok',true);end if;
 if p_action='password' then
  if p_value->>'currentPassword' is null or octet_length(p_value->>'currentPassword')>72 or extensions.crypt(p_value->>'currentPassword',credentials.password_hash) is distinct from credentials.password_hash then return jsonb_build_object('error','当前密码不正确','status',400);end if;
  if coalesce(char_length(p_value->>'newPassword'),0)<6 or octet_length(p_value->>'newPassword')>72 or p_new_session_hash is null or p_new_session_hash !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','新密码至少6位，且不超过72字节','status',400);end if;
  update miaomiao_private.admin_credentials set password_hash=extensions.crypt(p_value->>'newPassword',extensions.gen_salt('bf',10)),updated_at=now() where username='admin';
  delete from miaomiao_private.admin_sessions;
  insert into miaomiao_private.admin_sessions values(p_new_session_hash,now()+interval '8 hours');
  delete from public.miaomiao_rate_limits where key=rate_key;
  return jsonb_build_object('ok',true,'username','admin');
 end if;
 if p_action='delete' then
  perform 1 from public.miaomiao_totals where singleton for update;
  if p_value->>'kind'='photo' then
   target:=p_value->>'catId';path:=p_value->>'imagePath';
   if target is null or path is null or not exists(
    select 1 from public.miaomiao_cats c where c.id::text=target and c.image_path=path
    union all select 1 from public.miaomiao_cat_photos p where p.cat_id=target and p.image_path=path
    union all select 1 from jsonb_array_elements(p_demos) d where d->>'id'=target and d->>'image'=path
   ) then return jsonb_build_object('error','没有找到这张照片','status',404);end if;
   insert into public.miaomiao_removed_photos(image_path,cat_id) values(path,target) on conflict do nothing;
   previous:=jsonb_build_object('catId',target,'imagePath',path);
  elsif p_value->>'kind'='comment' then
   select to_jsonb(c) into previous from public.miaomiao_comments c where id::text=p_value->>'id' and deleted_at is null for update;
   if previous is null then return jsonb_build_object('error','没有找到这条留言','status',404);end if;
   update public.miaomiao_comments set deleted_at=now() where id::text=p_value->>'id';
  elsif p_value->>'kind'='blessing' then
   select to_jsonb(b) into previous from public.miaomiao_blessings b where id::text=p_value->>'id' and deleted_at is null for update;
   if previous is null then return jsonb_build_object('error','没有找到这条祝福','status',404);end if;
   update public.miaomiao_blessings set deleted_at=now() where id::text=p_value->>'id';
  else return jsonb_build_object('error','不支持这个删除操作','status',400);end if;
  insert into miaomiao_private.admin_audit(kind,item_key,record) values(p_value->>'kind',coalesce(p_value->>'id',path),previous);
  update public.miaomiao_totals set version=version+1 where singleton;
  return jsonb_build_object('ok',true);
 end if;
 if p_action<>'data' then return jsonb_build_object('error','没有找到这个管理操作','status',404);end if;
 page:=(p_value->>'page')::integer;query:=btrim(coalesce(p_value->>'query',''));
 if page is null or page<0 or page>100000 or char_length(query)>100 then return jsonb_build_object('error','查询条件不正确','status',400);end if;
 select coalesce(jsonb_agg(public.miaomiao_cat_json(c.id)||jsonb_build_object('likes',coalesce(l.likes,0)) order by c.created_at desc,c.id desc),'[]') into cats from public.miaomiao_cats c left join public.miaomiao_likes l on l.cat_id=c.id::text;
 select cats||coalesce(jsonb_agg(d||jsonb_build_object('hideDefault',exists(select 1 from public.miaomiao_removed_photos r where r.cat_id=d->>'id' and r.image_path=d->>'image'),
  'imagePaths',coalesce((select jsonb_agg(p.image_path order by p.created_at,p.id) from public.miaomiao_cat_photos p where p.cat_id=d->>'id' and not exists(select 1 from public.miaomiao_removed_photos r where r.image_path=p.image_path)),'[]'),
  'commentCount',(select count(*) from public.miaomiao_comments c where c.cat_id=d->>'id' and c.deleted_at is null),'likes',coalesce((select l.likes from public.miaomiao_likes l where l.cat_id=d->>'id'),0)) order by ord),'[]') into cats from jsonb_array_elements(p_demos) with ordinality x(d,ord);
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'catId',c.cat_id,'catName',coalesce(a.name,(select d->>'name' from jsonb_array_elements(p_demos) d where d->>'id'=c.cat_id),'小院留言板'),'nickname',c.nickname,'body',c.body,'imagePaths',c.image_paths,'createdAt',floor(extract(epoch from c.created_at)*1000)) order by c.created_at desc,c.id desc),'[]') into comments from public.miaomiao_comments c left join public.miaomiao_cats a on a.id::text=c.cat_id where c.deleted_at is null;
 select coalesce(jsonb_agg(public.miaomiao_award_json(b) order by b.created_at desc,b.id desc),'[]') into awards from public.miaomiao_blessings b where deleted_at is null;
 stats:=jsonb_build_object('cats',jsonb_array_length(cats),'comments',jsonb_array_length(comments),'blessings',jsonb_array_length(awards),'photos',(select coalesce(sum(jsonb_array_length(c->'imagePaths')+case when c->>'demo'='true' and c->>'hideDefault'='false' then 1 else 0 end),0) from jsonb_array_elements(cats) c));
 records:=case p_value->>'kind' when 'cats' then cats when 'comments' then comments when 'blessings' then awards else null end;
 if records is null then return jsonb_build_object('error','查询条件不正确','status',400);end if;
 select coalesce(jsonb_agg(r order by ord),'[]') into records from jsonb_array_elements(records) with ordinality x(r,ord) where query='' or position(lower(query) in lower(r::text))>0;
 total:=jsonb_array_length(records);
 select coalesce(jsonb_agg(r order by ord),'[]') into selected from (select r,ord from jsonb_array_elements(records) with ordinality x(r,ord) order by ord limit 12 offset page*12) p;
 return jsonb_build_object('items',selected,'total',total,'page',page,'pageSize',12,'stats',stats);
end $$;
revoke all on function public.miaomiao_admin_action(text,text,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.miaomiao_admin_action(text,text,text,text,jsonb,jsonb) to service_role;


create or replace function public.miaomiao_community_state(p_actor uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('version',t.version,'totals',jsonb_build_object('incense',t.incense,'blessings',t.blessings),
 'likes',coalesce((select jsonb_object_agg(cat_id,likes) from public.miaomiao_likes),'{}'::jsonb),
 'ritual',coalesce((select jsonb_build_object('incense',incense,'blessings',blessings,'lastBlessingId',last_blessing_id,'sinceBlessing',since_blessing) from public.miaomiao_visitors where owner_id=p_actor),'{"incense":0,"blessings":0,"lastBlessingId":null}'::jsonb),
 'lastAward',(select public.miaomiao_award_json(b) from public.miaomiao_blessings b join public.miaomiao_visitors v on v.last_award_id=b.id where v.owner_id=p_actor and b.deleted_at is null),
 'feed',coalesce((select jsonb_agg(public.miaomiao_award_json(b) order by b.created_at desc,b.id desc) from public.miaomiao_blessings b where recipient_set and deleted_at is null),'[]'::jsonb)) from public.miaomiao_totals t where singleton;
$$;

create or replace function public.miaomiao_community_action(p_actor uuid,p_action text,p_value jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
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
  v.incense:=v.incense+1;v.since_blessing:=v.since_blessing+1;
  awarded:=v.since_blessing>=10 or random()<0.20;
  if awarded then
   select array_agg(x) into choices from unnest(array['peace','fortune','study','career','joy','friendship']) x where x is distinct from v.last_blessing_id;
   v.last_blessing_id:=choices[1+floor(random()*cardinality(choices))::integer];
   insert into public.miaomiao_blessings(owner_id,blessing_id) values(p_actor,v.last_blessing_id) returning * into a;
   v.blessings:=v.blessings+1;v.last_award_id:=a.id;v.since_blessing:=0;
  end if;
  update public.miaomiao_visitors set incense=v.incense,since_blessing=v.since_blessing,blessings=v.blessings,last_blessing_id=v.last_blessing_id,last_award_id=v.last_award_id where owner_id=p_actor;
  update public.miaomiao_totals set incense=incense+1,blessings=blessings+case when awarded then 1 else 0 end where singleton;
 elsif p_action='blessing-recipient' then
  select * into a from public.miaomiao_blessings where id=(p_value->>'awardId')::uuid and owner_id=p_actor and deleted_at is null for update;
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

create or replace function public.miaomiao_cat_json(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',c.id,'name',c.name,'intro',c.intro,'breed',c.breed,'imagePath',c.image_path,
 'imagePaths',coalesce((select jsonb_agg(p.image_path order by p.ord,p.created_at,p.id) from (
  select c.image_path,0 ord,c.created_at,c.id union all select image_path,1,created_at,id from public.miaomiao_cat_photos where cat_id=c.id::text
 ) p where not exists(select 1 from public.miaomiao_removed_photos r where r.image_path=p.image_path)),'[]'::jsonb),
 'createdAt',floor(extract(epoch from c.created_at)*1000),'commentCount',(select count(*) from public.miaomiao_comments where cat_id=c.id::text and deleted_at is null)) from public.miaomiao_cats c where id=p_id;
$$;

create or replace function public.miaomiao_gallery(p_offset integer default 0) returns jsonb language plpgsql security invoker set search_path='' as $$
declare total bigint; cats jsonb; demo_counts jsonb; demo_photos jsonb;
begin
 if p_offset<0 or p_offset>10000000 then raise exception using errcode='22023',message='Invalid page';end if;
 select count(*) into total from public.miaomiao_cats;
 select coalesce(jsonb_agg(public.miaomiao_cat_json(c.id) order by c.created_at desc,c.id desc),'[]'::jsonb) into cats from (select id,created_at from public.miaomiao_cats order by created_at desc,id desc limit 60 offset p_offset) c;
 select coalesce(jsonb_object_agg(cat_id,n),'{}'::jsonb) into demo_counts from (select cat_id,count(*) n from public.miaomiao_comments where cat_id like 'demo-%' and deleted_at is null group by cat_id) d;
 select coalesce(jsonb_object_agg(cat_id,paths),'{}'::jsonb) into demo_photos from(select cat_id,jsonb_agg(image_path order by created_at,id) paths from public.miaomiao_cat_photos p where cat_id like 'demo-%' and not exists(select 1 from public.miaomiao_removed_photos r where r.image_path=p.image_path) group by cat_id)d;
 return jsonb_build_object('cats',cats,'uploadedTotal',total,'demoCounts',demo_counts,'demoPhotos',demo_photos,'demoHidden',coalesce((select jsonb_agg(cat_id) from public.miaomiao_removed_photos where image_path like '/cats/%'),'[]'::jsonb),'nextOffset',case when p_offset+jsonb_array_length(cats)<total then p_offset+jsonb_array_length(cats) else null end);
end $$;

create or replace function public.miaomiao_comments_get(p_cat_id text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if not public.miaomiao_valid_cat(p_cat_id) then raise exception 'MIAOMIAO_CAT_NOT_FOUND';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'nickname',nickname,'body',body,'imagePaths',image_paths,'createdAt',floor(extract(epoch from created_at)*1000)) order by created_at desc,id desc),'[]'::jsonb) into result from(select * from public.miaomiao_comments where cat_id=p_cat_id and deleted_at is null order by created_at desc,id desc limit 100)c;
 return jsonb_build_object('comments',result);
end $$;

notify pgrst,'reload schema';
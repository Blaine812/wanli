create function public.miaomiao_rate_limit(p_actor uuid,p_ip_hash text,p_action text)
returns void language plpgsql security definer set search_path='' as $$
declare
 seconds integer; maximum integer; window_start bigint; subject text; rate_key text; attempts integer;
begin
 if p_actor is null or p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{64}$' or p_action is null or p_action not in ('upload','comment') then
  raise exception using errcode='22023', message='Invalid visitor';
 end if;
 seconds := case when p_action='upload' then 3600 else 60 end;
 maximum := case when p_action='upload' then 10 else 6 end;
 window_start := floor(extract(epoch from now())/seconds)::bigint;
 foreach subject in array array['visitor:'||p_actor::text,'ip:'||p_ip_hash] loop
  rate_key := p_action||':'||subject||':'||window_start::text;
  insert into public.miaomiao_rate_limits(key,attempts,expires_at)
    values(rate_key,1,to_timestamp((window_start+1)*seconds))
    on conflict(key) do update set attempts=public.miaomiao_rate_limits.attempts+1
    returning miaomiao_rate_limits.attempts into attempts;
  if attempts>maximum then raise exception using errcode='P0001', message='MIAOMIAO_RATE_LIMIT'; end if;
 end loop;
 delete from public.miaomiao_rate_limits where key in
  (select key from public.miaomiao_rate_limits where expires_at<now() limit 1000);
end $$;

create function public.miaomiao_reserve_upload(p_actor uuid,p_ip_hash text,p_name text,p_intro text,p_breed text,p_bytes bigint,p_mime text)
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
 if used_bytes+reserved_bytes+p_bytes>budget then raise exception using errcode='P0001',message='MIAOMIAO_STORAGE_FULL'; end if;
 file_path:=item_id::text||case p_mime when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.webp' end;
 insert into public.miaomiao_upload_reservations(id,owner_id,name,intro,breed,image_path,image_bytes,mime_type)
 values(item_id,p_actor,btrim(p_name),btrim(p_intro),btrim(p_breed),file_path,p_bytes,p_mime);
 return jsonb_build_object('id',item_id,'imagePath',file_path);
end $$;

create function public.miaomiao_finish_upload(p_id uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare reservation public.miaomiao_upload_reservations%rowtype; cat public.miaomiao_cats%rowtype; stored_bytes bigint; stored_type text;
begin
 select * into cat from public.miaomiao_cats where id=p_id and owner_id=p_actor;
 if not found then
  select * into reservation from public.miaomiao_upload_reservations where id=p_id and owner_id=p_actor for update;
  if not found or reservation.expires_at<now() then raise exception using errcode='22023',message='Photo reservation expired'; end if;
  select (metadata->>'size')::bigint,metadata->>'mimetype' into stored_bytes,stored_type
   from storage.objects where bucket_id='miaomiao-photos' and name=reservation.image_path;
  if stored_bytes is distinct from reservation.image_bytes or stored_type is distinct from reservation.mime_type then raise exception using errcode='22023',message='Photo was not stored correctly'; end if;
  insert into public.miaomiao_cats(id,owner_id,name,intro,breed,image_path,image_bytes)
   values(reservation.id,reservation.owner_id,reservation.name,reservation.intro,reservation.breed,reservation.image_path,reservation.image_bytes)
   returning * into cat;
  delete from public.miaomiao_upload_reservations where id=p_id;
 end if;
 return jsonb_build_object('id',cat.id,'name',cat.name,'intro',cat.intro,'breed',cat.breed,'imagePath',cat.image_path,'createdAt',floor(extract(epoch from cat.created_at)*1000),'commentCount',0);
end $$;

create function public.miaomiao_cancel_upload(p_id uuid,p_actor uuid)
returns void language sql security definer set search_path='' as $$
 delete from public.miaomiao_upload_reservations where id=p_id and owner_id=p_actor;
$$;


revoke all on function public.miaomiao_rate_limit(uuid,text,text),public.miaomiao_reserve_upload(uuid,text,text,text,text,bigint,text),public.miaomiao_finish_upload(uuid,uuid),public.miaomiao_cancel_upload(uuid,uuid) from public,anon,authenticated;
grant execute on function public.miaomiao_reserve_upload(uuid,text,text,text,text,bigint,text),public.miaomiao_finish_upload(uuid,uuid),public.miaomiao_cancel_upload(uuid,uuid) to service_role;
notify pgrst,'reload schema';

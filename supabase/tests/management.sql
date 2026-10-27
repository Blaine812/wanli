-- Run on a migrated database. Every verification change is rolled back.
begin;
do $$
declare token text:=repeat('a',64); second_token text:=repeat('b',64); result jsonb; actor uuid:=gen_random_uuid(); cat uuid:=gen_random_uuid(); comment_id uuid; award_id uuid; before_incense bigint; i integer; since integer; total integer;
begin
 if has_function_privilege('anon','public.miaomiao_admin_action(text,text,text,text,jsonb,jsonb)','execute') or has_function_privilege('authenticated','public.miaomiao_admin_action(text,text,text,text,jsonb,jsonb)','execute') then raise exception 'Public management RPC access';end if;
 if has_table_privilege('anon','miaomiao_private.admin_credentials','select') then raise exception 'Public credentials';end if;
 result:=public.miaomiao_admin_action('data','','','verify','{"kind":"cats","query":"","page":0}', '[]');if result->>'status'<>'401' then raise exception 'Unauthenticated admin data';end if;
 update miaomiao_private.admin_credentials set password_hash=extensions.crypt('verify-password',extensions.gen_salt('bf',4)) where username='admin';
 result:=public.miaomiao_admin_action('login','',token,'verify','{"username":"admin","password":"wrong"}', '[]');if result->>'status'<>'401' then raise exception 'Wrong password accepted';end if;
 result:=public.miaomiao_admin_action('login','',token,'verify','{"username":"admin","password":"verify-password"}', '[]');if result->>'username'<>'admin' then raise exception 'Admin login failure: %',result;end if;
 insert into public.miaomiao_cats(id,owner_id,name,intro,breed,image_path,image_bytes) values(cat,actor,'上线事务验证','仅事务内存在','测试',cat::text||'/0.jpg',100);
 insert into public.miaomiao_cat_photos(owner_id,cat_id,image_path,image_bytes) values(actor,cat::text,cat::text||'/1.jpg',100);
 insert into public.miaomiao_comments(owner_id,cat_id,nickname,body) values(actor,cat::text,'事务验证','留言') returning id into comment_id;
 result:=public.miaomiao_admin_action('data',token,'','verify','{"kind":"cats","query":"上线事务验证","page":0}', '[]');if (result->>'total')::integer<>1 then raise exception 'Cat search failed: %',result;end if;
 result:=public.miaomiao_admin_action('delete',token,'','verify',jsonb_build_object('kind','photo','catId',cat,'imagePath',cat::text||'/0.jpg'),'[]');if not (result->>'ok')::boolean then raise exception 'Photo delete failure: %',result;end if;
 result:=public.miaomiao_cat_json(cat);if jsonb_array_length(result->'imagePaths')<>1 or result->'imagePaths'->>0<>cat::text||'/1.jpg' then raise exception 'Wrong cover deletion: %',result;end if;
 perform public.miaomiao_admin_action('delete',token,'','verify',jsonb_build_object('kind','photo','catId',cat,'imagePath',cat::text||'/1.jpg'),'[]');
 result:=public.miaomiao_cat_json(cat);if jsonb_array_length(result->'imagePaths')<>0 or result->>'name'<>'上线事务验证' then raise exception 'Empty album failure';end if;
 perform public.miaomiao_admin_action('delete',token,'','verify',jsonb_build_object('kind','comment','id',comment_id),'[]');
 result:=public.miaomiao_comments_get(cat::text);if jsonb_array_length(result->'comments')<>0 then raise exception 'Comment deletion failure';end if;
 select incense into before_incense from public.miaomiao_totals where singleton;
 for i in 1..100 loop
  result:=public.miaomiao_community_action(actor,'offer','{}');
  since:=(result->'ritual'->>'sinceBlessing')::integer;if since<0 or since>9 then raise exception 'Pity guarantee failed';end if;
  if result->'award'->>'id' is not null then award_id:=(result->'award'->>'id')::uuid;end if;
 end loop;
 if award_id is null then raise exception 'No blessings awarded';end if;
 perform public.miaomiao_community_action(actor,'blessing-recipient',jsonb_build_object('awardId',award_id,'name','事务验证'));
 perform public.miaomiao_admin_action('delete',token,'','verify',jsonb_build_object('kind','blessing','id',award_id),'[]');
 result:=public.miaomiao_community_state(actor);if result->'lastAward'->>'id'=award_id::text or exists(select 1 from jsonb_array_elements(result->'feed') f where f->>'id'=award_id::text) then raise exception 'Deleted blessing exposed';end if;
 if (result->'totals'->>'incense')::bigint<>before_incense+100 then raise exception 'History incorrectly reset';end if;
 perform public.miaomiao_admin_action('password',token,second_token,'verify','{"currentPassword":"verify-password","newPassword":"verify-new-password"}','[]');
 result:=public.miaomiao_admin_action('session',token,'','verify','{}','[]');if result->>'status'<>'401' then raise exception 'Old session retained';end if;
 result:=public.miaomiao_admin_action('session',second_token,'','verify','{}','[]');if result->>'username'<>'admin' then raise exception 'New session invalid';end if;
 result:=public.miaomiao_gallery(0);if result->>'uploadedTotal' is null then raise exception 'Gallery failed';end if;
end $$;

do $$
declare result jsonb; demos jsonb:='[{"id":"demo-milk","name":"奶盖","breed":"暖橘长毛","image":"/cats/milk.jpg","demo":true,"createdAt":0}]';
begin
 result:=public.miaomiao_admin_action('data',repeat('b',64),'','verify','{"kind":"cats","query":"奶盖","page":0}',demos);
 if (result->>'total')::integer<>1 then raise exception 'Demo management missing';end if;
 perform public.miaomiao_admin_action('delete',repeat('b',64),'','verify','{"kind":"photo","catId":"demo-milk","imagePath":"/cats/milk.jpg"}',demos);
 result:=public.miaomiao_gallery(0);if not (result->'demoHidden' ? 'demo-milk') then raise exception 'Demo default still visible';end if;
 result:=public.miaomiao_admin_action('data',repeat('b',64),'','verify','{"kind":"cats","query":"奶盖","page":0}',demos);
 if result->'items'->0->>'hideDefault'<>'true' then raise exception 'Admin default still visible';end if;
end $$;

rollback;

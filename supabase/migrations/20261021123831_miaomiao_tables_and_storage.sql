-- Isolated application tables. The website calls the authenticated Edge Function;
-- browser roles receive no direct database writes or Storage uploads.
create table public.miaomiao_cats (
 id uuid primary key, owner_id uuid not null,
 name text not null check (char_length(btrim(name)) between 1 and 24),
 intro text not null check (char_length(btrim(intro)) between 1 and 400),
 breed text not null check (char_length(breed) between 1 and 24),
 image_path text not null unique, image_bytes bigint not null check (image_bytes between 1 and 8388608),
 created_at timestamptz not null default now()
);
create table public.miaomiao_comments (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null, cat_id text not null,
 nickname text not null check (char_length(btrim(nickname)) between 1 and 24),
 body text not null check (char_length(btrim(body)) between 1 and 500),
 created_at timestamptz not null default now()
);
create index miaomiao_comments_cat_time on public.miaomiao_comments(cat_id, created_at desc);
create table public.miaomiao_upload_reservations (
 id uuid primary key, owner_id uuid not null, name text not null, intro text not null, breed text not null,
 image_path text not null unique, image_bytes bigint not null check (image_bytes between 1 and 8388608),
 mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
 expires_at timestamptz not null default (now()+interval '10 minutes')
);
create table public.miaomiao_rate_limits (
 key text primary key, attempts integer not null, expires_at timestamptz not null
);
create index miaomiao_rate_limits_expiry on public.miaomiao_rate_limits(expires_at);
create table public.miaomiao_settings (
 singleton boolean primary key default true check (singleton),
 max_storage_bytes bigint not null default 1073741824 check (max_storage_bytes>0)
);
insert into public.miaomiao_settings(singleton) values(true);
alter table public.miaomiao_cats enable row level security;
alter table public.miaomiao_comments enable row level security;
alter table public.miaomiao_upload_reservations enable row level security;
alter table public.miaomiao_rate_limits enable row level security;
alter table public.miaomiao_settings enable row level security;
revoke all on public.miaomiao_cats,public.miaomiao_comments,public.miaomiao_upload_reservations,public.miaomiao_rate_limits,public.miaomiao_settings from public,anon,authenticated;
grant all on public.miaomiao_cats,public.miaomiao_comments,public.miaomiao_upload_reservations,public.miaomiao_rate_limits,public.miaomiao_settings to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('miaomiao-photos','miaomiao-photos',true,8388608,array['image/jpeg','image/png','image/webp']);
-- No storage.objects upload/update/delete policies are added for browser roles.


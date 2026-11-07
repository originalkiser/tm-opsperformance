-- REVIEW ONLY. Local development; production requires separate authorization.
begin;
create table public.resource_catalog (
 id uuid primary key default gen_random_uuid(),
 category_key text not null,
 brand_key text not null default '',
 name text not null check(length(btrim(name)) between 1 and 200),
 sort_order integer not null default 0,
 uses_manufacturers boolean not null default false,
 revision integer not null default 1 check(revision>0),
 unique(category_key,brand_key),
 check(brand_key='' or (not uses_manufacturers and length(name)<=100))
);
create unique index resource_category_name_unique on public.resource_catalog(lower(btrim(name))) where brand_key='';
create unique index resource_manufacturer_name_unique on public.resource_catalog(category_key,lower(btrim(name))) where brand_key<>'';
alter table public.resource_catalog enable row level security;
revoke all on public.resource_catalog from public,anon,authenticated;
grant select on public.resource_catalog to authenticated;
create policy resource_catalog_read on public.resource_catalog for select to authenticated using(resource_private.allowed());
-- Existing metadata becomes immutable association keys; no document row is rewritten.
insert into public.resource_catalog(category_key,name,sort_order,uses_manufacturers)
select name,name,position,name='Equipment Manuals' or exists(select 1 from public.resource_documents d where d.category=name and d.brand<>'')
from (values ('General Manager Workbook',0),('Equipment Manuals',1),('Standard Operating Procedures (SOPs)',2),('Employee Handbook',3),('Other Reference Materials',4)) seeds(name,position);
insert into public.resource_catalog(category_key,brand_key,name,sort_order)
select category,brand,brand,(row_number() over(partition by category order by lower(brand),brand))::integer
from (select distinct category,brand from public.resource_documents where brand<>'') manufacturers;
-- Fail safely on an unexpected production constraint instead of dropping unknown checks.
alter table public.resource_documents drop constraint resource_documents_category_check;
alter table public.resource_documents drop constraint resource_documents_check;
alter table public.resource_documents add constraint resource_documents_catalog_fkey
 foreign key(category,brand) references public.resource_catalog(category_key,brand_key) on delete restrict;
create index resource_documents_catalog_idx on public.resource_documents(category,brand);
create function resource_private.validate_catalog_document() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.resource_catalog;
begin
 select * into c from public.resource_catalog where category_key=new.category and brand_key='' for share;
 if not found then raise exception 'Select an existing category'; end if;
 if c.uses_manufacturers and new.brand='' then raise exception 'Select a manufacturer'; end if;
 if not c.uses_manufacturers and new.brand<>'' then raise exception 'This category does not use manufacturers'; end if;
 return new;
end;
$$;
revoke all on function resource_private.validate_catalog_document() from public,anon,authenticated;
create trigger resource_document_catalog_guard before insert or update of category,brand on public.resource_documents
 for each row execute function resource_private.validate_catalog_document();

create function public.manage_resource_catalog(p_action text,p_expected jsonb,p_id uuid default null,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.resource_catalog; parent public.resource_catalog; peer public.resource_catalog;
 actual jsonb; new_key text; label text; direction integer;
begin
 if not resource_private.allowed(true) then raise exception 'Active Admin required'; end if;
 -- Serialize catalog management; document writes separately lock their parent category.
 perform pg_advisory_xact_lock(hashtext('tm_resource_catalog_management'));
 perform id from public.resource_catalog order by id for update;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision) order by id),'[]'::jsonb) into actual from public.resource_catalog;
 if p_expected is distinct from actual then raise exception 'Catalog changed; refresh before continuing'; end if;
 if p_action='add_category' then
  new_key:=gen_random_uuid()::text;
  insert into public.resource_catalog(category_key,name,sort_order)
  values(new_key,btrim(p_data->>'name'),coalesce((select max(sort_order)+1 from public.resource_catalog where brand_key=''),0));
 else
  select * into c from public.resource_catalog where id=p_id;
  if not found then raise exception 'Folder no longer exists'; end if;
  if p_action='add_manufacturer' then
   if c.brand_key<>'' or not c.uses_manufacturers then raise exception 'Select a manufacturer category'; end if;
   insert into public.resource_catalog(category_key,brand_key,name,sort_order)
   values(c.category_key,gen_random_uuid()::text,btrim(p_data->>'name'),coalesce((select max(sort_order)+1 from public.resource_catalog where category_key=c.category_key and brand_key<>''),0));
  elsif p_action='rename' then
   update public.resource_catalog set name=btrim(p_data->>'name'),revision=revision+1 where id=c.id;
  elsif p_action='move' then
   direction:=(p_data->>'direction')::integer;
   if direction not in (-1,1) or direction is null then raise exception 'Invalid order direction'; end if;
   -- Orders are unique within siblings after seeding and every managed swap/add.
   select * into peer from public.resource_catalog r where
    ((c.brand_key='' and r.brand_key='') or (c.brand_key<>'' and r.brand_key<>'' and r.category_key=c.category_key))
    and (r.sort_order-c.sort_order)*direction>0 order by abs(r.sort_order-c.sort_order),r.id limit 1;
   if not found then raise exception 'Folder is already at the end'; end if;
   update public.resource_catalog set sort_order=peer.sort_order,revision=revision+1 where id=c.id;
   update public.resource_catalog set sort_order=c.sort_order,revision=revision+1 where id=peer.id;
  elsif p_action='delete' then
   if exists(select 1 from public.resource_documents d where d.category=c.category_key and (c.brand_key='' or d.brand=c.brand_key)) then
    raise exception 'Reassign documents and finish pending uploads or cleanup before deleting this folder';
   end if;
   if c.brand_key='' then delete from public.resource_catalog where category_key=c.category_key and brand_key<>''; end if;
   delete from public.resource_catalog where id=c.id;
  else raise exception 'Unknown catalog action'; end if;
 end if;
 return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.manage_resource_catalog(text,jsonb,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.manage_resource_catalog(text,jsonb,uuid,jsonb) to authenticated;
commit;

-- Display wording only. Requires the existing Super Admin capability migration.
-- No account grants, numeric values, templates, historical data or rules are changed.
begin;
set local lock_timeout='3s';
create table configuration_private.budget_labels (
 position integer not null unique,
 id text primary key,
 default_label text not null check(length(default_label) between 1 and 100),
 default_helper text not null check(length(default_helper)<=400),
 label text not null check(length(btrim(label)) between 1 and 100),
 helper text not null check(length(helper)<=400),
 revision integer not null default 0 check(revision>=0)
);
create table configuration_private.budget_label_history (
 event_id bigint generated always as identity primary key,
 field_id text not null references configuration_private.budget_labels(id),
 revision integer not null,
 action text not null check(action in ('save','restore')),
 actor uuid not null,
 actor_name text not null,
 changed_at timestamptz not null default clock_timestamp(),
 previous_label text not null, previous_helper text not null,
 new_label text not null, new_helper text not null,
 unique(field_id,revision)
);
alter table configuration_private.budget_labels enable row level security;
alter table configuration_private.budget_label_history enable row level security;
revoke all on configuration_private.budget_labels,configuration_private.budget_label_history from public,anon,authenticated,service_role;
revoke all on sequence configuration_private.budget_label_history_event_id_seq from public,anon,authenticated,service_role;
insert into configuration_private.budget_labels(position,id,default_label,default_helper,label,helper)
select position,id,label,helper,label,helper from (values
(0,'yesterday-washes','Yesterday Washes',''),
(1,'yesterday-redemptions','Yesterday Redemptions',''),
(2,'yesterday-wash-overrides','Yesterday Wash Overrides','Blank counts as zero'),
(3,'yesterday-basic','Yesterday Basic','Memberships Sold'),
(4,'yesterday-good','Yesterday Good','Memberships Sold'),
(5,'yesterday-better','Yesterday Better','Memberships Sold'),
(6,'yesterday-best','Yesterday Best','Memberships Sold'),
(7,'mtd-washes','MTD Washes',''),
(8,'mtd-redemptions','MTD Redemptions',''),
(9,'mtd-wash-overrides','MTD Wash Overrides','Blank counts as zero'),
(10,'mtd-basic','MTD Basic','Memberships Sold'),
(11,'mtd-good','MTD Good','Memberships Sold'),
(12,'mtd-better','MTD Better','Memberships Sold'),
(13,'mtd-best','MTD Best','Memberships Sold'),
(14,'yesterday-total-revenue','YESTERDAY TOTAL TO ACCOUNT FOR / TOTAL PAYMENTS ($)',''),
(15,'yesterday-cc-revenue','YESTERDAY CREDIT CARD REVENUE ($)','Add amounts with +, then press Enter to calculate.'),
(16,'yesterday-house-revenue','YESTERDAY HOUSE ACCOUNT / OTHER TENDERS ($)',''),
(17,'mtd-revenue-actual','REPORTED MTD REVENUE ($)','Cumulative revenue through the prior business day. Leave blank to retain the saved report.'),
(18,'mtd-membership-actual','Current Total Members',''),
(19,'current-reviews','MTD REVIEWS',''),
(20,'current-rating','GOOGLE RATING','')
) seed(position,id,label,helper);

create function configuration_private.read_budget_labels() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.user_profiles where id=auth.uid() and role in ('admin','store') and is_active and deleted_at is null) then
  raise exception 'Active Budget Tracker account required' using errcode='42501';
 end if;
 return (select jsonb_agg(jsonb_build_object('id',id,'label',label,'helper',helper) order by position) from configuration_private.budget_labels);
end;
$$;
create function public.budget_tracker_labels() returns jsonb
language sql stable security invoker set search_path='' as $$
 select configuration_private.read_budget_labels();
$$;

create function configuration_private.budget_label_editor(p_action text,p_key text,p_revision integer,p_label text,p_helper text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item configuration_private.budget_labels; label_value text; helper_value text; v_actor_name text;
begin
 if not configuration_private.is_super_admin(auth.uid()) then raise exception 'Super Admin required' using errcode='42501'; end if;
 if p_action is null or p_action not in ('read','save','restore') then raise exception 'Unsupported wording action'; end if;
 if p_key is null and p_action<>'read' then raise exception 'Select an approved Budget Tracker field'; end if;
 if p_key is not null then
  select * into item from configuration_private.budget_labels where id=p_key;
  if not found then raise exception 'Select an approved Budget Tracker field'; end if;
 end if;
 if p_action in ('save','restore') then
  -- Keep account/capability revocation and concurrent saves coherent until commit.
  perform 1 from public.user_profiles where id=auth.uid() for share;
  perform 1 from configuration_private.super_admins where user_id=auth.uid() for share;
  select * into strict item from configuration_private.budget_labels where id=p_key for update;
  if not configuration_private.is_super_admin(auth.uid()) then raise exception 'Super Admin access changed' using errcode='42501'; end if;
  if p_revision is distinct from item.revision then raise exception 'Wording changed elsewhere. Reload before saving' using errcode='PT409'; end if;
  if p_action='restore' then label_value:=item.default_label; helper_value:=item.default_helper;
  else label_value:=btrim(p_label); helper_value:=btrim(p_helper); end if;
  if label_value is null or length(label_value) not between 1 and 100 or label_value ~ '[[:cntrl:]]'
   or helper_value is null or length(helper_value)>400 or translate(helper_value,E'\n\r\t','') ~ '[[:cntrl:]]' then
   raise exception 'Enter a label of 1–100 characters and helper text of up to 400 characters';
  end if;
  if (label_value,helper_value) is distinct from (item.label,item.helper) then
   select coalesce(nullif(btrim(name),''),'Super Admin') into strict v_actor_name from public.user_profiles where id=auth.uid();
   insert into configuration_private.budget_label_history(field_id,revision,action,actor,actor_name,previous_label,previous_helper,new_label,new_helper)
   values(item.id,item.revision+1,p_action,auth.uid(),v_actor_name,item.label,item.helper,label_value,helper_value);
   update configuration_private.budget_labels set label=label_value,helper=helper_value,revision=revision+1 where id=item.id;
  end if;
 end if;
 return jsonb_build_object('items',(select jsonb_agg(jsonb_build_object('id',id,'label',label,'helper',helper,'default_label',default_label,'default_helper',default_helper,'revision',revision) order by position) from configuration_private.budget_labels),
  'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.revision desc) from
   (select revision,action,actor_name,changed_at,previous_label,previous_helper,new_label,new_helper from configuration_private.budget_label_history where field_id=p_key order by revision desc limit 50) h),'[]'::jsonb));
end;
$$;
create function public.budget_tracker_label_editor(p_action text,p_key text default null,p_revision integer default null,p_label text default null,p_helper text default null) returns jsonb
language sql security invoker set search_path='' as $$
 select configuration_private.budget_label_editor(p_action,p_key,p_revision,p_label,p_helper);
$$;
revoke all on function configuration_private.read_budget_labels(),configuration_private.budget_label_editor(text,text,integer,text,text),public.budget_tracker_labels(),public.budget_tracker_label_editor(text,text,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function configuration_private.read_budget_labels(),configuration_private.budget_label_editor(text,text,integer,text,text),public.budget_tracker_labels(),public.budget_tracker_label_editor(text,text,integer,text,text) to authenticated;
notify pgrst,'reload schema';
commit;

-- ============================================================================
-- Luban & Musk — copy the ORIGINAL store's data into the new tables.
--
-- Where:  the Supabase SQL editor of the SAME project the original store uses, after the
--         new schema exists (`npm run db:migrate` with DATABASE_URL pointing at it).
-- What:   reads the original tables in schema `public`, writes the new ones in schema
--         `store`. Never changes or deletes anything in `public`: the original store keeps
--         running until you switch over, and switching back is just redeploying it.
-- Again:  safe to run more than once, and MEANT to be run again just before and just after
--         the switch. Orders already copied are left alone (what changed on the old site
--         after the first copy — paid, shipped, cancelled — is carried over by
--         db/reconcile-v1.sql). Empower parcels, the catalogue (while nobody has published
--         in the new admin), the Empower records and customers' notes follow the old
--         site's newer row. New analytics events are added each run; the KPI hours, logs,
--         webhook records, audit and change log are copied once, while their new table is
--         still empty. (public.orders has no updated_at column: the import takes
--         created_at for it.)
-- Leaves: Empower auto push OFF in the new store (both stores pushing would send parcels
--         twice). Switch it on in the new admin once the new store is live.
-- Drops:  SMSA and local-courier parcels (their waybill is kept on the order as the
--         tracking number, carrier "SMSA"), the offline sales ledger, WhatsApp API state.
-- ============================================================================
begin;

-- ---------- helpers (removed again at the end) ----------
create or replace function store.v1_num(t text) returns numeric language sql immutable as $$
  select case when t ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then t::numeric else null end
$$;

create or replace function store.v1_ts(t text) returns timestamptz language plpgsql immutable as $$
begin
  if t is null or t = '' then return null; end if;
  return t::timestamptz;
exception when others then return null;
end $$;

create or replace function store.v1_dial(cc text) returns text language sql immutable as $$
  select case upper(coalesce(cc, '')) when 'AE' then '971' when 'SA' then '966' when 'QA' then '974'
         when 'KW' then '965' when 'BH' then '973' when 'OM' then '968' else null end
$$;

create or replace function store.v1_mobile_len(dial text) returns int language sql immutable as $$
  select case dial when '971' then 9 when '966' then 9 else 8 end
$$;

-- The customer key, exactly as src/shared/orders/phone.ts phoneKey() makes it: the dial code
-- and the national number. A phone already cleared by the retention purge falls back to the
-- original's key (the last nine digits).
create or replace function store.v1_phone_key(phone text, cc text, old_key text) returns text language plpgsql immutable as $$
declare
  d text;
  dial text := store.v1_dial(cc);
begin
  d := regexp_replace(translate(coalesce(phone, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '\D', '', 'g');
  d := regexp_replace(d, '^00', '');
  if d = '' then
    d := regexp_replace(coalesce(old_key, ''), '\D', '', 'g');
    if d = '' then return null; end if;
    if dial is not null and length(d) > store.v1_mobile_len(dial) then d := right(d, store.v1_mobile_len(dial)); end if;
  elsif dial is not null and position(dial in d) = 1 and length(d) > store.v1_mobile_len(dial) then
    d := substr(d, length(dial) + 1);
  end if;
  d := ltrim(d, '0');
  if d = '' then return null; end if;
  return coalesce(dial, '') || d;
end $$;

create or replace function store.v1_cur(cur text, cc text) returns text language sql immutable as $$
  select case when upper(coalesce(cur, '')) in ('OMR', 'AED', 'SAR', 'QAR', 'KWD', 'BHD') then upper(cur)
         else case upper(coalesce(cc, '')) when 'AE' then 'AED' when 'SA' then 'SAR' when 'QA' then 'QAR'
              when 'KW' then 'KWD' when 'BH' then 'BHD' else 'OMR' end end
$$;

-- ---------- orders ----------
with src as (
  select to_jsonb(o) as j from public.orders o
),
base as (
  select j,
    j ->> 'id' as id,
    coalesce(nullif(upper(j ->> 'country_code'), ''), 'OM') as cc,
    coalesce(j -> 'items', '[]'::jsonb) as items,
    case lower(coalesce(j ->> 'status', ''))
      when 'pending' then 'pending' when 'new' then 'new' when 'prep' then 'prep' when 'ship' then 'ship'
      when 'done' then 'done' when 'void' then 'void'
      when 'preparing' then 'prep' when 'shipped' then 'ship' when 'delivered' then 'done' when 'cancelled' then 'void'
      else 'new' end as status,
    case when lower(coalesce(j ->> 'pay', '')) in ('cod', 'card', 'transfer') then lower(j ->> 'pay')
         when coalesce(j ->> 'session_id', '') <> '' or coalesce(j ->> 'invoice_no', '') <> '' then 'card'
         else 'cod' end as pay,
    row_number() over (partition by nullif(j ->> 'dedupe_id', '') order by j ->> 'created_at', j ->> 'id') as dedupe_rank
  from src
  where (j ->> 'id') is not null
),
money as (
  select b.*,
    coalesce((select sum(coalesce(store.v1_num(x ->> 'price'), 0) * coalesce(store.v1_num(x ->> 'qty'), 1))
              from jsonb_array_elements(case jsonb_typeof(b.items) when 'array' then b.items else '[]'::jsonb end) x), 0) as sub,
    coalesce(store.v1_num(b.j ->> 'ship'), 0) as ship
  from base b
),
priced as (
  select m.*,
    coalesce(store.v1_num(m.j ->> 'total'), m.sub + m.ship) as total,
    store.v1_num(m.j ->> 'omr') as omr_raw
  from money m
),
smsa as (
  select distinct on (order_id) order_id, awb, picked_up_at, delivered_at
  from public.shipments
  where carrier is distinct from 'Omniful' and awb not like 'claim-%' and awb not like 'omf-%' and order_id is not null
  order by order_id, created_at desc nulls last
),
omf as (
  select distinct on (order_id) order_id, picked_up_at, delivered_at
  from public.shipments
  where awb like 'omf-%' and order_id is not null
  order by order_id, updated_at desc
)
insert into store.orders (
  id, created_at, updated_at, status, payment_status, pay, lang, origin,
  name, phone, phone_key, email, country, country_code, city, region, note,
  items, cur, sub, ship, cod_fee, total, omr_rate, omr, amount_baisa,
  dedupe_id, invoice_key, attribution, client,
  session_id, invoice_no, expire_at, paid_at, payment_id, masked_card, card_type, refunded,
  gateway_fee, net_amount, gateway, last_payment_error,
  tracking, carrier, shipped_at, delivered_at,
  admin_note, flagged, flagged_at, trashed, trashed_at, pii_cleared_at
)
select
  p.id,
  coalesce(store.v1_ts(p.j ->> 'created_at'), now()),
  coalesce(store.v1_ts(p.j ->> 'updated_at'), store.v1_ts(p.j ->> 'created_at'), now()),
  p.status,
  case when lower(coalesce(p.j ->> 'payment_status', '')) in ('unpaid', 'paid', 'cod', 'refunded', 'cancelled') then lower(p.j ->> 'payment_status')
       when p.pay = 'cod' then 'cod' when p.pay = 'transfer' then 'paid' else 'unpaid' end,
  p.pay,
  'ar',
  nullif(p.j ->> 'origin', ''),
  nullif(p.j ->> 'name', ''),
  nullif(p.j ->> 'phone', ''),
  store.v1_phone_key(p.j ->> 'phone', p.cc, p.j ->> 'phone_key'),
  nullif(p.j ->> 'email', ''),
  nullif(p.j ->> 'country', ''),
  p.cc,
  nullif(p.j ->> 'city', ''),
  nullif(p.j ->> 'region', ''),
  nullif(p.j ->> 'note', ''),
  case jsonb_typeof(p.items) when 'array' then p.items else '[]'::jsonb end,
  store.v1_cur(p.j ->> 'cur', p.cc),
  round(p.sub, 3),
  p.ship,
  case when p.pay = 'cod' then greatest(0, round(p.total - p.sub - p.ship, 3)) else 0 end,
  p.total,
  case when p.total > 0 and coalesce(p.omr_raw, 0) > 0 then (p.omr_raw / p.total)::float8 else 1 end,
  coalesce(p.omr_raw, p.total),
  store.v1_num(p.j ->> 'amount_baisa')::int,
  case when p.dedupe_rank = 1 then nullif(p.j ->> 'dedupe_id', '') else null end,
  coalesce(nullif(p.j ->> 'invoice_key', ''), replace(gen_random_uuid()::text, '-', '')),
  case jsonb_typeof(p.j -> 'attribution') when 'object' then p.j -> 'attribution' else null end,
  nullif(
    coalesce(case jsonb_typeof(p.j -> 'gateway' -> 'client') when 'object' then p.j -> 'gateway' -> 'client' else '{}'::jsonb end, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object('fbp', nullif(p.j ->> 'fbp', ''), 'fbc', nullif(p.j ->> 'fbc', ''))),
    '{}'::jsonb),
  nullif(p.j ->> 'session_id', ''),
  nullif(p.j ->> 'invoice_no', ''),
  store.v1_ts(p.j ->> 'expire_at'),
  store.v1_ts(p.j ->> 'paid_at'),
  nullif(p.j ->> 'payment_id', ''),
  nullif(p.j ->> 'masked_card', ''),
  nullif(p.j ->> 'card_type', ''),
  coalesce((p.j ->> 'refunded')::boolean, false),
  store.v1_num(p.j ->> 'gateway_fee'),
  store.v1_num(p.j ->> 'net_amount'),
  case jsonb_typeof(p.j -> 'gateway') when 'object' then p.j -> 'gateway' else null end,
  nullif(p.j ->> 'last_payment_error', ''),
  coalesce(nullif(p.j ->> 'tracking', ''), s.awb),
  case when s.awb is not null then 'SMSA' else null end,
  coalesce(s.picked_up_at, f.picked_up_at),
  coalesce(s.delivered_at, f.delivered_at),
  nullif(p.j ->> 'admin_note', ''),
  coalesce((p.j ->> 'flagged')::boolean, false),
  store.v1_ts(p.j ->> 'flagged_at'),
  coalesce((p.j ->> 'trashed')::boolean, false),
  store.v1_ts(p.j ->> 'trashed_at'),
  store.v1_ts(p.j ->> 'pii_cleared_at')
from priced p
left join smsa s on s.order_id = p.id
left join omf f on f.order_id = p.id
on conflict (id) do nothing;

-- one history line per imported order, so the timeline says where it came from
insert into store.order_events (order_id, at, kind, "from", "to", by, detail)
select o.id, o.created_at, 'imported', null, o.status, 'import', jsonb_build_object('from', 'luban-musk')
from store.orders o
where not exists (select 1 from store.order_events e where e.order_id = o.id and e.kind = 'imported');

-- ---------- Empower parcels ----------
insert into store.shipments (id, order_id, carrier, sent_id, reference, awb, status, cod,
                             created_at, updated_at, picked_up_at, delivered_at, synced_at, last_error)
select s.awb,
       case when exists (select 1 from store.orders o where o.id = s.order_id) then s.order_id else null end,
       'empower',
       substr(s.awb, 5),
       nullif(to_jsonb(s) ->> 'reference', ''),
       nullif(to_jsonb(s) ->> 'sawb', ''),
       s.status,
       s.cod,
       coalesce(s.created_at, s.updated_at, now()),
       coalesce(s.updated_at, now()),
       s.picked_up_at,
       s.delivered_at,
       store.v1_ts(to_jsonb(s) ->> 'synced_at'),
       nullif(to_jsonb(s) ->> 'last_error', '')
from public.shipments s
where s.awb like 'omf-%'
on conflict (id) do update set
  status = excluded.status,
  awb = coalesce(excluded.awb, store.shipments.awb),
  picked_up_at = coalesce(excluded.picked_up_at, store.shipments.picked_up_at),
  delivered_at = coalesce(excluded.delivered_at, store.shipments.delivered_at),
  synced_at = coalesce(excluded.synced_at, store.shipments.synced_at),
  last_error = excluded.last_error,
  updated_at = excluded.updated_at
where excluded.updated_at > store.shipments.updated_at;

-- a parcel that moved on the old site moves its order too, unless the new store handled the order
update store.orders o set
  shipped_at = coalesce(o.shipped_at, s.picked_up_at),
  delivered_at = coalesce(o.delivered_at, s.delivered_at)
from store.shipments s
where s.order_id = o.id and s.carrier = 'empower'
  and (s.picked_up_at is not null or s.delivered_at is not null)
  and (o.shipped_at is distinct from coalesce(o.shipped_at, s.picked_up_at) or o.delivered_at is distinct from coalesce(o.delivered_at, s.delivered_at))
  and not exists (select 1 from store.order_events e where e.order_id = o.id and e.kind <> 'imported');

-- ---------- the published catalogue ----------
insert into store.settings (id, data, version, updated_at, updated_by)
select 1, s.data, 1, coalesce(s.updated_at, now()), 'import'
from public.settings s
where s.id = 1
on conflict (id) do nothing;

-- a catalogue published on the OLD admin after the first copy wins, as long as nobody has
-- published in the NEW admin yet (updated_by is then no longer 'import')
update store.settings n set data = s.data, updated_at = s.updated_at, version = n.version + 1
from public.settings s
where s.id = 1 and n.id = 1 and n.updated_by = 'import' and s.updated_at > n.updated_at;

-- ---------- Empower and panel records (same keys and shapes) ----------
insert into store.ops (key, data, updated_at)
select o.key, o.data, coalesce(o.updated_at, now())
from public.ops o
where o.key in ('omniful_skus', 'omniful_retired', 'omniful_unsure', 'omniful_unrecorded', 'omniful_auth', 'admin_ui')
on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at
where excluded.updated_at > store.ops.updated_at;

insert into store.ops (key, data, updated_at)
values ('omniful_auto', jsonb_build_object('on', false, 'at', now(), 'by', 'import'), now())
on conflict (key) do nothing;

-- ---------- customers' notes and tags ----------
insert into store.crm (phone_key, note, tags, updated_at)
select k.phone_key, c.note, coalesce(c.tags, '{}'::text[]), coalesce(c.updated_at, now())
from public.crm c
cross join lateral (
  select coalesce(
    (select o.phone_key from store.orders o
      where o.phone_key is not null and right(o.phone_key, 9) = right(regexp_replace(c.phone, '\D', '', 'g'), 9)
      order by o.created_at desc limit 1),
    store.v1_phone_key(c.phone, case when length(regexp_replace(c.phone, '\D', '', 'g')) = 8 then 'OM' else null end, null)
  ) as phone_key
) k
where k.phone_key is not null
on conflict (phone_key) do update set note = excluded.note, tags = excluded.tags, updated_at = excluded.updated_at
where excluded.updated_at > store.crm.updated_at;

-- ---------- analytics: new raw events every run; the rolled-up hours once ----------
-- (the raw events copied on the first run already hold everything the old site's purge rolls
-- into stats_hours later, so copying the hours again would count those days twice)
insert into store.events (at, name, item, sid, country, city, lat, lng)
select e.at, e.name, e.item, e.sid, e.country,
       to_jsonb(e) ->> 'city', store.v1_num(to_jsonb(e) ->> 'lat')::real, store.v1_num(to_jsonb(e) ->> 'lng')::real
from public.events e
where e.at > coalesce((select max(at) from store.events), '-infinity'::timestamptz)
order by e.id;

insert into store.event_hours (hour, sid, country, name, item, n)
select h.hour, h.sid, h.country, h.name, h.item, h.n
from public.stats_hours h
where not exists (select 1 from store.event_hours)
on conflict do nothing;

-- ---------- history tables: copied once, while the new one is empty ----------

insert into store.logs (at, level, side, source, message, order_id, path, detail)
select l.at, 'error',
       case when l.side = 'client' then 'browser' else 'server' end,
       l.kind, l.message, nullif(to_jsonb(l) ->> 'order_id', ''), l.place,
       case when l.detail is null then null else jsonb_build_object('detail', left(l.detail, 2000)) end
from public.logs l
where l.at > now() - interval '60 days'
  and not exists (select 1 from store.logs)
order by l.id;

insert into store.webhook_events (received_at, provider, event_type, order_id, invoice, verified, applied, dedupe_key, payload)
select w.received_at, 'thawani', w.event_type, w.order_id, w.invoice, w.verified, w.applied,
       nullif(to_jsonb(w) ->> 'dedupe_key', ''), w.payload
from public.webhook_events w
where not exists (select 1 from store.webhook_events)
order by w.id
on conflict (dedupe_key) do nothing;

insert into store.admin_audit (at, actor, action, target, summary)
select a.at, coalesce(a.actor, 'admin'), a.action, nullif(array_to_string(a.ids, ','), ''), a.summary
from public.admin_audit a
where not exists (select 1 from store.admin_audit)
order by a.id;

insert into store.catalogue_changes (at, actor, what)
select coalesce(store.v1_ts(x ->> 'at'), now()), 'admin', left(coalesce(x ->> 'what', ''), 400)
from public.ops o, jsonb_array_elements(case jsonb_typeof(o.data) when 'array' then o.data else '[]'::jsonb end) x
where o.key = 'changelog'
  and not exists (select 1 from store.catalogue_changes)
order by 1;

-- ---------- tidy up ----------
drop function store.v1_cur(text, text);
drop function store.v1_phone_key(text, text, text);
drop function store.v1_mobile_len(text);
drop function store.v1_dial(text);
drop function store.v1_ts(text);
drop function store.v1_num(text);

commit;

-- What came across (read the numbers before switching):
select 'orders' as what, (select count(*) from public.orders) as original, (select count(*) from store.orders) as copied
union all select 'empower parcels', (select count(*) from public.shipments where awb like 'omf-%'), (select count(*) from store.shipments)
union all select 'events', (select count(*) from public.events), (select count(*) from store.events)
union all select 'customer notes', (select count(*) from public.crm), (select count(*) from store.crm);

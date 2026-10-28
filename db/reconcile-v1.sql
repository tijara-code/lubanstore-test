-- ============================================================================
-- Luban & Musk — bring over what CHANGED on the original store after an earlier import.
--
-- db/import-from-v1.sql copies an order once and never touches it again ("on conflict do
-- nothing"). So an order copied on Monday and then paid, shipped or cancelled on the OLD site
-- on Tuesday is stale in the new tables. This script lists those orders and applies the old
-- site's newer state — but ONLY to orders the new store has not touched itself (no history
-- line in store.order_events after the import), and — where the original has an updated_at
-- column — only when the old row is the newer one.
--
-- Where:  the Supabase SQL editor of the same project, after the switch (and any time
--         `npm run preflight` reports drift). Safe to run more than once.
-- Shows:  one row per order that differed, with old and new status/payment/tracking and
--         whether it was applied; "kept" rows were changed in the NEW store already — look at
--         those two by hand in the new admin.
-- Never:  changes anything in schema public.
-- ============================================================================
drop table if exists v1_drift;
begin;

create temp table v1_drift as
with raw as (
  -- to_jsonb: the original's columns were added over time (some by hand), so none is assumed
  select to_jsonb(o) as j from public.orders o
),
old as (
  select
    j ->> 'id' as id,
    case lower(coalesce(j ->> 'status', ''))
      when 'pending' then 'pending' when 'new' then 'new' when 'prep' then 'prep' when 'ship' then 'ship'
      when 'done' then 'done' when 'void' then 'void'
      when 'preparing' then 'prep' when 'shipped' then 'ship' when 'delivered' then 'done' when 'cancelled' then 'void'
      else 'new' end as status,
    case when lower(coalesce(j ->> 'payment_status', '')) in ('unpaid', 'paid', 'cod', 'refunded', 'cancelled') then lower(j ->> 'payment_status') else null end as payment_status,
    nullif(j ->> 'tracking', '') as tracking,
    nullif(j ->> 'payment_id', '') as payment_id,
    case when coalesce(j ->> 'paid_at', '') ~ '^\d{4}-' then (j ->> 'paid_at')::timestamptz else null end as paid_at,
    coalesce((j ->> 'refunded')::boolean, false) as refunded,
    nullif(j ->> 'admin_note', '') as admin_note,
    coalesce((j ->> 'flagged')::boolean, false) as flagged,
    coalesce((j ->> 'trashed')::boolean, false) as trashed,
    case when coalesce(j ->> 'updated_at', '') ~ '^\d{4}-' then (j ->> 'updated_at')::timestamptz else null end as updated_at
  from raw
),
touched as (
  -- the newest thing the NEW store did to the order (anything but the import line itself)
  select order_id, max(at) as at from store.order_events where kind <> 'imported' group by order_id
)
select
  n.id,
  n.status as new_status, o.status as old_status,
  n.payment_status as new_payment, coalesce(o.payment_status, n.payment_status) as old_payment,
  n.tracking as new_tracking, o.tracking as old_tracking,
  o.payment_id, o.paid_at, o.refunded, o.admin_note, o.flagged, o.trashed, o.updated_at as old_updated_at,
  t.at as touched_in_new_store,
  (t.at is null and (o.updated_at is null or o.updated_at >= n.updated_at - interval '1 second')) as apply
from store.orders n
join old o on o.id = n.id
left join touched t on t.order_id = n.id
where o.status is distinct from n.status
   or coalesce(o.payment_status, n.payment_status) is distinct from n.payment_status
   or o.tracking is distinct from n.tracking
   or (o.payment_id is not null and o.payment_id is distinct from n.payment_id)
   or o.refunded is distinct from n.refunded
   or o.flagged is distinct from n.flagged
   or o.trashed is distinct from n.trashed;

update store.orders n set
  status = d.old_status,
  payment_status = d.old_payment,
  tracking = coalesce(d.old_tracking, n.tracking),
  payment_id = coalesce(d.payment_id, n.payment_id),
  paid_at = coalesce(d.paid_at, n.paid_at),
  refunded = d.refunded,
  admin_note = coalesce(d.admin_note, n.admin_note),
  flagged = d.flagged,
  trashed = d.trashed,
  updated_at = greatest(n.updated_at, coalesce(d.old_updated_at, n.updated_at))
from v1_drift d
where d.id = n.id and d.apply;

-- the card settlement detail that lands together with "paid" (and the trash/flag times)
update store.orders n set
  masked_card = coalesce(nullif(j ->> 'masked_card', ''), n.masked_card),
  card_type = coalesce(nullif(j ->> 'card_type', ''), n.card_type),
  gateway_fee = coalesce(case when (j ->> 'gateway_fee') ~ '^-?[0-9.]+$' then (j ->> 'gateway_fee')::numeric end, n.gateway_fee),
  net_amount = coalesce(case when (j ->> 'net_amount') ~ '^-?[0-9.]+$' then (j ->> 'net_amount')::numeric end, n.net_amount),
  invoice_no = coalesce(nullif(j ->> 'invoice_no', ''), n.invoice_no),
  session_id = coalesce(nullif(j ->> 'session_id', ''), n.session_id),
  gateway = coalesce(case when jsonb_typeof(j -> 'gateway') = 'object' then j -> 'gateway' end, n.gateway),
  last_payment_error = coalesce(nullif(j ->> 'last_payment_error', ''), n.last_payment_error),
  expire_at = coalesce(case when coalesce(j ->> 'expire_at', '') ~ '^\d{4}-' then (j ->> 'expire_at')::timestamptz end, n.expire_at),
  trashed_at = coalesce(case when coalesce(j ->> 'trashed_at', '') ~ '^\d{4}-' then (j ->> 'trashed_at')::timestamptz end, n.trashed_at),
  flagged_at = coalesce(case when coalesce(j ->> 'flagged_at', '') ~ '^\d{4}-' then (j ->> 'flagged_at')::timestamptz end, n.flagged_at)
from (select to_jsonb(o) as j from public.orders o) p
where p.j ->> 'id' = n.id
  and exists (select 1 from v1_drift d where d.id = n.id and d.apply);

insert into store.order_events (order_id, at, kind, "from", "to", by, detail)
select d.id, now(), 'status', d.new_status, d.old_status, 'import',
       jsonb_build_object('reconciled', true, 'from', 'luban-musk', 'payment', jsonb_build_object('from', d.new_payment, 'to', d.old_payment))
from v1_drift d
where d.apply;

commit;

-- the report (the editor shows the last statement's rows)
select id,
       case when apply then 'applied' else 'kept — changed in the new store too; check by hand' end as outcome,
       new_status as was, old_status as now_status,
       new_payment as was_payment, old_payment as now_payment,
       new_tracking as was_tracking, old_tracking as now_tracking,
       old_updated_at, touched_in_new_store
from v1_drift
order by apply desc, old_updated_at desc;

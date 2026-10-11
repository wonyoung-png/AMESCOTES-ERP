-- Existing purchase names/amounts/currencies are untouched. Apply before the caller.
begin;
alter table public.purchase_items add column if not exists spec text;
notify pgrst,'reload schema';
commit;

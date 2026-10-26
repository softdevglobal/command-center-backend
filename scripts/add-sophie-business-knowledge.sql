-- Published answers for BMS Pros and public information for individual businesses.
-- No placeholder prices, policies or contact details are seeded.
create table if not exists public.sophie_business_knowledge (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  product text not null default 'all',
  business_name text not null default '',
  business_key text not null default '',
  title text not null,
  content text not null,
  published boolean not null default false,
  updated_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  search_document tsvector generated always as (
    setweight(to_tsvector('english', title), 'A') ||
    setweight(to_tsvector('english', content), 'B')
  ) stored
);

-- This script can be rerun safely if an earlier run created the table or some
-- constraints before returning an error.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sophie_business_knowledge_scope_consistency_check' and conrelid = 'public.sophie_business_knowledge'::regclass) then
    alter table public.sophie_business_knowledge add constraint sophie_business_knowledge_scope_consistency_check check (
      (scope = 'bms_pros' and business_name = '' and business_key = '') or
      (scope = 'business' and char_length(business_name) >= 3 and char_length(business_key) >= 3)
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sophie_business_knowledge_scope_allowed_check' and conrelid = 'public.sophie_business_knowledge'::regclass) then
    alter table public.sophie_business_knowledge add constraint sophie_business_knowledge_scope_allowed_check check (scope in ('bms_pros', 'business'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sophie_business_knowledge_product_check' and conrelid = 'public.sophie_business_knowledge'::regclass) then
    alter table public.sophie_business_knowledge add constraint sophie_business_knowledge_product_check check (product in ('all', 'black', 'trade'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sophie_business_knowledge_title_check' and conrelid = 'public.sophie_business_knowledge'::regclass) then
    alter table public.sophie_business_knowledge add constraint sophie_business_knowledge_title_check check (char_length(title) between 3 and 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sophie_business_knowledge_content_check' and conrelid = 'public.sophie_business_knowledge'::regclass) then
    alter table public.sophie_business_knowledge add constraint sophie_business_knowledge_content_check check (char_length(content) between 3 and 12000);
  end if;
end;
$$;

create index if not exists sophie_business_knowledge_search_idx
  on public.sophie_business_knowledge using gin(search_document);
create index if not exists sophie_business_knowledge_scope_idx
  on public.sophie_business_knowledge(scope, business_key, product) where published;
alter table public.sophie_business_knowledge enable row level security;
revoke all on public.sophie_business_knowledge from anon, authenticated;
grant all on public.sophie_business_knowledge to service_role;

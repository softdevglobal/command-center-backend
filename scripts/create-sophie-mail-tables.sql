-- Sophie mailbox takeover state and audit events.
-- Zoho remains the source of truth for email contents; these tables store only
-- operator control state and a minimal audit trail.

create table if not exists public.sophie_mail_thread_controls (
  thread_id text primary key,
  state text not null check (state in ('sophie', 'human')) default 'sophie',
  owner_id uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.sophie_mail_audit_events (
  id bigint generated always as identity primary key,
  thread_id text not null,
  actor_id uuid null references auth.users(id) on delete set null,
  action text not null check (action in ('takeover', 'release_to_sophie', 'human_reply_sent')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sophie_mail_audit_events_thread_created_idx
  on public.sophie_mail_audit_events (thread_id, created_at desc);

alter table public.sophie_mail_thread_controls enable row level security;
alter table public.sophie_mail_audit_events enable row level security;

-- Access is backend-only through the service role after super-admin checks.
revoke all on public.sophie_mail_thread_controls from anon, authenticated;
revoke all on public.sophie_mail_audit_events from anon, authenticated;
grant all on public.sophie_mail_thread_controls to service_role;
grant all on public.sophie_mail_audit_events to service_role;
grant usage, select on sequence public.sophie_mail_audit_events_id_seq to service_role;
revoke all on sequence public.sophie_mail_audit_events_id_seq from anon, authenticated;

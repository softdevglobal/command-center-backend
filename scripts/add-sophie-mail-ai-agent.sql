-- Add automatic, idempotent Sophie email handling state.
-- Safe to run after create-sophie-mail-tables.sql; all mailbox content remains in Zoho.

alter table public.sophie_mail_audit_events
  drop constraint if exists sophie_mail_audit_events_action_check;
alter table public.sophie_mail_audit_events
  add constraint sophie_mail_audit_events_action_check
  check (action in ('takeover', 'release_to_sophie', 'human_reply_sent', 'ai_reply_sent', 'ai_reply_needs_human'));

create table if not exists public.sophie_mail_processed_messages (
  message_id text primary key,
  thread_id text not null,
  status text not null check (status in ('processing', 'sent', 'needs_human', 'failed')),
  error_code text null,
  created_at timestamptz not null default now(),
  finished_at timestamptz null
);

create table if not exists public.sophie_mail_worker_state (
  worker_name text primary key,
  started_at timestamptz not null
);

alter table public.sophie_mail_processed_messages enable row level security;
alter table public.sophie_mail_worker_state enable row level security;
revoke all on public.sophie_mail_processed_messages from anon, authenticated;
revoke all on public.sophie_mail_worker_state from anon, authenticated;
grant all on public.sophie_mail_processed_messages to service_role;
grant all on public.sophie_mail_worker_state to service_role;

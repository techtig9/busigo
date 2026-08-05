-- busigo database schema — apply as-is in Supabase (SQL editor or migration) before running the app.

create table users (
  id uuid primary key references auth.users(id),
  name text,
  email text unique not null,
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz default now()
);

create table templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  use_case text not null,
  definition jsonb not null, -- seed step-list definition a new workflow can start from
  thumbnail text
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) not null,
  plan text not null default 'free' check (plan in ('free','starter','growth','pro','enterprise')),
  status text not null default 'active',
  provider text default 'paddle',
  paddle_subscription_id text,
  paddle_customer_id text,
  credits_remaining int not null default 1000,
  renews_at timestamptz
);

create table workflows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) not null,
  name text not null,
  description text,
  trigger_type text not null check (trigger_type in ('webhook','schedule','form')),
  trigger_config jsonb not null default '{}', -- e.g. {"cron": "0 9 * * *"} for a schedule trigger
  trigger_token text unique default gen_random_uuid(), -- builds the public /api/hook/[token] URL
  definition jsonb not null default '[]', -- ordered array of step objects: [{key, type, config}]
  status text not null default 'draft' check (status in ('draft','published')),
  next_run_at timestamptz, -- for schedule-triggered workflows
  created_at timestamptz default now()
);

create table workflow_versions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid references workflows(id) not null,
  definition jsonb not null,
  created_at timestamptz default now()
);

create table forms (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid references workflows(id) not null,
  slug text unique not null,
  fields jsonb not null default '[]', -- [{key, label, type: text/number/email/textarea/select, required}]
  created_at timestamptz default now()
);

create table workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid references workflows(id) not null,
  trigger_source text not null check (trigger_source in ('webhook','schedule','form','manual_test')),
  status text not null default 'running' check (status in ('running','waiting','success','failed','stopped_by_filter')),
  trigger_payload jsonb,
  resume_at timestamptz, -- set while status = 'waiting' on a Delay step
  started_at timestamptz default now(),
  ended_at timestamptz
);

create table workflow_run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references workflow_runs(id) not null,
  step_key text not null,
  type text not null check (type in ('http_request','send_email','delay','filter','transform_data','ai_action','webhook_response')),
  input jsonb,
  output jsonb,
  status text not null check (status in ('success','failed','skipped')),
  duration_ms int,
  created_at timestamptz default now()
);

create table connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) not null,
  service text not null check (service in ('slack','google_sheets','gmail','google_calendar','airtable','hubspot','trello','notion')),
  status text not null default 'queued' check (status in ('queued','connected')),
  created_at timestamptz default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) not null,
  paddle_transaction_id text,
  amount numeric,
  status text,
  created_at timestamptz default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) not null,
  title text not null,
  body text,
  link text,
  read boolean not null default false,
  created_at timestamptz default now()
);

-- Row Level Security ------------------------------------------------------
alter table users enable row level security;
alter table subscriptions enable row level security;
alter table workflows enable row level security;
alter table workflow_versions enable row level security;
alter table forms enable row level security;
alter table workflow_runs enable row level security;
alter table workflow_run_steps enable row level security;
alter table connections enable row level security;
alter table payments enable row level security;
alter table templates enable row level security;
alter table notifications enable row level security;

create policy "users read own row" on users for select using (auth.uid() = id);
create policy "users update own row" on users for update using (auth.uid() = id);

create policy "own subscription" on subscriptions for select using (auth.uid() = user_id);

create policy "own workflows crud" on workflows for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own workflow versions" on workflow_versions for all using (
  exists (select 1 from workflows w where w.id = workflow_id and w.user_id = auth.uid())
);

create policy "own forms" on forms for all using (
  exists (select 1 from workflows w where w.id = workflow_id and w.user_id = auth.uid())
);

create policy "own runs" on workflow_runs for select using (
  exists (select 1 from workflows w where w.id = workflow_id and w.user_id = auth.uid())
);

create policy "own run steps" on workflow_run_steps for select using (
  exists (
    select 1 from workflow_runs r join workflows w on w.id = r.workflow_id
    where r.id = run_id and w.user_id = auth.uid()
  )
);

create policy "own connections" on connections for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own payments" on payments for select using (auth.uid() = user_id);

create policy "own notifications" on notifications for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "templates readable by all authenticated" on templates for select using (auth.role() = 'authenticated');

-- Note: server-side code that must bypass RLS (webhook execution, cron tick, admin panel,
-- Paddle webhook handler) uses the Supabase service-role client (lib/supabase/server.ts),
-- which is never exposed to the browser.

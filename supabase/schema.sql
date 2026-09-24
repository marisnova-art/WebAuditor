-- ═══════════════════════════════════════════════════════════════
-- AI Design & Website Auditor — Supabase schema
-- Run once in Supabase → SQL Editor. Safe to re-run (idempotent).
-- ═══════════════════════════════════════════════════════════════
create extension if not exists pgcrypto;

-- ── Users (profile row per auth user) ─────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text,
  name        text,
  plan        text not null default 'free' check (plan in ('free','pro','studio')),
  role        text not null default 'user' check (role in ('user','admin')),
  locale      text default 'en',
  created_at  timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users may edit their name/locale but never their plan or role.
create or replace function public.protect_profile_fields() returns trigger
language plpgsql as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    new.plan := old.plan;
    new.role := old.role;
  end if;
  return new;
end $$;

drop trigger if exists protect_profile on public.profiles;
create trigger protect_profile before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- ── Websites / audits / results ───────────────────────────────
create table if not exists public.websites (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles on delete cascade,
  url         text not null,
  domain      text not null,
  title       text,
  created_at  timestamptz not null default now(),
  unique (user_id, url)
);

create table if not exists public.audits (
  id               uuid primary key default gen_random_uuid(),
  website_id       uuid references public.websites on delete cascade,
  user_id          uuid not null references public.profiles on delete cascade,
  url              text not null,
  overall_score    int,
  status           text not null default 'running' check (status in ('running','completed','failed')),
  error_code       text,
  scoring_version  text,
  prompt_version   text,
  ai_engine        text,
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);
create index if not exists audits_user_created on public.audits (user_id, created_at desc);
create index if not exists audits_website_created on public.audits (website_id, created_at desc);

create table if not exists public.audit_categories (
  id          uuid primary key default gen_random_uuid(),
  audit_id    uuid not null references public.audits on delete cascade,
  category    text not null,
  score       int,
  confidence  text,
  summary     text
);
create index if not exists audit_categories_audit on public.audit_categories (audit_id);

create table if not exists public.audit_issues (
  id              uuid primary key default gen_random_uuid(),
  audit_id        uuid not null references public.audits on delete cascade,
  category        text not null,
  title           text not null,
  severity        text not null check (severity in ('critical','high','medium','low')),
  priority        text not null check (priority in ('P1','P2','P3')),
  impact          text,
  reason          text,
  recommendation  text,
  confidence      text,
  evidence_type   text,
  evidence        text,
  source          text
);
create index if not exists audit_issues_audit on public.audit_issues (audit_id);

create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  audit_id     uuid not null unique references public.audits on delete cascade,
  user_id      uuid not null references public.profiles on delete cascade,
  report_data  jsonb not null,
  is_public    boolean not null default false,
  created_at   timestamptz not null default now()
);

-- ── Service-only tables (no client policies) ─────────────────
create table if not exists public.audit_cache (
  key         text primary key,
  report      jsonb not null,
  created_at  timestamptz not null default now()
);
create table if not exists public.anon_usage (
  id          bigserial primary key,
  ip_hash     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists anon_usage_ip on public.anon_usage (ip_hash, created_at desc);
create table if not exists public.ai_usage (
  id             bigserial primary key,
  audit_id       uuid references public.audits on delete set null,
  user_id        uuid references public.profiles on delete set null,
  engine         text, model text,
  input_tokens   int, output_tokens int,
  est_cost_usd   numeric(10,5),
  created_at     timestamptz not null default now()
);
-- Admin-ready: prompt versions and runtime settings (e.g. key 'audit_weights').
create table if not exists public.prompt_versions (
  id          bigserial primary key,
  version     text not null,
  module      text not null,
  content     text not null,
  active      boolean not null default false,
  created_at  timestamptz not null default now()
);
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ── Row Level Security ────────────────────────────────────────
alter table public.profiles         enable row level security;
alter table public.websites         enable row level security;
alter table public.audits           enable row level security;
alter table public.audit_categories enable row level security;
alter table public.audit_issues     enable row level security;
alter table public.reports          enable row level security;
alter table public.audit_cache      enable row level security;
alter table public.anon_usage       enable row level security;
alter table public.ai_usage         enable row level security;
alter table public.prompt_versions  enable row level security;
alter table public.app_settings     enable row level security;

drop policy if exists "own profile read"   on public.profiles;
drop policy if exists "own profile update" on public.profiles;
create policy "own profile read"   on public.profiles for select using (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own websites" on public.websites;
create policy "own websites" on public.websites for select using (auth.uid() = user_id);

drop policy if exists "own audits read"   on public.audits;
drop policy if exists "own audits delete" on public.audits;
create policy "own audits read"   on public.audits for select using (auth.uid() = user_id);
create policy "own audits delete" on public.audits for delete using (auth.uid() = user_id);

drop policy if exists "own categories" on public.audit_categories;
create policy "own categories" on public.audit_categories for select
  using (exists (select 1 from public.audits a where a.id = audit_id and a.user_id = auth.uid()));

drop policy if exists "own issues" on public.audit_issues;
create policy "own issues" on public.audit_issues for select
  using (exists (select 1 from public.audits a where a.id = audit_id and a.user_id = auth.uid()));

drop policy if exists "own or public reports" on public.reports;
drop policy if exists "own reports share"     on public.reports;
create policy "own or public reports" on public.reports for select using (auth.uid() = user_id or is_public);
create policy "own reports share"     on public.reports for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Helpers ───────────────────────────────────────────────────
create or replace view public.my_monthly_usage with (security_invoker = true) as
  select count(*)::int as audits_this_month
  from public.audits
  where user_id = auth.uid() and status <> 'failed'
    and created_at >= date_trunc('month', now());

-- Cleanup job (schedule with pg_cron if desired):
--   delete from public.audit_cache where created_at < now() - interval '7 days';
--   delete from public.anon_usage  where created_at < now() - interval '2 days';

-- ── Storage bucket for screenshots ───────────────────────────
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', true)
on conflict (id) do nothing;

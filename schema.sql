-- Run this once in the Supabase SQL editor (https://supabase.com/dashboard/project/goqtityiywctjexzyjdu/sql)

create table if not exists users (
  phone text primary key,
  goals text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists history (
  id bigserial primary key,
  phone text not null,
  message text not null,
  reply text not null,
  created_at timestamptz not null default now()
);

create index if not exists history_phone_idx on history (phone, created_at desc);

create table if not exists businesses (
  phone text primary key,
  restaurant_slug text not null,
  restaurant_name text not null,
  created_at timestamptz not null default now()
);

-- Disable RLS so the anon key can read/write (fine for this project)
alter table users disable row level security;
alter table history disable row level security;
alter table businesses disable row level security;

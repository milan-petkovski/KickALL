-- Pokreni ovo jednom u Supabase, SQL Editor -> New query -> Run

create table if not exists public.bot_kick_tokens (
    id integer primary key,
    access_token text not null,
    refresh_token text not null,
    expires_at timestamptz not null,
    updated_at timestamptz not null default now()
);

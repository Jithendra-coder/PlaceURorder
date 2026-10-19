begin;

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

do $$
begin
  if exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'vector' and n.nspname <> 'extensions'
  ) then
    execute 'alter extension vector set schema extensions';
  end if;
end;
$$;

create table if not exists public.assistant_knowledge_chunks (
  id bigint generated always as identity primary key,
  source_key text not null,
  section_key text not null,
  title text not null,
  content text not null,
  content_hash text not null check (length(content_hash) = 64),
  source_version text not null,
  embedding_model text not null,
  embedding extensions.vector(768) not null,
  is_active boolean not null default true,
  indexed_at timestamptz not null default now(),
  constraint assistant_knowledge_chunks_source_section_key
    unique (source_key, section_key)
);

create index if not exists assistant_knowledge_chunks_scope_idx
  on public.assistant_knowledge_chunks (source_key, source_version, embedding_model)
  where is_active;

alter table public.assistant_knowledge_chunks enable row level security;
revoke all privileges on table public.assistant_knowledge_chunks from public;
revoke all privileges on sequence public.assistant_knowledge_chunks_id_seq from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all privileges on table public.assistant_knowledge_chunks from anon';
    execute 'revoke all privileges on sequence public.assistant_knowledge_chunks_id_seq from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all privileges on table public.assistant_knowledge_chunks from authenticated';
    execute 'revoke all privileges on sequence public.assistant_knowledge_chunks_id_seq from authenticated';
  end if;
end;
$$;

commit;

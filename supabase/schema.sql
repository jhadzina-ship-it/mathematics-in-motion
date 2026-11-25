-- Mathematics in Motion: database schema for Supabase.
-- Paste the whole file into the Supabase SQL editor and run it once.
-- Then run seed.sql to load the starting lessons.

create extension if not exists pgcrypto;

-- One row per lesson. "slug" is the id used in the site URL: lesson.html?id=<slug>
create table if not exists public.lessons (
  id                 uuid primary key default gen_random_uuid(),
  slug               text unique not null check (slug ~ '^[a-z0-9-]+$'),
  number             text not null default '',
  title              text not null,
  topic              text not null default '',
  chapter            text not null default '',
  status             text not null default 'draft' check (status in ('draft', 'planned', 'live')),
  video_id           text not null default '',   -- the 11-character YouTube id
  duration           text not null default '',
  level              text not null default '',
  hook               text not null default '',
  summary            text not null default '',
  outcomes           text not null default '',   -- "What you'll learn", one line per point
  skills             text not null default '',   -- "Skills you'll gain", comma-separated
  theorem            text not null default '',
  explanation        text not null default '',
  figure             text not null default '',   -- image url or site-relative path
  us_name            text not null default '',
  textbook_envision  text not null default '',
  textbook_bigideas  text not null default '',
  textbook_hmh       text not null default '',
  standard           text not null default '',
  textbook_confirmed boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Columns added after the first release (no-ops on a fresh database).
alter table public.lessons add column if not exists outcomes text not null default '';
alter table public.lessons add column if not exists skills   text not null default '';
-- Zimbabwe O-Level alignment (MoPSE/ZIMSEC Mathematics Syllabus B, Forms 1-4, 2024-2030)
alter table public.lessons add column if not exists syllabus_topic    integer not null default 0;   -- topic number 1-14 in Syllabus B
alter table public.lessons add column if not exists syllabus_subtopic text not null default '';   -- e.g. 'Trigonometrical ratios'
alter table public.lessons add column if not exists syllabus_form     text not null default '';   -- 'Form 3' or 'Form 4'
alter table public.lessons add column if not exists syllabus_objective text not null default '';  -- the learning objective the lesson meets, in the syllabus's words
alter table public.lessons add column if not exists textbook_ref      text not null default '';   -- Zimbabwean textbook chapter, e.g. 'New General Mathematics Book 3, Ch 12'
alter table public.questions add column if not exists kind text not null default 'calculation'; -- 'calculation' or 'video_check'

-- Practice questions, several per lesson. Deleting a lesson deletes its questions.
create table if not exists public.questions (
  id         uuid primary key default gen_random_uuid(),
  lesson_id  uuid not null references public.lessons (id) on delete cascade,
  position   integer not null default 1,
  prompt     text not null,
  answer     numeric not null,
  tolerance  numeric not null default 0.01,
  unit       text not null default '',
  hint       text not null default '',
  solution   text not null default '',
  figure     text not null default ''
);
create index if not exists questions_lesson_idx on public.questions (lesson_id, position);

-- Keep updated_at fresh
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists lessons_touch on public.lessons;
create trigger lessons_touch before update on public.lessons
  for each row execute function public.touch_updated_at();

-- Row-level security: anyone can read published lessons; only a signed-in author can write.
alter table public.lessons   enable row level security;
alter table public.questions enable row level security;

drop policy if exists "public read lessons" on public.lessons;
create policy "public read lessons" on public.lessons
  for select using (status <> 'draft' or auth.role() = 'authenticated');

drop policy if exists "public read questions" on public.questions;
create policy "public read questions" on public.questions
  for select using (exists (
    select 1 from public.lessons l
    where l.id = questions.lesson_id and (l.status <> 'draft' or auth.role() = 'authenticated')));

drop policy if exists "author writes lessons" on public.lessons;
create policy "author writes lessons" on public.lessons
  for all to authenticated using (true) with check (true);

drop policy if exists "author writes questions" on public.questions;
create policy "author writes questions" on public.questions
  for all to authenticated using (true) with check (true);

-- Public bucket for diagrams uploaded from the admin page.
insert into storage.buckets (id, name, public) values ('figures', 'figures', true)
  on conflict (id) do nothing;

drop policy if exists "public read figures" on storage.objects;
create policy "public read figures" on storage.objects
  for select using (bucket_id = 'figures');

drop policy if exists "author uploads figures" on storage.objects;
create policy "author uploads figures" on storage.objects
  for insert to authenticated with check (bucket_id = 'figures');

drop policy if exists "author updates figures" on storage.objects;
create policy "author updates figures" on storage.objects
  for update to authenticated using (bucket_id = 'figures');

drop policy if exists "author deletes figures" on storage.objects;
create policy "author deletes figures" on storage.objects
  for delete to authenticated using (bucket_id = 'figures');

-- The author's own topics, beyond the 14 syllabus topics (numbered 15 onwards).
create table if not exists public.topics (
  number      integer primary key check (number > 14),
  name        text not null,
  description text not null default '',
  created_at  timestamptz not null default now()
);
alter table public.topics enable row level security;
drop policy if exists "public read topics" on public.topics;
create policy "public read topics" on public.topics for select using (true);
drop policy if exists "author writes topics" on public.topics;
create policy "author writes topics" on public.topics for all to authenticated using (true) with check (true);

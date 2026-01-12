create extension if not exists pgcrypto;
create extension if not exists vector;

create schema if not exists adamus;

create table if not exists adamus.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists adamus.materials (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references adamus.subjects(id) on delete cascade,
  chapter text,
  paragraph text,
  title text not null,
  source_type text not null,
  source_uri text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint adamus_materials_source_type_chk
    check (source_type in ('image', 'pdf', 'text', 'other'))
);

create table if not exists adamus.material_pages (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references adamus.materials(id) on delete cascade,
  page_no integer not null,
  image_uri text,
  ocr_text text,
  ocr_confidence numeric(4, 3),
  created_at timestamptz not null default now(),
  unique (material_id, page_no)
);

create table if not exists adamus.material_chunks (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references adamus.materials(id) on delete cascade,
  page_id uuid references adamus.material_pages(id) on delete set null,
  chunk_index integer not null,
  content text not null,
  content_tsv tsvector generated always as (to_tsvector('dutch', content)) stored,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  unique (material_id, page_id, chunk_index)
);

create index if not exists adamus_materials_subject_id_idx
  on adamus.materials (subject_id);

create index if not exists adamus_material_pages_material_id_idx
  on adamus.material_pages (material_id, page_no);

create index if not exists adamus_material_chunks_material_id_idx
  on adamus.material_chunks (material_id, page_id, chunk_index);

create index if not exists adamus_material_chunks_tsv_idx
  on adamus.material_chunks using gin (content_tsv);

create index if not exists adamus_material_chunks_embedding_idx
  on adamus.material_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

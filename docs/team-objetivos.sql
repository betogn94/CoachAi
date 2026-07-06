-- Tablero de OBJETIVOS SEMANALES del Team (por miembro, sin fecha/hora).
-- Hermana de team_tasks (el calendario). RLS bloqueada SIN políticas → la anon
-- key (app de clientas) no entra; solo Tower via service-role (saltea RLS).
--
-- Modelo: un objetivo pertenece a UNA persona (member = dueño) y a UNA semana
-- (semana = el LUNES de esa semana, tipo 2026-07-06). Sin hora ni recordatorio:
-- eso es lo que lo diferencia del calendario. Los objetivos activos sin terminar
-- se "arrastran" a la semana siguiente (misma lógica de display que el board).

create table if not exists public.team_objetivos (
  id           uuid primary key default gen_random_uuid(),
  semana       date not null,                       -- lunes de la semana
  titulo       text not null,
  member       text not null,                       -- dueño (beto/jesus/juli/aylen)
  estado       text not null default 'por_hacer',   -- mismos 6 estados que team_tasks
  orden        int  not null default 0,             -- orden dentro del carril
  notas        jsonb not null default '[]'::jsonb,  -- [{autor,texto,ts}] (mismo hilo)
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.team_objetivos enable row level security;
-- Sin políticas a propósito: anon = 0 acceso. Tower entra por service-role.

create index if not exists team_objetivos_semana_idx on public.team_objetivos (semana);
create index if not exists team_objetivos_member_idx on public.team_objetivos (member);

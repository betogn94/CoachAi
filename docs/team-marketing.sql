-- Estado COMPARTIDO del dashboard de marketing (pestaña Contenido de Team), por mes.
-- Fase 1: el PLAN del mes (calendario, textos, reels virales, etc.) vive en el
-- front (tower/index.html → MKT_MESES), fiel al diseño de Juli. Acá guardamos solo
-- lo interactivo que edita todo el equipo: los checks del calendario y los KPIs.
-- Fase 2 moverá el plan a la base con un editor para armar los meses desde la UI.
--
-- RLS bloqueada SIN políticas → anon (app de clientas) no entra; solo Tower via
-- service-role. `mes` (YYYY-MM) es PK → sirve de unique para el upsert on_conflict.

create table if not exists public.team_marketing_estado (
  mes        text primary key,                    -- 'YYYY-MM'
  checks     jsonb not null default '{}'::jsonb,   -- { 'w1-0-0': true, ... }
  kpis       jsonb not null default '{}'::jsonb,   -- { quiz_clicks: '120', ... }
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.team_marketing_estado enable row level security;

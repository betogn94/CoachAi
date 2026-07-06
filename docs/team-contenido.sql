-- Calendario de CONTENIDO de redes del Team (planificación semanal de posteos).
-- Tercera hermana de team_tasks (calendario) y team_objetivos. RLS bloqueada SIN
-- políticas → anon (app de clientas) no entra; solo Tower via service-role.
--
-- Cada pieza está anclada a un día (fecha) + hora opcional. A diferencia del
-- calendario de tareas, NO se arrastra: queda en su día planeado. La ve todo el
-- equipo (Juli planifica el calendario entero, no solo lo suyo).
--   tipo   : reel | historia | post | carrusel | grabacion | trial
--   estado : idea | guionado | grabado | editado | publicado | cancelada
--   redes  : multi-select → {instagram, tiktok, facebook}
--   asignados : quién la tiene (jesus/juli/…), multi

create table if not exists public.team_contenido (
  id           uuid primary key default gen_random_uuid(),
  fecha        date not null,
  hora         time,
  tipo         text not null default 'reel',
  titulo       text not null,
  redes        text[] not null default '{}',          -- multi: instagram/tiktok/facebook
  asignados    text[] not null default '{}',          -- multi: members
  estado       text not null default 'idea',
  orden        int  not null default 0,
  notas        jsonb not null default '[]'::jsonb,     -- [{autor,texto,ts}]
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.team_contenido enable row level security;
-- Sin políticas a propósito: anon = 0 acceso. Tower entra por service-role.

create index if not exists team_contenido_fecha_idx on public.team_contenido (fecha);

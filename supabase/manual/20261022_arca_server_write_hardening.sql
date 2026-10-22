-- MANUAL PHASE ONLY. Never included in supabase/migrations or automatic db push.
-- Preconditions: additive migrations applied, new backend READY, production approval
-- for this SQL and use of the existing server credential. No CAE is issued here.
-- First enable the backend gate: it safely refuses emission until this transaction commits.
begin;
lock table public.arca_comprobantes in access exclusive mode;
-- A rejected attempt is not an authorized fiscal number. Retain its audit and
-- release only the number slot after matched R + two independent read-only checks.
alter table public.arca_comprobantes add column if not exists intentos_emision jsonb not null default '[]'::jsonb;
alter table public.arca_comprobantes alter column numero_cbte drop not null;
do $$
begin
  -- A pre-existing snapshot may have been client-written before permissions closed.
  -- Do not delete it or grant it trusted status silently: abort for explicit review.
  if exists (select 1 from public.arca_comprobantes where impresion_snapshot is not null) then
    raise exception 'ARCA_SNAPSHOTS_PREEXISTENTES_REQUIEREN_REVISION';
  end if;
end $$;
revoke all on public.arca_comprobantes from public, anon, authenticated;
grant select on public.arca_comprobantes to authenticated;
do $$
declare c record;
begin
  for c in select attname from pg_attribute where attrelid = 'public.arca_comprobantes'::regclass and attnum > 0 and not attisdropped loop
    execute format('revoke insert (%I), update (%I), references (%I) on public.arca_comprobantes from public, anon, authenticated', c.attname, c.attname, c.attname);
  end loop;
end $$;
grant select, insert, update on public.arca_comprobantes to service_role;
create or replace function public.arca_escritura_fiscal_segura() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select not has_table_privilege('authenticated','public.arca_comprobantes','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
    and not has_any_column_privilege('authenticated','public.arca_comprobantes','INSERT,UPDATE,REFERENCES')
    and not has_table_privilege('anon','public.arca_comprobantes','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
    and not has_any_column_privilege('anon','public.arca_comprobantes','INSERT,UPDATE,REFERENCES')
    and has_table_privilege('service_role','public.arca_comprobantes','INSERT')
    and has_table_privilege('service_role','public.arca_comprobantes','UPDATE');
$$;
revoke all on function public.arca_escritura_fiscal_segura() from public, anon;
grant execute on function public.arca_escritura_fiscal_segura() to authenticated;
do $$ begin
  if not public.arca_escritura_fiscal_segura() then raise exception 'ARCA_PERMISOS_HEREDADOS_INSEGUROS'; end if;
end $$;
commit;
-- Rollback: disable the runtime flag first and restore old backend only together
-- with reviewed grants. Do not re-grant client mutations while snapshots are trusted.

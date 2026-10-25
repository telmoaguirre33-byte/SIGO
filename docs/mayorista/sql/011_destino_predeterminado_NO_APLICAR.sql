-- Destino aprobado una vez por Matriz. Tipo, módulo y licencia permanecen separados.
begin;
create table public.sigo_mayorista_destino_predeterminado(id boolean primary key default true check(id),origen_aprobado text not null check(origen_aprobado ~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$'),aplicacion_disponible boolean not null,actualizado_por uuid not null references auth.users(id),actualizado_en timestamptz not null default now(),historial jsonb not null);
alter table public.sigo_mayorista_destino_predeterminado enable row level security;revoke all on public.sigo_mayorista_destino_predeterminado from public,anon,authenticated;
create function public.matriz_leer_destino_predeterminado_mayorista_sigo() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.es_superadmin_sigo() then raise exception 'SUPERADMIN_REQUIRED';end if;
 return (select to_jsonb(d) from public.sigo_mayorista_destino_predeterminado d where id);
end $$;
create function public.matriz_configurar_destino_predeterminado_mayorista_sigo(p_origen text,p_disponible boolean) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.es_superadmin_sigo() then raise exception 'SUPERADMIN_REQUIRED';end if;
 if p_origen is null or p_origen !~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$' or p_disponible is null then raise exception 'ORIGIN_INVALID';end if;
 insert into public.sigo_mayorista_destino_predeterminado values(true,p_origen,p_disponible,auth.uid(),now(),jsonb_build_array(jsonb_build_object('origen',p_origen,'disponible',p_disponible,'responsable',auth.uid(),'fecha',now()))) on conflict(id) do update set origen_aprobado=excluded.origen_aprobado,aplicacion_disponible=excluded.aplicacion_disponible,actualizado_por=excluded.actualizado_por,actualizado_en=now(),historial=sigo_mayorista_destino_predeterminado.historial||excluded.historial where (sigo_mayorista_destino_predeterminado.origen_aprobado,sigo_mayorista_destino_predeterminado.aplicacion_disponible) is distinct from (excluded.origen_aprobado,excluded.aplicacion_disponible);
 return true;
end $$;
create or replace function public.obtener_acceso_mayorista_sigo(p_empresa_id uuid) returns table(empresa_id uuid,habilitado boolean,aplicacion_disponible boolean,origen_aprobado text,administracion_url text,vendedor_url text) language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;
 if not exists(select 1 from public.empresa_usuarios eu where eu.empresa_id=p_empresa_id and eu.user_id=auth.uid() and eu.activo and eu.rol in ('owner','admin')) then raise exception 'FORBIDDEN';end if;
 return query select p_empresa_id,coalesce(em.habilitado,false),coalesce(d.aplicacion_disponible,g.aplicacion_disponible,false),coalesce(d.origen_aprobado,g.origen_aprobado),coalesce(d.administracion_url,g.origen_aprobado||'/portal.html'),coalesce(d.vendedor_url,g.origen_aprobado||'/secure.html') from public.empresas e left join public.sigo_empresa_modulos em on em.empresa_id=e.id and em.modulo_clave='mayorista_distribuidora' left join public.sigo_mayorista_destinos d on d.empresa_id=e.id left join public.sigo_mayorista_destino_predeterminado g on g.id where e.id=p_empresa_id and e.activa;
end $$;
revoke all on function public.matriz_leer_destino_predeterminado_mayorista_sigo(),public.matriz_configurar_destino_predeterminado_mayorista_sigo(text,boolean),public.obtener_acceso_mayorista_sigo(uuid) from public,anon;
grant execute on function public.matriz_leer_destino_predeterminado_mayorista_sigo(),public.matriz_configurar_destino_predeterminado_mayorista_sigo(text,boolean),public.obtener_acceso_mayorista_sigo(uuid) to authenticated;
rollback;

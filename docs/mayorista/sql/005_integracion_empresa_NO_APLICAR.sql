-- Propuesta ADITIVA para SIGO compartido. NO ejecutar desde fixtures Railway ni aplicar a producción automáticamente.
-- Reutiliza el catálogo/flag publicados por PR #73. No migra productos, stock, clientes, ventas ni cuentas.
begin;
create table public.sigo_empresa_tipo_negocio (
 empresa_id uuid primary key references public.empresas(id),
 tipo text not null check(tipo in ('minorista','mayorista','mixto')),
 actualizado_por uuid references auth.users(id),actualizado_en timestamptz not null default now()
);
create table public.sigo_mayorista_destinos (
 empresa_id uuid primary key references public.empresas(id),
 origen_aprobado text not null check(origen_aprobado ~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$'),
 administracion_url text not null,vendedor_url text not null,
 aplicacion_disponible boolean not null default false,
 actualizado_por uuid references auth.users(id),actualizado_en timestamptz not null default now()
);
create table public.sigo_mayorista_activacion_auditoria (
 id bigint generated always as identity primary key,empresa_id uuid not null references public.empresas(id),
 evento text not null,anterior jsonb,nuevo jsonb,actor_id uuid,fecha timestamptz not null default now()
);
alter table public.sigo_empresa_tipo_negocio enable row level security;
alter table public.sigo_mayorista_destinos enable row level security;
alter table public.sigo_mayorista_activacion_auditoria enable row level security;
revoke all on public.sigo_empresa_tipo_negocio,public.sigo_mayorista_destinos,public.sigo_mayorista_activacion_auditoria from public,anon,authenticated;
insert into public.sigo_modulos_catalogo(clave,nombre,descripcion,categoria,disponible,obligatorio,orden)
values('mayorista_distribuidora','Mayorista / Distribuidora','Circuito comercial Mayorista','Comercial / Distribución',true,false,130)
on conflict(clave) do nothing;

create function public.leer_tipo_negocio_sigo(p_empresa_id uuid) returns text
language plpgsql stable security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;
 if not exists(select 1 from public.empresa_usuarios where empresa_id=p_empresa_id and user_id=auth.uid() and activo) then raise exception 'FORBIDDEN';end if;
 return coalesce((select tipo from public.sigo_empresa_tipo_negocio where empresa_id=p_empresa_id),'minorista');
end $$;
create function public.declarar_tipo_negocio_sigo(p_empresa_id uuid,p_tipo text) returns boolean
language plpgsql security definer set search_path=public as $$
declare anterior text;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;
 if not exists(select 1 from public.empresa_usuarios where empresa_id=p_empresa_id and user_id=auth.uid() and activo and rol in ('owner','admin')) and not public.es_superadmin_sigo() then raise exception 'FORBIDDEN';end if;
 if p_tipo is null or p_tipo not in ('minorista','mayorista','mixto') then raise exception 'BUSINESS_TYPE_INVALID';end if;
 -- Serializa declaración y evita que un reintento revoque una desactivación posterior de Matriz.
 perform 1 from public.empresas where id=p_empresa_id for update;
 if not found then raise exception 'EMPRESA_NOT_FOUND';end if;
 select tipo into anterior from public.sigo_empresa_tipo_negocio where empresa_id=p_empresa_id;
 if anterior=p_tipo then return true;end if;
 insert into public.sigo_empresa_tipo_negocio values(p_empresa_id,p_tipo,auth.uid(),now())
 on conflict(empresa_id) do update set tipo=excluded.tipo,actualizado_por=excluded.actualizado_por,actualizado_en=excluded.actualizado_en;
 insert into public.sigo_empresa_modulos(empresa_id,modulo_clave,habilitado,actualizado_por,updated_at)
 values(p_empresa_id,'mayorista_distribuidora',p_tipo in ('mayorista','mixto'),auth.uid(),now())
 on conflict(empresa_id,modulo_clave) do update set habilitado=excluded.habilitado,actualizado_por=excluded.actualizado_por,updated_at=excluded.updated_at;
 insert into public.sigo_mayorista_activacion_auditoria(empresa_id,evento,anterior,nuevo,actor_id)
 values(p_empresa_id,'tipo_negocio',to_jsonb(anterior),to_jsonb(p_tipo),auth.uid());
 return true;
end $$;
create function public.sigo_auditar_flag_mayorista() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.modulo_clave='mayorista_distribuidora' and (TG_OP='INSERT' or new.habilitado is distinct from old.habilitado) then
 insert into public.sigo_mayorista_activacion_auditoria(empresa_id,evento,anterior,nuevo,actor_id)
 values(new.empresa_id,'modulo',case when TG_OP='UPDATE' then to_jsonb(old.habilitado) else null end,to_jsonb(new.habilitado),auth.uid());end if;
 return new;
end $$;
create trigger sigo_mayorista_auditar_flag after insert or update on public.sigo_empresa_modulos for each row execute function public.sigo_auditar_flag_mayorista();
create function public.obtener_acceso_mayorista_sigo(p_empresa_id uuid)
returns table(empresa_id uuid,habilitado boolean,aplicacion_disponible boolean,origen_aprobado text,administracion_url text,vendedor_url text)
language plpgsql stable security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;
 if not exists(select 1 from public.empresa_usuarios where empresa_id=p_empresa_id and user_id=auth.uid() and activo and rol in ('owner','admin')) then raise exception 'FORBIDDEN';end if;
 return query select p_empresa_id,coalesce(em.habilitado,false),coalesce(d.aplicacion_disponible,false),d.origen_aprobado,d.administracion_url,d.vendedor_url
 from public.empresas e left join public.sigo_empresa_modulos em on em.empresa_id=e.id and em.modulo_clave='mayorista_distribuidora'
 left join public.sigo_mayorista_destinos d on d.empresa_id=e.id where e.id=p_empresa_id and e.activa;
end $$;
create function public.matriz_configurar_destino_mayorista_sigo(p_empresa_id uuid,p_origen text,p_disponible boolean) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;
 if not public.es_superadmin_sigo() then raise exception 'SUPERADMIN_REQUIRED';end if;
 if p_origen is null or p_origen !~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$' or p_disponible is null then raise exception 'ORIGIN_INVALID';end if;
 insert into public.sigo_mayorista_destinos values(p_empresa_id,p_origen,p_origen||'/portal.html',p_origen||'/secure.html',p_disponible,auth.uid(),now())
 on conflict(empresa_id) do update set origen_aprobado=excluded.origen_aprobado,administracion_url=excluded.administracion_url,vendedor_url=excluded.vendedor_url,aplicacion_disponible=excluded.aplicacion_disponible,actualizado_por=excluded.actualizado_por,actualizado_en=excluded.actualizado_en;
 insert into public.sigo_mayorista_activacion_auditoria(empresa_id,evento,nuevo,actor_id) values(p_empresa_id,'destino',jsonb_build_object('origen',p_origen,'disponible',p_disponible),auth.uid());
 return true;
end $$;
create function public.matriz_auditoria_mayorista_sigo(p_empresa_id uuid)
returns setof public.sigo_mayorista_activacion_auditoria language plpgsql stable security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;
 if not public.es_superadmin_sigo() then raise exception 'SUPERADMIN_REQUIRED';end if;
 return query select * from public.sigo_mayorista_activacion_auditoria where empresa_id=p_empresa_id order by fecha desc,id desc limit 500;
end $$;
revoke all on function public.leer_tipo_negocio_sigo(uuid),public.declarar_tipo_negocio_sigo(uuid,text),public.sigo_auditar_flag_mayorista(),public.obtener_acceso_mayorista_sigo(uuid),public.matriz_configurar_destino_mayorista_sigo(uuid,text,boolean),public.matriz_auditoria_mayorista_sigo(uuid) from public,anon;
grant execute on function public.leer_tipo_negocio_sigo(uuid),public.declarar_tipo_negocio_sigo(uuid,text),public.obtener_acceso_mayorista_sigo(uuid),public.matriz_configurar_destino_mayorista_sigo(uuid,text,boolean),public.matriz_auditoria_mayorista_sigo(uuid) to authenticated;
-- Suscripción/licencia NO participa en el tipo ni en el flag. No existen triggers de login/renovación.
rollback;

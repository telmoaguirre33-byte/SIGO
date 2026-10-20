-- SIGO: endurecimiento de identidad documental en Compras/Proveedores.
-- No reescribe historicos. Protege nuevas altas/actualizaciones para evitar
-- duplicar stock por diferencias de formato del comprobante o duplicar proveedores por CUIT.

create or replace function public.normalizar_identificador_comercial_sigo(p_valor text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(regexp_replace(lower(trim(coalesce(p_valor, ''))), '[^a-z0-9]+', '', 'g'), '');
$$;

comment on function public.normalizar_identificador_comercial_sigo(text) is
  'SIGO: normaliza identificadores comerciales para comparar documentos sin depender de guiones, espacios, puntos o mayusculas.';

create or replace function public.guard_compra_documento_normalizado_sigo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero text;
  v_tipo text;
  v_existente uuid;
begin
  if new.estado is distinct from 'confirmada' then
    return new;
  end if;

  v_numero := public.normalizar_identificador_comercial_sigo(new.numero_comprobante);
  if v_numero is null then
    return new;
  end if;
  v_tipo := coalesce(public.normalizar_identificador_comercial_sigo(new.tipo_comprobante), '');

  select c.id
    into v_existente
    from public.compras_sigo c
   where c.empresa_id = new.empresa_id
     and c.proveedor_id = new.proveedor_id
     and c.estado = 'confirmada'
     and coalesce(public.normalizar_identificador_comercial_sigo(c.tipo_comprobante), '') = v_tipo
     and public.normalizar_identificador_comercial_sigo(c.numero_comprobante) = v_numero
     and c.id is distinct from new.id
   order by c.created_at asc
   limit 1;

  if v_existente is not null then
    raise exception 'PURCHASE_DOCUMENT_DUPLICATE:%', v_existente;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_compra_documento_normalizado_sigo on public.compras_sigo;
create trigger trg_guard_compra_documento_normalizado_sigo
before insert or update of empresa_id, proveedor_id, tipo_comprobante, numero_comprobante, estado
on public.compras_sigo
for each row execute function public.guard_compra_documento_normalizado_sigo();

create or replace function public.guard_proveedor_cuit_sigo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuit text;
  v_existente uuid;
begin
  if new.cuit is null or trim(new.cuit) = '' then
    new.cuit := null;
    return new;
  end if;

  v_cuit := regexp_replace(new.cuit, '[^0-9]+', '', 'g');
  if length(v_cuit) <> 11 then
    raise exception 'SUPPLIER_CUIT_INVALID';
  end if;
  new.cuit := v_cuit;

  if coalesce(new.activo, true) then
    select p.id
      into v_existente
      from public.proveedores_sigo p
     where p.empresa_id = new.empresa_id
       and p.activo = true
       and regexp_replace(coalesce(p.cuit, ''), '[^0-9]+', '', 'g') = v_cuit
       and p.id is distinct from new.id
     order by p.created_at asc nulls last
     limit 1;

    if v_existente is not null then
      raise exception 'SUPPLIER_CUIT_DUPLICATE:%', v_existente;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_proveedor_cuit_sigo on public.proveedores_sigo;
create trigger trg_guard_proveedor_cuit_sigo
before insert or update of empresa_id, cuit, activo
on public.proveedores_sigo
for each row execute function public.guard_proveedor_cuit_sigo();

revoke all on function public.guard_compra_documento_normalizado_sigo() from public;
revoke all on function public.guard_proveedor_cuit_sigo() from public;

comment on function public.guard_compra_documento_normalizado_sigo() is
  'SIGO: impide nuevas compras confirmadas duplicadas aunque el mismo comprobante se escriba con distinto formato.';
comment on function public.guard_proveedor_cuit_sigo() is
  'SIGO: normaliza CUIT y evita nuevos proveedores activos duplicados por CUIT dentro del mismo tenant.';

-- SIGO: hardening atomico de Compras/Proveedores sin tocar historicos existentes.
-- 1) Canonicaliza comprobantes para bloquear la misma factura aunque cambien guiones/espacios/puntos.
-- 2) Valida CUIT y evita identidades activas duplicadas de proveedor incluso ante concurrencia.
-- 3) Limita cantidades/costos absurdos en detalle aunque un cliente defectuoso saltee validaciones web.

create or replace function public.sigo_normalizar_documento_compra(p_valor text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(coalesce(trim(p_valor), '')), '[^[:alnum:]]+', '', 'g');
$$;

create or replace function public.sigo_normalizar_identidad_proveedor(p_valor text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    translate(
      lower(coalesce(trim(p_valor), '')),
      'áéíóúüñ',
      'aeiouun'
    ),
    '[^[:alnum:]]+',
    '',
    'g'
  );
$$;

create or replace function public.sigo_cuit_argentino_valido(p_cuit text)
returns boolean
language plpgsql
immutable
as $$
declare
  v_cuit text := regexp_replace(coalesce(p_cuit, ''), '[^0-9]+', '', 'g');
  v_suma integer;
  v_resto integer;
  v_esperado integer;
begin
  if length(v_cuit) <> 11 then
    return false;
  end if;

  v_suma :=
      substring(v_cuit, 1, 1)::integer * 5
    + substring(v_cuit, 2, 1)::integer * 4
    + substring(v_cuit, 3, 1)::integer * 3
    + substring(v_cuit, 4, 1)::integer * 2
    + substring(v_cuit, 5, 1)::integer * 7
    + substring(v_cuit, 6, 1)::integer * 6
    + substring(v_cuit, 7, 1)::integer * 5
    + substring(v_cuit, 8, 1)::integer * 4
    + substring(v_cuit, 9, 1)::integer * 3
    + substring(v_cuit, 10, 1)::integer * 2;

  v_resto := 11 - (v_suma % 11);
  v_esperado := case when v_resto = 11 then 0 when v_resto = 10 then 9 else v_resto end;
  return v_esperado = substring(v_cuit, 11, 1)::integer;
exception
  when others then
    return false;
end;
$$;

create or replace function public.sigo_guard_compra_documento_canonico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo text;
  v_numero text;
  v_lock text;
  v_existente uuid;
begin
  if new.estado is distinct from 'confirmada' then
    return new;
  end if;

  v_numero := public.sigo_normalizar_documento_compra(new.numero_comprobante);
  if v_numero = '' then
    return new;
  end if;
  v_tipo := public.sigo_normalizar_documento_compra(new.tipo_comprobante);
  v_lock := new.empresa_id::text || '|' || new.proveedor_id::text || '|' || v_tipo || '|' || v_numero;

  -- Serializa cargas concurrentes del mismo documento aun si vienen por IA/manual con formato distinto.
  perform pg_advisory_xact_lock(hashtextextended(v_lock, 0));

  select c.id
    into v_existente
    from public.compras_sigo c
   where c.empresa_id = new.empresa_id
     and c.proveedor_id = new.proveedor_id
     and c.estado = 'confirmada'
     and (new.id is null or c.id <> new.id)
     and public.sigo_normalizar_documento_compra(c.tipo_comprobante) = v_tipo
     and public.sigo_normalizar_documento_compra(c.numero_comprobante) = v_numero
   order by c.created_at asc
   limit 1;

  if v_existente is not null then
    raise exception 'PURCHASE_DOCUMENT_DUPLICATE:%', v_existente;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sigo_compra_documento_canonico on public.compras_sigo;
create trigger trg_sigo_compra_documento_canonico
before insert or update of empresa_id, proveedor_id, tipo_comprobante, numero_comprobante, estado
on public.compras_sigo
for each row
execute function public.sigo_guard_compra_documento_canonico();

create or replace function public.sigo_guard_proveedor_identidad()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuit text;
  v_nombre text;
  v_existente uuid;
  v_lock text;
begin
  if new.empresa_id is null then
    raise exception 'SUPPLIER_COMPANY_REQUIRED';
  end if;
  if nullif(trim(coalesce(new.razon_social, '')), '') is null then
    raise exception 'SUPPLIER_NAME_REQUIRED';
  end if;

  if new.activo is distinct from true then
    return new;
  end if;

  v_cuit := regexp_replace(coalesce(new.cuit, ''), '[^0-9]+', '', 'g');
  if v_cuit <> '' then
    if not public.sigo_cuit_argentino_valido(v_cuit) then
      raise exception 'SUPPLIER_CUIT_INVALID';
    end if;
    new.cuit := v_cuit;
    v_lock := new.empresa_id::text || '|supplier-cuit|' || v_cuit;
    perform pg_advisory_xact_lock(hashtextextended(v_lock, 0));

    select p.id
      into v_existente
      from public.proveedores_sigo p
     where p.empresa_id = new.empresa_id
       and p.activo = true
       and (new.id is null or p.id <> new.id)
       and regexp_replace(coalesce(p.cuit, ''), '[^0-9]+', '', 'g') = v_cuit
     order by p.created_at asc nulls last
     limit 1;
    if v_existente is not null then
      raise exception 'SUPPLIER_CUIT_DUPLICATE:%', v_existente;
    end if;
  else
    new.cuit := null;
  end if;

  v_nombre := public.sigo_normalizar_identidad_proveedor(new.razon_social);
  if v_nombre = '' then
    raise exception 'SUPPLIER_NAME_REQUIRED';
  end if;
  v_lock := new.empresa_id::text || '|supplier-name|' || v_nombre;
  perform pg_advisory_xact_lock(hashtextextended(v_lock, 0));

  select p.id
    into v_existente
    from public.proveedores_sigo p
   where p.empresa_id = new.empresa_id
     and p.activo = true
     and (new.id is null or p.id <> new.id)
     and public.sigo_normalizar_identidad_proveedor(p.razon_social) = v_nombre
   order by p.created_at asc nulls last
   limit 1;
  if v_existente is not null then
    raise exception 'SUPPLIER_NAME_DUPLICATE:%', v_existente;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sigo_proveedor_identidad on public.proveedores_sigo;
create trigger trg_sigo_proveedor_identidad
before insert or update of empresa_id, razon_social, cuit, activo
on public.proveedores_sigo
for each row
execute function public.sigo_guard_proveedor_identidad();

create or replace function public.sigo_guard_compra_item_limites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.cantidad is null or new.cantidad <= 0 or new.cantidad::text in ('NaN','Infinity','-Infinity') then
    raise exception 'PURCHASE_QUANTITY_INVALID';
  end if;
  if new.cantidad > 1000000 then
    raise exception 'PURCHASE_QUANTITY_LIMIT';
  end if;
  if new.costo_unitario is null or new.costo_unitario < 0 or new.costo_unitario::text in ('NaN','Infinity','-Infinity') then
    raise exception 'PURCHASE_COST_INVALID';
  end if;
  if new.costo_unitario > 1000000000000 then
    raise exception 'PURCHASE_COST_LIMIT';
  end if;
  if new.subtotal is null or new.subtotal < 0 or new.subtotal::text in ('NaN','Infinity','-Infinity') then
    raise exception 'PURCHASE_SUBTOTAL_INVALID';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sigo_compra_item_limites on public.compra_items_sigo;
create trigger trg_sigo_compra_item_limites
before insert or update of cantidad, costo_unitario, subtotal
on public.compra_items_sigo
for each row
execute function public.sigo_guard_compra_item_limites();

comment on function public.sigo_guard_compra_documento_canonico() is
  'SIGO: bloquea comprobantes de compra confirmados repetidos por identidad canonica, incluso con guiones/espacios/puntos distintos.';
comment on function public.sigo_guard_proveedor_identidad() is
  'SIGO: valida CUIT y bloquea proveedores activos duplicados por CUIT o razon social normalizada con lock transaccional.';
comment on function public.sigo_guard_compra_item_limites() is
  'SIGO: ultima barrera DB contra cantidades/costos de compra fuera de limites operativos.';
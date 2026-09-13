-- SIGO go-live hardening: proveedor/compra/ARCA.
-- No modifica stock ni historicos existentes. Agrega guardas para nuevas escrituras.

create or replace function public.sigo_cuit_argentino_valido(p_cuit text)
returns boolean
language plpgsql
immutable
strict
set search_path = public
as $$
declare
  v_cuit text;
  v_pesos integer[] := array[5,4,3,2,7,6,5,4,3,2];
  v_suma integer := 0;
  v_resto integer;
  v_esperado integer;
  i integer;
begin
  v_cuit := regexp_replace(p_cuit, '[^0-9]', '', 'g');
  if length(v_cuit) <> 11 then
    return false;
  end if;

  for i in 1..10 loop
    v_suma := v_suma + (substr(v_cuit, i, 1)::integer * v_pesos[i]);
  end loop;

  v_resto := 11 - (v_suma % 11);
  v_esperado := case when v_resto = 11 then 0 when v_resto = 10 then 9 else v_resto end;
  return substr(v_cuit, 11, 1)::integer = v_esperado;
exception when others then
  return false;
end;
$$;

comment on function public.sigo_cuit_argentino_valido(text) is
  'SIGO: valida CUIT argentino por longitud y digito verificador, sin consultar servicios externos.';

create or replace function public.sigo_guard_proveedor_integridad()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_cuit text;
begin
  new.razon_social := btrim(coalesce(new.razon_social, ''));
  if new.razon_social = '' then
    raise exception 'SUPPLIER_NAME_REQUIRED';
  end if;

  if nullif(btrim(coalesce(new.cuit, '')), '') is null then
    new.cuit := null;
    return new;
  end if;

  v_cuit := regexp_replace(new.cuit, '[^0-9]', '', 'g');
  if not public.sigo_cuit_argentino_valido(v_cuit) then
    raise exception 'SUPPLIER_CUIT_INVALID';
  end if;
  new.cuit := v_cuit;
  return new;
end;
$$;

drop trigger if exists proveedores_sigo_integridad_guard on public.proveedores_sigo;
create trigger proveedores_sigo_integridad_guard
before insert or update of razon_social, cuit
on public.proveedores_sigo
for each row execute function public.sigo_guard_proveedor_integridad();

create or replace function public.sigo_guard_compra_cabecera_integridad()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_cuit text;
begin
  select p.cuit
    into v_cuit
    from public.proveedores_sigo p
   where p.id = new.proveedor_id
     and p.empresa_id = new.empresa_id
     and p.activo = true;

  if not found then
    raise exception 'SUPPLIER_NOT_FOUND';
  end if;

  if nullif(btrim(coalesce(v_cuit, '')), '') is not null
     and not public.sigo_cuit_argentino_valido(v_cuit) then
    raise exception 'SUPPLIER_CUIT_INVALID';
  end if;

  if new.subtotal is null or new.total is null or new.subtotal < 0 or new.total < 0 then
    raise exception 'PURCHASE_TOTAL_INVALID';
  end if;

  -- El modelo actual no aplica impuestos/descuentos separados: cabecera y detalle deben cerrar.
  if abs(new.total - new.subtotal) > 0.01 then
    raise exception 'PURCHASE_HEADER_TOTAL_MISMATCH';
  end if;

  return new;
end;
$$;

drop trigger if exists compras_sigo_cabecera_integridad_guard on public.compras_sigo;
create trigger compras_sigo_cabecera_integridad_guard
before insert or update of empresa_id, proveedor_id, subtotal, total
on public.compras_sigo
for each row execute function public.sigo_guard_compra_cabecera_integridad();

create or replace function public.sigo_guard_compra_item_integridad()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_producto public.productos%rowtype;
  v_estado_compra text;
begin
  if new.cantidad is null or new.cantidad <= 0 or new.costo_unitario is null or new.costo_unitario < 0 then
    raise exception 'PURCHASE_ITEM_INVALID';
  end if;
  if new.subtotal is null or abs(new.subtotal - round(new.cantidad * new.costo_unitario, 2)) > 0.01 then
    raise exception 'PURCHASE_ITEM_SUBTOTAL_MISMATCH';
  end if;

  select c.estado
    into v_estado_compra
    from public.compras_sigo c
   where c.id = new.compra_id
     and c.empresa_id = new.empresa_id;
  if not found or v_estado_compra <> 'confirmada' then
    raise exception 'PURCHASE_HEADER_NOT_CONFIRMED';
  end if;

  select *
    into v_producto
    from public.productos p
   where p.id = new.producto_id
     and p.empresa_id = new.empresa_id
     and p.activo = true;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;

  if upper(btrim(coalesce(v_producto.categoria, ''))) = 'NO_VENDIBLE' then
    raise exception 'PRODUCT_NOT_SELLABLE';
  end if;
  if upper(btrim(coalesce(v_producto.codigo_interno, ''))) like 'LEGACY-DUP-%'
     or upper(btrim(coalesce(v_producto.codigo_barras, ''))) like 'LEGACY-DUP-%' then
    raise exception 'PRODUCT_IDENTITY_PENDING';
  end if;
  if v_producto.stock_actual is null or v_producto.costo_actual is null then
    raise exception 'PRODUCT_OPERATIONAL_VALUES_REQUIRED';
  end if;

  if exists (
    select 1
      from public.compra_items_sigo ci
     where ci.compra_id = new.compra_id
       and ci.producto_id = new.producto_id
       and ci.id is distinct from new.id
  ) then
    raise exception 'DUPLICATE_PRODUCT_ITEM';
  end if;

  return new;
end;
$$;

drop trigger if exists compra_items_sigo_integridad_guard on public.compra_items_sigo;
create trigger compra_items_sigo_integridad_guard
before insert or update of compra_id, empresa_id, producto_id, cantidad, costo_unitario, subtotal
on public.compra_items_sigo
for each row execute function public.sigo_guard_compra_item_integridad();

create or replace function public.sigo_guard_arca_config_integridad()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_ref text;
  v_config_cambio boolean := false;
begin
  new.cuit_emisor := regexp_replace(coalesce(new.cuit_emisor, ''), '[^0-9]', '', 'g');
  if not public.sigo_cuit_argentino_valido(new.cuit_emisor) then
    raise exception 'ARCA_CUIT_INVALID';
  end if;

  v_ref := lower(btrim(coalesce(new.certificado_ref, '')));
  if v_ref like '%clave fiscal%'
     or v_ref like '%password%'
     or v_ref like '%contrasena%'
     or v_ref like '%contraseña%'
     or v_ref like '%begin private key%'
     or v_ref like '%private key%' then
    raise exception 'ARCA_SECRET_REFERENCE_UNSAFE';
  end if;

  if new.activo then
    if new.ambiente not in ('homologacion', 'produccion') then
      raise exception 'ARCA_ENVIRONMENT_INVALID';
    end if;
    if new.wsaa_service <> 'wsfe' or new.wsfe_version <> 'WSFEv1' then
      raise exception 'ARCA_SERVICE_INVALID';
    end if;
    if v_ref = '' then
      raise exception 'ARCA_CERTIFICATE_REFERENCE_REQUIRED';
    end if;
    if new.certificado_vence is null or new.certificado_vence <= now() then
      raise exception 'ARCA_CERTIFICATE_EXPIRED_OR_MISSING';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    v_config_cambio :=
      new.ambiente is distinct from old.ambiente
      or new.cuit_emisor is distinct from old.cuit_emisor
      or new.certificado_ref is distinct from old.certificado_ref
      or new.certificado_fingerprint is distinct from old.certificado_fingerprint
      or new.certificado_vence is distinct from old.certificado_vence
      or new.wsaa_service is distinct from old.wsaa_service
      or new.wsfe_version is distinct from old.wsfe_version;

    if v_config_cambio then
      -- Una validacion WSAA previa no puede sobrevivir a un cambio de identidad/certificado/servicio.
      new.ultima_prueba_ok := false;
      new.ultima_prueba_at := null;
      new.ultimo_error := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists arca_config_integridad_guard on public.arca_config;
create trigger arca_config_integridad_guard
before insert or update
on public.arca_config
for each row execute function public.sigo_guard_arca_config_integridad();

-- Validacion de despliegue: falla la migracion si las guardas no quedaron instaladas
do $$
declare
  v_missing integer;
  v_invalid_suppliers integer;
  v_bad_purchase_headers integer;
  v_bad_purchase_items integer;
begin
  select count(*) into v_missing
    from (values
      ('proveedores_sigo_integridad_guard'),
      ('compras_sigo_cabecera_integridad_guard'),
      ('compra_items_sigo_integridad_guard'),
      ('arca_config_integridad_guard')
    ) expected(trigger_name)
   where not exists (
     select 1 from pg_trigger t
      where t.tgname = expected.trigger_name and not t.tgisinternal
   );
  if v_missing <> 0 then
    raise exception 'SIGO_GO_LIVE_GUARDS_MISSING count=%', v_missing;
  end if;

  select count(*) into v_invalid_suppliers
    from public.proveedores_sigo p
   where p.activo = true
     and nullif(btrim(coalesce(p.cuit, '')), '') is not null
     and not public.sigo_cuit_argentino_valido(p.cuit);
  if v_invalid_suppliers <> 0 then
    raise exception 'SIGO_ACTIVE_SUPPLIER_CUIT_INVALID count=%', v_invalid_suppliers;
  end if;

  select count(*) into v_bad_purchase_headers
    from public.compras_sigo c
    left join public.proveedores_sigo p
      on p.id = c.proveedor_id and p.empresa_id = c.empresa_id
   where c.estado = 'confirmada'
     and (p.id is null or p.activo <> true or abs(c.total - c.subtotal) > 0.01);
  if v_bad_purchase_headers <> 0 then
    raise exception 'SIGO_PURCHASE_HEADER_INTEGRITY_FAILED count=%', v_bad_purchase_headers;
  end if;

  select count(*) into v_bad_purchase_items
    from public.compra_items_sigo ci
   where ci.cantidad <= 0
      or ci.costo_unitario < 0
      or abs(ci.subtotal - round(ci.cantidad * ci.costo_unitario, 2)) > 0.01;
  if v_bad_purchase_items <> 0 then
    raise exception 'SIGO_PURCHASE_ITEM_INTEGRITY_FAILED count=%', v_bad_purchase_items;
  end if;

  raise notice 'SIGO_GO_LIVE_GUARDS_OK supplier_cuit=CHECKSUM purchase_header=STRICT purchase_items=STRICT arca_config=STRICT';
end
$$;

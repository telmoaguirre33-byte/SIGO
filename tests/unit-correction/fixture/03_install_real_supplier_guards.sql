SET log_min_messages=notice;

SET ROLE postgres;

CREATE OR REPLACE FUNCTION public.sigo_normalizar_identidad_proveedor(p_valor text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.guard_proveedor_cuit_sigo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.sigo_guard_proveedor_identidad()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.sigo_guard_proveedor_integridad()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE TRIGGER proveedores_sigo_integridad_guard BEFORE INSERT OR UPDATE OF razon_social, cuit ON proveedores_sigo FOR EACH ROW EXECUTE FUNCTION sigo_guard_proveedor_integridad();

CREATE TRIGGER trg_guard_proveedor_cuit_sigo BEFORE INSERT OR UPDATE OF empresa_id, cuit, activo ON proveedores_sigo FOR EACH ROW EXECUTE FUNCTION guard_proveedor_cuit_sigo();

CREATE TRIGGER trg_sigo_proveedor_identidad BEFORE INSERT OR UPDATE OF empresa_id, razon_social, cuit, activo ON proveedores_sigo FOR EACH ROW EXECUTE FUNCTION sigo_guard_proveedor_identidad();


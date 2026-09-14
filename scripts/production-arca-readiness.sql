\set ON_ERROR_STOP on

-- SIGO ARCA production readiness: solo lectura.
-- No autentica WSAA ni solicita CAE. Expone exactamente qué falta antes de una emisión real.
-- Los conteos globales no muestran CUIT, certificados ni nombres de empresas: sirven solo para detectar
-- si la configuración fiscal quedó asociada por error a otro tenant.
do $$
declare
  v_empresa_id uuid;
  v_config_count integer := 0;
  v_config_total integer := 0;
  v_config_other_tenant integer := 0;
  v_pv_total integer := 0;
  v_pv_other_tenant integer := 0;
  v_active boolean := false;
  v_ambiente text := null;
  v_cuit_valid boolean := false;
  v_cert_ref boolean := false;
  v_cert_unexpired boolean := false;
  v_wsaa_service_ok boolean := false;
  v_wsfe_version_ok boolean := false;
  v_wsaa_fresh boolean := false;
  v_pv_active integer := 0;
  v_cae_count integer := 0;
  v_last_cae_at timestamptz := null;
begin
  select e.id
    into v_empresa_id
    from public.empresas e
   where lower(btrim(e.nombre)) = lower('SIGO Administración')
     and e.activa = true
   limit 1;

  if v_empresa_id is null then
    raise exception 'SIGO_ARCA_TENANT_NOT_FOUND';
  end if;

  select count(*)
    into v_config_count
    from public.arca_config c
   where c.empresa_id = v_empresa_id;

  select
    count(*),
    count(*) filter (where c.empresa_id <> v_empresa_id)
  into v_config_total, v_config_other_tenant
  from public.arca_config c;

  select
    count(*) filter (where p.activo = true),
    count(*) filter (where p.activo = true and p.empresa_id <> v_empresa_id)
  into v_pv_total, v_pv_other_tenant
  from public.arca_puntos_venta p;

  if v_config_count = 1 then
    select
      c.activo,
      c.ambiente,
      public.sigo_cuit_argentino_valido(c.cuit_emisor),
      nullif(btrim(coalesce(c.certificado_ref, '')), '') is not null,
      c.certificado_vence is not null and c.certificado_vence > now(),
      c.wsaa_service = 'wsfe',
      c.wsfe_version = 'WSFEv1',
      coalesce(c.ultima_prueba_ok, false)
        and c.ultima_prueba_at is not null
        and c.ultima_prueba_at <= now() + interval '5 minutes'
        and c.ultima_prueba_at >= now() - interval '12 hours'
    into
      v_active,
      v_ambiente,
      v_cuit_valid,
      v_cert_ref,
      v_cert_unexpired,
      v_wsaa_service_ok,
      v_wsfe_version_ok,
      v_wsaa_fresh
    from public.arca_config c
   where c.empresa_id = v_empresa_id;

    select count(*)
      into v_pv_active
      from public.arca_puntos_venta p
     where p.empresa_id = v_empresa_id
       and p.activo = true
       and p.ambiente = v_ambiente;
  end if;

  select
    count(*) filter (where nullif(btrim(coalesce(a.cae, '')), '') is not null),
    max(a.emitido_at) filter (where nullif(btrim(coalesce(a.cae, '')), '') is not null)
  into v_cae_count, v_last_cae_at
  from public.arca_comprobantes a
  where a.empresa_id = v_empresa_id;

  raise notice 'SIGO_ARCA_PRODUCTION_STATUS config=% active=% ambiente=% cuit_valid=% cert_ref=% cert_unexpired=% wsaa_service_ok=% wsfe_version_ok=% pv_active=% wsaa_fresh=% cae_count=% last_cae_at=%',
    v_config_count,
    v_active,
    coalesce(v_ambiente, 'SIN_CONFIG'),
    v_cuit_valid,
    v_cert_ref,
    v_cert_unexpired,
    v_wsaa_service_ok,
    v_wsfe_version_ok,
    v_pv_active,
    v_wsaa_fresh,
    v_cae_count,
    coalesce(v_last_cae_at::text, 'NINGUNO');

  raise notice 'SIGO_ARCA_TENANT_DIAGNOSTIC target_config=% total_config=% other_tenant_config=% target_pv=% total_active_pv=% other_tenant_active_pv=%',
    v_config_count,
    v_config_total,
    v_config_other_tenant,
    v_pv_active,
    v_pv_total,
    v_pv_other_tenant;
end
$$;

select 'SIGO_ARCA_READINESS_COMPLETED' as marker;

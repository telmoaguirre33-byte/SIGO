-- SIGO: fail-fast guard para no considerar desplegada la gestión de usuarios
-- si sus RPC críticas no existen en el esquema de producción.
-- No modifica datos comerciales ni históricos.

do $$
begin
  if to_regprocedure('public.listar_usuarios_empresa_sigo(uuid)') is null then
    raise exception 'SIGO_USER_MANAGEMENT_MISSING:listar_usuarios_empresa_sigo';
  end if;
  if to_regprocedure('public.agregar_usuario_empresa_sigo(uuid,text,text)') is null then
    raise exception 'SIGO_USER_MANAGEMENT_MISSING:agregar_usuario_empresa_sigo';
  end if;
  if to_regprocedure('public.actualizar_usuario_empresa_sigo(uuid,uuid,text,boolean)') is null then
    raise exception 'SIGO_USER_MANAGEMENT_MISSING:actualizar_usuario_empresa_sigo';
  end if;
end
$$;

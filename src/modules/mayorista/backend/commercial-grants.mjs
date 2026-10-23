/** DDL de preparación, no ejecutado al importar. Rol backend específico sin BYPASSRLS. */
export function commercialGrants(role){
 if(!/^[a-z][a-z0-9_]{2,62}$/.test(role)||['postgres','supabase_admin','authenticated','anon','service_role'].includes(role))throw Error('COMMERCIAL_ROLE_INVALID');
 return `
CREATE FUNCTION mayorista_private.commercial_principal(u uuid,e uuid,r text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM mayorista.miembros m JOIN mayorista.empresas c USING(empresa_id)
 JOIN mayorista_private.usuarios mu ON mu.user_id=m.user_id AND mu.activo
 JOIN public.empresas se ON se.id=m.empresa_id AND se.activa
 JOIN public.empresa_usuarios su ON su.empresa_id=se.id AND su.user_id=m.user_id AND su.activo
 JOIN public.sigo_empresa_modulos sm ON sm.empresa_id=se.id AND sm.modulo_clave='mayorista_distribuidora' AND sm.habilitado
 JOIN public.sigo_mayorista_comercio_fuente sf ON sf.empresa_id=se.id AND sf.fuente='sigo'
 WHERE m.user_id=u AND m.empresa_id=e AND m.rol=r AND m.activo AND c.habilitada AND
 ((r='gerencia' AND su.rol='owner') OR (r='administracion' AND su.rol IN ('owner','admin')) OR (r IN ('vendedor','armador','chofer') AND su.rol IN ('owner','admin','seller','warehouse'))))
$$;
CREATE FUNCTION mayorista_private.bootstrap_commercial_identity(p_user uuid,p_empresa uuid,p_email text,p_salt text,p_hash text,p_revision text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE company text; shared_role text;
BEGIN
 IF p_revision !~ '^[a-f0-9]{40}$' OR p_salt !~ '^[a-f0-9]{32}$' OR p_hash !~ '^[a-f0-9]{128}$' THEN RAISE EXCEPTION 'IDENTITY_INVALID';END IF;
 SELECT coalesce(to_jsonb(se)->>'nombre','Empresa SIGO'),su.rol INTO company,shared_role FROM public.empresas se
 JOIN public.empresa_usuarios su ON su.empresa_id=se.id AND su.user_id=p_user AND su.activo AND su.rol IN ('owner','admin')
 JOIN auth.users au ON au.id=p_user AND lower(au.email)=p_email
 JOIN public.sigo_empresa_modulos sm ON sm.empresa_id=se.id AND sm.modulo_clave='mayorista_distribuidora' AND sm.habilitado
 WHERE se.id=p_empresa AND se.activa FOR UPDATE OF se;
 IF NOT FOUND THEN RAISE EXCEPTION 'COMMERCIAL_FORBIDDEN' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.sigo_mayorista_comercio_fuente WHERE empresa_id=p_empresa AND fuente<>'sigo') OR
 NOT EXISTS(SELECT 1 FROM public.sigo_mayorista_comercio_fuente WHERE empresa_id=p_empresa) AND
 (EXISTS(SELECT 1 FROM mayorista.productos WHERE empresa_id=p_empresa) OR EXISTS(SELECT 1 FROM mayorista.inventario WHERE empresa_id=p_empresa) OR EXISTS(SELECT 1 FROM mayorista.cuenta_movimientos WHERE empresa_id=p_empresa)) THEN RAISE EXCEPTION 'SOURCE_RECONCILIATION_REQUIRED';END IF;
 IF EXISTS(SELECT 1 FROM mayorista.empresas WHERE empresa_id=p_empresa AND NOT habilitada) OR EXISTS(SELECT 1 FROM mayorista_private.usuarios WHERE user_id=p_user AND NOT activo) OR EXISTS(SELECT 1 FROM mayorista.miembros WHERE empresa_id=p_empresa AND user_id=p_user AND NOT activo) THEN RAISE EXCEPTION 'COMMERCIAL_REVOKED' USING ERRCODE='42501';END IF;
 INSERT INTO mayorista.empresas(empresa_id,nombre,habilitada) VALUES(p_empresa,company,true) ON CONFLICT DO NOTHING;
 INSERT INTO mayorista_private.usuarios(user_id,email,salt,password_hash,nombre) VALUES(p_user,p_email,p_salt,p_hash,p_email) ON CONFLICT(user_id) DO NOTHING;
 INSERT INTO mayorista.miembros(empresa_id,user_id,rol,activo) VALUES(p_empresa,p_user,CASE WHEN shared_role='owner' THEN 'gerencia' ELSE 'administracion' END,true) ON CONFLICT DO NOTHING;
 INSERT INTO public.sigo_mayorista_comercio_fuente(empresa_id,fuente,backend_revision,actor_id) VALUES(p_empresa,'sigo',p_revision,p_user) ON CONFLICT DO NOTHING;
END $$;
CREATE FUNCTION mayorista_private.commercial_directory_scope(e uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM mayorista.miembros m JOIN mayorista_private.sesiones s ON s.user_id=m.user_id AND s.empresa_id=m.empresa_id
 WHERE m.user_id=auth.uid() AND m.empresa_id=e AND m.activo AND m.rol IN ('gerencia','administracion')
 AND s.session_id=nullif(auth.jwt()->>'session_id','')::uuid AND NOT s.revocada AND s.vence_en>now()
 AND mayorista_private.commercial_principal(m.user_id,e,m.rol))
$$;
CREATE FUNCTION mayorista_private.commercial_candidates(e uuid) RETURNS TABLE(id uuid,email text,nombre text,rol text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT mayorista_private.commercial_directory_scope(e) THEN RAISE EXCEPTION 'COMMERCIAL_FORBIDDEN' USING ERRCODE='42501';END IF;
 RETURN QUERY SELECT eu.user_id,au.email,coalesce(au.raw_user_meta_data->>'nombre',au.email),eu.rol::text FROM public.empresa_usuarios eu JOIN auth.users au ON au.id=eu.user_id WHERE eu.empresa_id=e AND eu.activo AND eu.rol IN ('owner','admin','seller','warehouse');
END $$;
REVOKE ALL ON FUNCTION mayorista_private.commercial_candidates(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION mayorista_private.commercial_candidates(uuid) TO ${role};
REVOKE ALL ON FUNCTION mayorista_private.commercial_principal(uuid,uuid,text),mayorista_private.bootstrap_commercial_identity(uuid,uuid,text,text,text,text),mayorista_private.commercial_directory_scope(uuid) FROM PUBLIC,anon,authenticated;
GRANT authenticated TO ${role};
GRANT USAGE ON SCHEMA mayorista_private TO ${role};
GRANT SELECT,INSERT,UPDATE ON mayorista_private.usuarios,mayorista_private.sesiones,mayorista_private.user_commands TO ${role};
GRANT SELECT ON mayorista_private.release_binding,mayorista_private.release_migrations TO ${role};
GRANT EXECUTE ON FUNCTION mayorista_private.commercial_principal(uuid,uuid,text),mayorista_private.bootstrap_commercial_identity(uuid,uuid,text,text,text,text),mayorista_private.commercial_directory_scope(uuid) TO ${role};
CREATE POLICY commercial_directory_backend ON mayorista.miembros FOR SELECT TO ${role} USING(mayorista_private.commercial_directory_scope(empresa_id));
CREATE POLICY commercial_directory_insert ON mayorista.miembros FOR INSERT TO ${role} WITH CHECK(mayorista_private.commercial_directory_scope(empresa_id));
CREATE POLICY commercial_directory_update ON mayorista.miembros FOR UPDATE TO ${role} USING(mayorista_private.commercial_directory_scope(empresa_id)) WITH CHECK(mayorista_private.commercial_directory_scope(empresa_id));
GRANT INSERT,UPDATE ON mayorista.miembros TO ${role};
`;
}

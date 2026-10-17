-- Adición Mayorista. Ejecutar únicamente mediante upgrade-launch-qa con binding QA verificado.
CREATE TABLE mayorista.puesta_marcha(empresa_id uuid PRIMARY KEY REFERENCES mayorista.empresas(empresa_id),version integer NOT NULL DEFAULT 0,datos jsonb NOT NULL DEFAULT '{}',actualizado_por uuid NOT NULL,actualizado_en timestamptz NOT NULL DEFAULT now());
ALTER TABLE mayorista.puesta_marcha ENABLE ROW LEVEL SECURITY;
ALTER TABLE mayorista.puesta_marcha FORCE ROW LEVEL SECURITY;
CREATE POLICY puesta_marcha_read ON mayorista.puesta_marcha FOR SELECT TO authenticated USING(mayorista.operador(empresa_id,array['gerencia','administracion']));
CREATE POLICY puesta_marcha_write ON mayorista.puesta_marcha FOR ALL TO authenticated USING(mayorista.operador(empresa_id,array['gerencia'])) WITH CHECK(mayorista.operador(empresa_id,array['gerencia']) AND actualizado_por=auth.uid());
GRANT SELECT,INSERT,UPDATE ON mayorista.puesta_marcha TO authenticated;
CREATE TABLE mayorista.importaciones(empresa_id uuid NOT NULL REFERENCES mayorista.empresas(empresa_id),importacion_id uuid NOT NULL,tipo text NOT NULL CHECK(tipo IN ('clientes','productos','stock','precios')),huella text NOT NULL,estado text NOT NULL DEFAULT 'preparada',creado_por uuid NOT NULL,creado_en timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(empresa_id,importacion_id),UNIQUE(empresa_id,tipo,huella));
CREATE TABLE mayorista.importacion_filas(empresa_id uuid NOT NULL,importacion_id uuid NOT NULL,fila integer NOT NULL,datos jsonb NOT NULL,estado text NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','error','aplicada')),resultado jsonb,PRIMARY KEY(empresa_id,importacion_id,fila),FOREIGN KEY(empresa_id,importacion_id) REFERENCES mayorista.importaciones(empresa_id,importacion_id));
ALTER TABLE mayorista.importaciones ENABLE ROW LEVEL SECURITY;ALTER TABLE mayorista.importaciones FORCE ROW LEVEL SECURITY;
ALTER TABLE mayorista.importacion_filas ENABLE ROW LEVEL SECURITY;ALTER TABLE mayorista.importacion_filas FORCE ROW LEVEL SECURITY;
CREATE POLICY importaciones_read ON mayorista.importaciones FOR SELECT TO authenticated USING(mayorista.operador(empresa_id,array['gerencia','administracion']));
CREATE POLICY importaciones_insert ON mayorista.importaciones FOR INSERT TO authenticated WITH CHECK(mayorista.operador(empresa_id,array['gerencia','administracion']) AND creado_por=auth.uid());
CREATE POLICY importaciones_update ON mayorista.importaciones FOR UPDATE TO authenticated USING(mayorista.operador(empresa_id,array['gerencia','administracion'])) WITH CHECK(mayorista.operador(empresa_id,array['gerencia','administracion']));
CREATE POLICY importacion_filas_admin ON mayorista.importacion_filas FOR ALL TO authenticated USING(mayorista.operador(empresa_id,array['gerencia','administracion'])) WITH CHECK(mayorista.operador(empresa_id,array['gerencia','administracion']));
GRANT SELECT,INSERT ON mayorista.importaciones TO authenticated;GRANT UPDATE(estado) ON mayorista.importaciones TO authenticated;GRANT SELECT,INSERT,UPDATE ON mayorista.importacion_filas TO authenticated;
CREATE TABLE mayorista.identidades_importacion(empresa_id uuid NOT NULL,tipo text NOT NULL,clave text NOT NULL,registro_id uuid NOT NULL,PRIMARY KEY(empresa_id,tipo,clave));
ALTER TABLE mayorista.identidades_importacion ENABLE ROW LEVEL SECURITY;ALTER TABLE mayorista.identidades_importacion FORCE ROW LEVEL SECURITY;
CREATE POLICY identidades_admin ON mayorista.identidades_importacion FOR ALL TO authenticated USING(mayorista.operador(empresa_id,array['gerencia','administracion'])) WITH CHECK(mayorista.operador(empresa_id,array['gerencia','administracion']));
GRANT SELECT,INSERT ON mayorista.identidades_importacion TO authenticated;
CREATE INDEX pedidos_historial_cursor ON mayorista.pedidos(empresa_id,recibido_en DESC,pedido_id DESC);
CREATE INDEX importacion_filas_pendientes ON mayorista.importacion_filas(empresa_id,importacion_id,estado,fila);
-- Lecturas/escrituras compartidas siguen validando sesión, rol y empresa con el guard aprobado.
CREATE FUNCTION mayorista.padron_clientes(p_empresa uuid,p_busqueda text,p_vendedor uuid,p_ruta uuid,p_zona text,p_offset integer,p_limit integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.sigo_mayorista_operador_comercial(p_empresa);
 IF p_offset<0 OR p_offset>1000000 OR p_limit NOT BETWEEN 1 AND 100 OR length(p_busqueda)>160 THEN RAISE EXCEPTION 'PADRON_INVALID';END IF;
 WITH filtered AS (
 SELECT c.id,c.nombre,c.documento,c.direccion,c.telefono,c.email,c.saldo_actual AS saldo,c.limite_credito AS "limiteCredito",a.vendedor_id AS "vendedorId",a.ruta_id AS "rutaId",a.lista_id AS "listaId",a.habilitado,r.zona,r.nombre AS ruta,v.nombre AS vendedor,
 (SELECT max(o.recibido_en) FROM mayorista.pedidos o WHERE o.empresa_id=p_empresa AND o.cliente_id=c.id) AS "ultimoPedido",
 (SELECT max(vis.recibida_en) FROM mayorista.visitas vis WHERE vis.empresa_id=p_empresa AND vis.cliente_id=c.id) AS "ultimaVisita"
 FROM public.clientes_sigo c LEFT JOIN mayorista.clientes a ON a.empresa_id=c.empresa_id AND a.cliente_id=c.id LEFT JOIN mayorista.rutas r ON r.empresa_id=a.empresa_id AND r.ruta_id=a.ruta_id LEFT JOIN mayorista.vendedores v ON v.empresa_id=a.empresa_id AND v.vendedor_id=a.vendedor_id
 WHERE c.empresa_id=p_empresa AND c.activo AND (p_vendedor IS NULL OR a.vendedor_id=p_vendedor) AND (p_ruta IS NULL OR a.ruta_id=p_ruta) AND (p_zona='' OR r.zona=p_zona)
 AND (p_busqueda='' OR translate(lower(concat_ws(' ',c.nombre,c.documento,c.direccion,c.telefono,c.email,r.zona,r.nombre,v.nombre)),'áéíóúüñ','aeiouun') ILIKE '%'||replace(replace(replace(translate(lower(p_busqueda),'áéíóúüñ','aeiouun'),'\','\\'),'%','\%'),'_','\_')||'%')
 ), page AS (SELECT * FROM filtered ORDER BY lower(nombre),id OFFSET p_offset LIMIT p_limit)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'items',coalesce((SELECT jsonb_agg(page) FROM page),'[]'::jsonb),'offset',p_offset,'limit',p_limit) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION mayorista.padron_clientes(uuid,text,uuid,uuid,text,integer,integer) FROM public,anon;
GRANT EXECUTE ON FUNCTION mayorista.padron_clientes(uuid,text,uuid,uuid,text,integer,integer) TO authenticated;
CREATE FUNCTION mayorista.importar_fila(p_empresa uuid,p_tipo text,p_clave text,p_datos jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE registro uuid; candidatos uuid[]; producto record; n integer; lista uuid; precio uuid; changed boolean:=false;
BEGIN
 PERFORM public.sigo_mayorista_operador_comercial(p_empresa);
 IF NOT public.tiene_permiso_empresa(p_empresa,case when p_tipo='clientes' then 'clients.write' else 'products.write' end) THEN RAISE EXCEPTION 'MAYORISTA_FORBIDDEN';END IF;
 IF p_tipo NOT IN ('clientes','productos','stock','precios') OR length(p_clave) NOT BETWEEN 1 AND 160 OR jsonb_typeof(p_datos)<>'object' THEN RAISE EXCEPTION 'IMPORT_INVALID';END IF;
 IF p_tipo IN ('clientes','productos') AND length(coalesce(p_datos->>'nombre','')) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'Nombre requerido, máximo 160 caracteres';END IF;
 IF p_tipo='productos' AND (coalesce(p_datos->>'precio','') !~ '^[0-9]+([.][0-9]{1,2})?$' OR (p_datos->>'precio')::numeric NOT BETWEEN 0.01 AND 1000000000) THEN RAISE EXCEPTION 'Precio inválido';END IF;
 IF p_tipo='stock' AND (coalesce(p_datos->>'cantidad','') !~ '^[0-9]+$' OR (p_datos->>'cantidad')::numeric NOT BETWEEN 0 AND 1000000) THEN RAISE EXCEPTION 'Stock inválido';END IF;
 PERFORM pg_advisory_xact_lock(hashtext(p_empresa::text),hashtext(case when p_tipo='clientes' then 'clientes' else 'productos' end||p_clave));
 SELECT registro_id INTO registro FROM mayorista.identidades_importacion WHERE empresa_id=p_empresa AND tipo=case when p_tipo='clientes' then 'clientes' else 'productos' end AND clave=p_clave;
 IF p_tipo='clientes' THEN
  IF registro IS NULL THEN
   SELECT array_agg(id) INTO candidatos FROM public.clientes_sigo WHERE empresa_id=p_empresa AND ((nullif(p_datos->>'documento','') IS NOT NULL AND documento=p_datos->>'documento') OR lower(nombre)=lower(p_datos->>'nombre'));
   IF cardinality(candidatos)>1 THEN RAISE EXCEPTION 'Coincidencia ambigua: corregí documento o código';END IF;
   registro:=candidatos[1];
  END IF;
  IF registro IS NULL THEN
   registro:=gen_random_uuid();
   INSERT INTO public.clientes_sigo(id,empresa_id,nombre,documento,direccion,telefono,email,created_by) VALUES(registro,p_empresa,p_datos->>'nombre',nullif(p_datos->>'documento',''),nullif(p_datos->>'direccion',''),nullif(p_datos->>'telefono',''),nullif(p_datos->>'email',''),auth.uid());changed:=true;
  ELSE
   -- Importar nunca pisa crédito, deuda, saldos ni una ficha existente.
   IF NOT EXISTS(SELECT 1 FROM public.clientes_sigo WHERE empresa_id=p_empresa AND id=registro AND activo) THEN RAISE EXCEPTION 'Cliente inactivo o ajeno';END IF;
  END IF;
 ELSE
  IF registro IS NULL THEN
   SELECT array_agg(id) INTO candidatos FROM public.productos WHERE empresa_id=p_empresa AND ((nullif(p_datos->>'codigo','') IS NOT NULL AND lower(codigo_interno)=lower(p_datos->>'codigo')) OR (nullif(p_datos->>'ean','') IS NOT NULL AND codigo_barras=p_datos->>'ean') OR (p_tipo='productos' AND lower(nombre)=lower(p_datos->>'nombre')));
   IF cardinality(candidatos)>1 THEN RAISE EXCEPTION 'Coincidencia ambigua: corregí código o EAN';END IF;
   registro:=candidatos[1];
  END IF;
  IF p_tipo='productos' THEN
   IF registro IS NULL THEN
    registro:=gen_random_uuid();
    INSERT INTO public.productos(id,empresa_id,nombre,codigo_interno,codigo_barras,marca,precio_venta,stock_actual,activo) VALUES(registro,p_empresa,p_datos->>'nombre',nullif(p_datos->>'codigo',''),nullif(p_datos->>'ean',''),nullif(p_datos->>'marca',''),(p_datos->>'precio')::numeric,0,true);changed:=true;
   END IF;
  ELSE
   IF registro IS NULL THEN RAISE EXCEPTION 'Producto no encontrado: importá primero el catálogo';END IF;
   SELECT * INTO producto FROM public.productos WHERE empresa_id=p_empresa AND id=registro AND activo FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Producto inactivo o ajeno';END IF;
   IF p_tipo='stock' THEN
    -- Apertura exclusivamente: nunca sobreescribe stock comercial ni ignora reservas/pedidos.
    IF producto.stock_actual<>0 OR EXISTS(SELECT 1 FROM public.venta_items_sigo WHERE empresa_id=p_empresa AND producto_id=registro) OR EXISTS(SELECT 1 FROM mayorista.pedidos o CROSS JOIN LATERAL jsonb_array_elements(o.lineas) l WHERE o.empresa_id=p_empresa AND l->>'productoId'=registro::text) THEN RAISE EXCEPTION 'Producto con stock o movimientos: usá el ajuste operativo con revisión';END IF;
    UPDATE public.productos SET stock_actual=(p_datos->>'cantidad')::numeric WHERE empresa_id=p_empresa AND id=registro;changed:=true;
   ELSIF p_tipo='precios' THEN
    SELECT count(*),min(lista_id::text)::uuid INTO n,lista FROM mayorista.listas WHERE empresa_id=p_empresa AND nombre=p_datos->>'lista' AND activa;
    IF n<>1 THEN RAISE EXCEPTION 'Creá o seleccioná una lista activa con nombre único';END IF;
    SELECT precio_id INTO precio FROM public.sigo_mayorista_presentaciones WHERE empresa_id=p_empresa AND producto_id=registro AND lista_id=lista AND presentacion=p_datos->>'presentacion' LIMIT 1;
    PERFORM public.configurar_precio_mayorista_sigo(p_empresa,jsonb_build_object('tipo','presentacion','id',coalesce(precio,gen_random_uuid()),'productoId',registro,'listaId',lista,'presentacion',p_datos->>'presentacion','unidadesBase',p_datos->'unidadesBase','ajustePorcentaje',p_datos->'ajuste','desde',now(),'hasta',now()+interval '10 years','activa',true));changed:=true;
   END IF;
  END IF;
 END IF;
 INSERT INTO mayorista.identidades_importacion(empresa_id,tipo,clave,registro_id) VALUES(p_empresa,case when p_tipo='clientes' then 'clientes' else 'productos' end,p_clave,registro) ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('registroId',registro,'accion',case when changed then 'creada' else 'existente_conservado' end);
END $$;
REVOKE ALL ON FUNCTION mayorista.importar_fila(uuid,text,text,jsonb) FROM public,anon;
GRANT EXECUTE ON FUNCTION mayorista.importar_fila(uuid,text,text,jsonb) TO authenticated;
CREATE FUNCTION mayorista.resumen_puesta_marcha(p_empresa uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.sigo_mayorista_operador_comercial(p_empresa);
 RETURN jsonb_build_object('productos',(SELECT count(*) FROM public.productos WHERE empresa_id=p_empresa AND activo AND precio_venta>0),'clientes',(SELECT count(*) FROM public.clientes_sigo WHERE empresa_id=p_empresa AND activo),'roles',(SELECT count(DISTINCT rol) FROM mayorista.miembros WHERE empresa_id=p_empresa AND activo));
END $$;
REVOKE ALL ON FUNCTION mayorista.resumen_puesta_marcha(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION mayorista.resumen_puesta_marcha(uuid) TO authenticated;

-- Misma firma, guard y proyección del lector aprobado: elimina búsquedas JSON cuadráticas.
create or replace function public.leer_catalogo_mayorista_sigo_base(p_empresa_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_rol text;v_vendedor uuid;
begin
 v_rol:=public.sigo_mayorista_lector(p_empresa_id);
 if v_rol not in ('owner','admin','vendedor') then raise exception 'CATALOG_FORBIDDEN';end if;
 select m.vendedor_id into v_vendedor from mayorista.miembros m where m.empresa_id=p_empresa_id and m.user_id=auth.uid() and m.activo;
 if v_rol='vendedor' and v_vendedor is null then raise exception 'SELLER_REQUIRED';end if;
 if to_regclass('public.sigo_mayorista_presentaciones') is null and exists(select 1 from mayorista.clientes a where a.empresa_id=p_empresa_id and a.habilitado and (v_rol<>'vendedor' or a.vendedor_id=v_vendedor) and a.lista_id is not null) then raise exception 'SHARED_PRICE_LIST_NOT_READY';end if;
 return jsonb_build_object('empresaId',p_empresa_id,'vendedorId',v_vendedor,'descargadoEn',now(),
 'clientes',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'nombre',c.nombre,'direccion',c.direccion,'vendedorId',a.vendedor_id,'rutaId',a.ruta_id,'listaId',a.lista_id,'latitud',a.latitud,'longitud',a.longitud,'habilitado',coalesce(a.habilitado,false),'orden',coalesce(meta.orden,0),'telefono',c.telefono,'documento',c.documento,'limiteCredito',c.limite_credito,'saldo',c.saldo_actual)) from public.clientes_sigo c left join (select x.id,x.orden from mayorista.administracion plan cross join lateral jsonb_to_recordset(plan.datos->'clientes') x(id uuid,orden integer) where plan.empresa_id=p_empresa_id) meta on meta.id=c.id left join mayorista.clientes a on a.empresa_id=c.empresa_id and a.cliente_id=c.id where c.empresa_id=p_empresa_id and c.activo and (v_rol<>'vendedor' or (a.habilitado and a.vendedor_id=v_vendedor))),'[]'::jsonb),
 'productos',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'nombre',p.nombre,'marca',to_jsonb(p)->>'marca','codigoInterno',to_jsonb(p)->>'codigo_interno','ean',to_jsonb(p)->>'codigo_barras')) from public.productos p where p.empresa_id=p_empresa_id and p.activo and p.precio_venta>0),'[]'::jsonb),
 'precios',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'productoId',p.id,'listaId',null,'presentacion','unidad','unidadesBase',1,'precioBase',p.precio_venta,'precio',round(p.precio_venta*(1-coalesce((select o.descuento_porcentaje from public.ofertas_productos_sigo o where o.empresa_id=p_empresa_id and o.producto_id=p.id and o.fecha_inicio<=(now() at time zone 'America/Argentina/Cordoba')::date and o.fecha_fin>=(now() at time zone 'America/Argentina/Cordoba')::date limit 1),0)/100),2))) from public.productos p where p.empresa_id=p_empresa_id and p.activo and p.precio_venta>0),'[]'::jsonb),
 'rutas',coalesce((select jsonb_agg(jsonb_build_object('id',r.ruta_id,'nombre',r.nombre,'zona',r.zona,'dias',coalesce(meta.dias,'[]'::jsonb))) from mayorista.rutas r left join (select x.id,x.dias from mayorista.administracion plan cross join lateral jsonb_to_recordset(plan.datos->'rutas') x(id uuid,dias jsonb) where plan.empresa_id=p_empresa_id) meta on meta.id=r.ruta_id where r.empresa_id=p_empresa_id and (v_rol<>'vendedor' or exists(select 1 from mayorista.clientes a where a.empresa_id=p_empresa_id and a.ruta_id=r.ruta_id and a.vendedor_id=v_vendedor and a.habilitado))),'[]'::jsonb),'ofertas','[]'::jsonb,'objetivos','[]'::jsonb);
end $$;

REVOKE ALL ON FUNCTION public.leer_catalogo_mayorista_sigo_base(uuid) FROM public,anon,authenticated;
CREATE TABLE mayorista.suscripciones(empresa_id uuid PRIMARY KEY REFERENCES mayorista.empresas(empresa_id),version integer NOT NULL,datos jsonb NOT NULL,actualizado_por uuid NOT NULL,actualizado_en timestamptz NOT NULL DEFAULT now());
ALTER TABLE mayorista.suscripciones ENABLE ROW LEVEL SECURITY;ALTER TABLE mayorista.suscripciones FORCE ROW LEVEL SECURITY;
CREATE POLICY suscripcion_read ON mayorista.suscripciones FOR SELECT TO authenticated USING(mayorista.operador(empresa_id,array['gerencia','administracion']));
CREATE POLICY suscripcion_write ON mayorista.suscripciones FOR ALL TO authenticated USING(mayorista.operador(empresa_id,array['gerencia'])) WITH CHECK(mayorista.operador(empresa_id,array['gerencia']) AND actualizado_por=auth.uid());
GRANT SELECT,INSERT,UPDATE ON mayorista.suscripciones TO authenticated;
CREATE FUNCTION mayorista.fichas_asignacion(p_empresa uuid,p_ids uuid[]) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.sigo_mayorista_operador_comercial(p_empresa);
 IF cardinality(p_ids) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'ASSIGNMENT_LIMIT';END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'nombre',nombre,'direccion',coalesce(nullif(direccion,''),'Sin dirección registrada'))) FROM public.clientes_sigo WHERE empresa_id=p_empresa AND id=ANY(p_ids) AND activo),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION mayorista.fichas_asignacion(uuid,uuid[]) FROM public,anon;
GRANT EXECUTE ON FUNCTION mayorista.fichas_asignacion(uuid,uuid[]) TO authenticated;

-- El panel no necesita cotizar 5.000 productos: conserva la proyección y guard del lector de métricas.
create or replace function public.leer_metricas_mayorista_sigo(p_empresa_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_rol text;v_vendedor uuid;v_catalogo jsonb;v_facturas jsonb:=null;v_ledger jsonb:='[]';v_stock jsonb:='[]';v_devoluciones jsonb:='[]';
begin
 v_rol:=public.sigo_mayorista_lector(p_empresa_id);
 if v_rol not in ('owner','admin','vendedor') then raise exception 'METRICS_FORBIDDEN';end if;
 select m.vendedor_id into v_vendedor from mayorista.miembros m where m.empresa_id=p_empresa_id and m.user_id=auth.uid() and m.activo;
 if v_rol='vendedor' and v_vendedor is null then raise exception 'SELLER_REQUIRED';end if;
 v_catalogo:=jsonb_build_object('clientes',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'nombre',c.nombre,'direccion',c.direccion,'vendedorId',a.vendedor_id,'rutaId',a.ruta_id,'listaId',a.lista_id,'latitud',a.latitud,'longitud',a.longitud,'habilitado',coalesce(a.habilitado,false),'orden',coalesce(meta.orden,0),'telefono',c.telefono,'documento',c.documento,'limiteCredito',c.limite_credito,'saldo',c.saldo_actual)) from public.clientes_sigo c left join (select x.id,x.orden from mayorista.administracion plan cross join lateral jsonb_to_recordset(plan.datos->'clientes') x(id uuid,orden integer) where plan.empresa_id=p_empresa_id) meta on meta.id=c.id left join mayorista.clientes a on a.empresa_id=c.empresa_id and a.cliente_id=c.id where c.empresa_id=p_empresa_id and c.activo and (v_rol<>'vendedor' or (a.habilitado and a.vendedor_id=v_vendedor))),'[]'::jsonb),
 'productos',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'nombre',p.nombre,'marca',to_jsonb(p)->>'marca','codigoInterno',to_jsonb(p)->>'codigo_interno','ean',to_jsonb(p)->>'codigo_barras')) from public.productos p where p.empresa_id=p_empresa_id and p.activo and p.precio_venta>0),'[]'::jsonb));
 if to_regclass('public.arca_comprobantes') is not null then
  select coalesce(jsonb_agg(jsonb_build_object('empresaId',p_empresa_id,'pedidoId',e.pedido_id,'clienteId',e.cliente_id,'vendedorId',e.vendedor_id,'rutaId',e.ruta_id,'fecha',a.emitido_at,'estado','confirmada','centavos',(v.total*100)::bigint)),'[]') into v_facturas
  from public.arca_comprobantes a join public.sigo_mayorista_entregas_comerciales e on e.empresa_id=a.empresa_id and e.venta_id=a.venta_id join public.ventas_sigo v on v.id=a.venta_id and v.empresa_id=a.empresa_id
  where a.empresa_id=p_empresa_id and a.cae~'^[0-9]{14}$' and a.resultado='A' and (v_rol<>'vendedor' or e.vendedor_id=v_vendedor);
 end if;
 if v_rol in ('owner','admin','vendedor') then
  select coalesce(jsonb_agg(jsonb_build_object('clienteId',m.cliente_id,'tipo',case when m.tipo='haber' and nullif(to_jsonb(m)->>'devolucion_id','') is null then case when v_rol<>'vendedor' or m.created_by=auth.uid() then 'cobranza' else 'cobranza_otro' end when m.tipo='haber' then 'credito_devolucion' else 'debito' end,'centavos',(m.importe*100*(case when m.tipo='haber' then -1 else 1 end))::bigint,'fecha',m.created_at)),'[]') into v_ledger
  from public.cliente_movimientos_sigo m where m.empresa_id=p_empresa_id and exists(select 1 from mayorista.clientes c where c.empresa_id=p_empresa_id and c.cliente_id=m.cliente_id and c.habilitado and (v_rol<>'vendedor' or c.vendedor_id=v_vendedor));
  if v_rol in ('owner','admin') then v_stock:=public.leer_stock_mayorista_sigo(p_empresa_id)->'productos';end if;
 end if;
 if to_regclass('public.devoluciones_sigo') is not null then
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'eventoId',control.comando_id,'empresaId',p_empresa_id,'pedidoId',e.pedido_id,'clienteId',e.cliente_id,'vendedorId',e.vendedor_id,'rutaId',e.ruta_id,'fecha',d.created_at,'tipo','devolucion','centavos',(d.total*100)::bigint,'unidades',(select sum(i.cantidad) from public.devolucion_items_sigo i where i.empresa_id=p_empresa_id and i.devolucion_id=d.id),'lineas',(select jsonb_agg(jsonb_build_object('productoId',i.producto_id,'unidades',i.cantidad,'centavos',(i.subtotal*100)::bigint)) from public.devolucion_items_sigo i where i.empresa_id=p_empresa_id and i.devolucion_id=d.id))),'[]') into v_devoluciones from public.devoluciones_sigo d join public.sigo_mayorista_entregas_comerciales e on e.empresa_id=d.empresa_id and e.venta_id=d.venta_id left join public.sigo_mayorista_devoluciones_control control on control.empresa_id=d.empresa_id and control.devolucion_id=d.id where d.empresa_id=p_empresa_id and (v_rol<>'vendedor' or e.vendedor_id=v_vendedor);
  if v_facturas is not null then select v_facturas||coalesce(jsonb_agg(jsonb_build_object('empresaId',p_empresa_id,'pedidoId',e.pedido_id,'clienteId',e.cliente_id,'vendedorId',e.vendedor_id,'rutaId',e.ruta_id,'fecha',a.emitido_at,'estado','confirmada','centavos',(-d.total*100)::bigint)),'[]') into v_facturas from public.arca_comprobantes a join public.sigo_mayorista_devoluciones_control control on control.empresa_id=a.empresa_id and (control.nota_credito->>'comprobanteId')::uuid=a.id join public.devoluciones_sigo d on d.empresa_id=control.empresa_id and d.id=control.devolucion_id join public.sigo_mayorista_entregas_comerciales e on e.empresa_id=control.empresa_id and e.venta_id=control.venta_id where a.empresa_id=p_empresa_id and a.cae~'^[0-9]{14}$' and a.resultado='A' and (v_rol<>'vendedor' or e.vendedor_id=v_vendedor);end if;
 end if;
 return jsonb_build_object('empresaId',p_empresa_id,'customers',v_catalogo->'clientes','products',v_catalogo->'productos','personalLedgerAvailable',v_rol='vendedor','confirmedReturns',v_devoluciones,'invoices',v_facturas,'ledger',v_ledger,'collections','[]'::jsonb,'inventory',v_stock,
 'sales',coalesce((select jsonb_agg(jsonb_build_object('empresaId',p_empresa_id,'pedidoId',e.pedido_id,'clienteId',e.cliente_id,'vendedorId',e.vendedor_id,'rutaId',e.ruta_id,'fecha',v.created_at,'estado',v.estado,'centavos',((v.total-coalesce((select sum(d.total) from public.devoluciones_sigo d where d.empresa_id=p_empresa_id and d.venta_id=v.id),0))*100)::bigint,'unidades',(select sum(i.cantidad-coalesce((select sum(d.cantidad) from public.devolucion_items_sigo d where d.empresa_id=p_empresa_id and d.venta_item_id=i.id),0)) from public.venta_items_sigo i where i.empresa_id=p_empresa_id and i.venta_id=v.id)))
 from public.sigo_mayorista_entregas_comerciales e join public.ventas_sigo v on v.id=e.venta_id and v.empresa_id=e.empresa_id where e.empresa_id=p_empresa_id and e.estado='confirmado' and (v_rol<>'vendedor' or e.vendedor_id=v_vendedor)),'[]'::jsonb));
end $$;

REVOKE ALL ON FUNCTION public.leer_metricas_mayorista_sigo(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.leer_metricas_mayorista_sigo(uuid) TO authenticated;

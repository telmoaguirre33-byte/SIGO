-- PREPARADO, NO EJECUTADO. PR78 a1d36afc1ab4ddbfc04a08ed587142c9f76a9c9b.
-- Sólo pg_catalog/information_schema. Sin SELECT sobre filas comerciales,
-- sin llamadas a RPC de aplicación, sin DDL/DML ni lectura de hashes de usuarios.
-- Ejecutar sólo por operador en el destino autorizado. No demuestra compatibilidad por sí solo.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='3s';

SELECT current_database() AS database_name,current_user AS executor_role,
 current_setting('server_version') AS postgres_version,
 current_setting('transaction_read_only') AS read_only;

-- 1. Contrato de tablas y columnas empleado por las 21 versiones y sus funciones.
-- Las familias de tipo son un filtro: precision, escala, NULL, defaults, enums y
-- checks se revisan con los resultados posteriores. REVIEW no autoriza corrección automática.
WITH spec(relation,columns_spec) AS (VALUES
 ('auth.users','id:uuid email:string raw_user_meta_data:jsonb'),
 ('auth.sessions','id:uuid user_id:uuid'),
 ('public.empresas','id:uuid activa:boolean'),
 ('public.empresa_usuarios','empresa_id:uuid user_id:uuid activo:boolean rol:string'),
 ('public.sigo_modulos_catalogo','clave:string nombre:string descripcion:string categoria:string disponible:boolean obligatorio:boolean orden:integer'),
 ('public.sigo_empresa_modulos','empresa_id:uuid modulo_clave:string habilitado:boolean actualizado_por:uuid updated_at:timestamp'),
 ('public.productos','id:uuid empresa_id:uuid nombre:string precio_venta:numeric stock_actual:numeric activo:boolean marca:string codigo_interno:string codigo_barras:string'),
 ('public.clientes_sigo','id:uuid empresa_id:uuid nombre:string direccion:string telefono:string documento:string email:string activo:boolean limite_credito:numeric saldo_actual:numeric created_by:uuid updated_at:timestamp'),
 ('public.ventas_sigo','id:uuid empresa_id:uuid cliente_id:uuid total:numeric medio_pago:string idempotency_key:string request_fingerprint:string created_by:uuid created_at:timestamp estado:string anulada_at:timestamp anulada_by:uuid motivo_anulacion:string'),
 ('public.venta_items_sigo','id:uuid empresa_id:uuid venta_id:uuid producto_id:uuid cantidad:numeric precio_unitario:numeric subtotal:numeric'),
 ('public.cliente_movimientos_sigo','id:uuid empresa_id:uuid cliente_id:uuid venta_id:uuid devolucion_id:uuid tipo:string importe:numeric concepto:string created_by:uuid created_at:timestamp'),
 ('public.caja_movimientos_sigo','empresa_id:uuid venta_id:uuid tipo:string medio_pago:string importe:numeric concepto:string created_by:uuid'),
 ('public.ofertas_productos_sigo','empresa_id:uuid producto_id:uuid descuento_porcentaje:numeric fecha_inicio:date fecha_fin:date'),
 ('public.devoluciones_sigo','id:uuid empresa_id:uuid venta_id:uuid tipo:string total:numeric motivo:string idempotency_key:string created_by:uuid created_at:timestamp'),
 ('public.devolucion_items_sigo','devolucion_id:uuid empresa_id:uuid venta_item_id:uuid producto_id:uuid cantidad:numeric precio_unitario:numeric subtotal:numeric'),
 ('public.arca_comprobantes','id:uuid empresa_id:uuid venta_id:uuid punto_venta:integer tipo_cbte:integer numero_cbte:integer resultado:string request_id:string observaciones:jsonb cae:string cae_vencimiento:date emitido_at:timestamp')
), required AS (
 SELECT relation,split_part(token,':',1) AS column_name,split_part(token,':',2) AS family
 FROM spec CROSS JOIN LATERAL unnest(string_to_array(columns_spec,' ')) token
), actual AS (
 SELECT r.*,c.oid AS relation_oid,c.relkind,a.attnum,a.atttypid,t.typname,t.typtype,
 format_type(a.atttypid,a.atttypmod) AS actual_type,a.attnotnull,a.attidentity,a.attgenerated,
 pg_get_expr(d.adbin,d.adrelid) AS default_expression
 FROM required r LEFT JOIN pg_class c ON c.oid=to_regclass(r.relation)
 LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname=r.column_name AND a.attnum>0 AND NOT a.attisdropped
 LEFT JOIN pg_type t ON t.oid=a.atttypid
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
)
SELECT relation,column_name,family,actual_type,attnotnull,attidentity,attgenerated,default_expression,
 CASE WHEN relation_oid IS NULL THEN 'BLOCK_MISSING_RELATION'
 WHEN relkind NOT IN ('r','p') THEN 'REVIEW_RELATION_KIND'
 WHEN attnum IS NULL THEN 'BLOCK_MISSING_COLUMN'
 WHEN family='uuid' AND typname='uuid' OR family='boolean' AND typname='bool'
 OR family='string' AND typname IN ('text','varchar','bpchar','citext')
 OR family='numeric' AND typname='numeric'
 OR family='integer' AND typname IN ('int2','int4','int8')
 OR family='date' AND typname='date'
 OR family='timestamp' AND typname IN ('timestamp','timestamptz')
 OR family='jsonb' AND typname='jsonb' THEN 'PRESENT_REVIEW_CONSTRAINTS'
 ELSE 'REVIEW_TYPE_DOMAIN_OR_ENUM' END AS status
FROM actual ORDER BY relation,column_name;

-- 2. Todas las columnas reales: detecta NOT NULL extra sin default que rompería INSERT.
-- Se evalúa cada forma de INSERT por separado; un valor default no demuestra que un CHECK lo acepte.
WITH inserts(operation,relation,supplied) AS (VALUES
 ('catalog_module','public.sigo_modulos_catalogo',ARRAY['clave','nombre','descripcion','categoria','disponible','obligatorio','orden']),
 ('activation_flag','public.sigo_empresa_modulos',ARRAY['empresa_id','modulo_clave','habilitado','actualizado_por','updated_at']),
 ('sale','public.ventas_sigo',ARRAY['empresa_id','cliente_id','total','medio_pago','idempotency_key','request_fingerprint','created_by']),
 ('sale_item','public.venta_items_sigo',ARRAY['venta_id','empresa_id','producto_id','cantidad','precio_unitario','subtotal']),
 ('account_sale','public.cliente_movimientos_sigo',ARRAY['empresa_id','cliente_id','venta_id','tipo','importe','concepto','created_by']),
 ('account_collection','public.cliente_movimientos_sigo',ARRAY['empresa_id','cliente_id','tipo','importe','concepto','created_by']),
 ('account_return','public.cliente_movimientos_sigo',ARRAY['empresa_id','cliente_id','venta_id','devolucion_id','tipo','importe','concepto','created_by']),
 ('cash_sale','public.caja_movimientos_sigo',ARRAY['empresa_id','venta_id','tipo','medio_pago','importe','concepto','created_by']),
 ('cash_collection','public.caja_movimientos_sigo',ARRAY['empresa_id','tipo','medio_pago','importe','concepto','created_by']),
 ('return','public.devoluciones_sigo',ARRAY['empresa_id','venta_id','tipo','total','motivo','idempotency_key','created_by']),
 ('return_item','public.devolucion_items_sigo',ARRAY['devolucion_id','empresa_id','venta_item_id','producto_id','cantidad','precio_unitario','subtotal']),
 ('credit_note_reservation','public.arca_comprobantes',ARRAY['empresa_id','punto_venta','tipo_cbte','numero_cbte','resultado','request_id','observaciones']),
 ('import_client','public.clientes_sigo',ARRAY['id','empresa_id','nombre','documento','direccion','telefono','email','created_by']),
 ('import_product','public.productos',ARRAY['id','empresa_id','nombre','codigo_interno','codigo_barras','marca','precio_venta','stock_actual','activo'])
)
SELECT i.operation,i.relation,a.attname AS omitted_required_column,format_type(a.atttypid,a.atttypmod) AS type,
 'BLOCK_INSERT_REQUIRES_REHEARSAL' AS status
FROM inserts i JOIN pg_attribute a ON a.attrelid=to_regclass(i.relation)
LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
WHERE a.attnum>0 AND NOT a.attisdropped AND a.attnotnull AND a.attidentity='' AND a.attgenerated=''
 AND d.oid IS NULL AND NOT a.attname=ANY(i.supplied)
ORDER BY i.operation,a.attnum;

-- 3. Firmas exactas invocadas. No se ejecuta ninguna función de aplicación.
WITH required(signature,expected_return) AS (VALUES
 ('auth.uid()','uuid'),('auth.jwt()','jsonb'),('pg_catalog.gen_random_uuid()','uuid'),
 ('public.es_superadmin_sigo()','boolean'),
 ('public.tiene_permiso_empresa(uuid,text)','boolean'),
 ('public.registrar_cobro_cliente_sigo_v2(uuid,uuid,numeric,text,text)','uuid'),
 ('public.registrar_devolucion_sigo(uuid,uuid,jsonb,text,text,boolean)','uuid')
)
SELECT r.signature,r.expected_return,p.oid IS NOT NULL AS present,
 pg_get_function_result(p.oid) AS actual_return,pg_get_userbyid(p.proowner) AS owner,
 p.prosecdef AS security_definer,p.provolatile,p.proconfig,p.proacl,
 md5(pg_get_functiondef(p.oid)) AS definition_fingerprint_md5
FROM required r LEFT JOIN pg_proc p ON p.oid=to_regprocedure(r.signature)
ORDER BY r.signature;

-- 4. Índices, constraints, triggers y políticas reales de tablas compartidas.
-- Revisar PK/UNIQUE(id) en empresas/productos/clientes_sigo/ventas_sigo/
-- cliente_movimientos_sigo/devoluciones_sigo/auth.users (FK nuevas referencian sólo id).
-- Revisar UNIQUE(clave) catálogo y UNIQUE(empresa_id,modulo_clave) flags para ON CONFLICT.
-- Ventas: defaults de id/estado/created_at; pagos efectivo/transferencia/cuenta_corriente.
-- Movimientos: debe/haber; Caja: ingreso; devolución: parcial/total y anulada en venta.
-- NC: venta_id puede omitirse; resultado acepta reservado/A; request_id permite prefijo mayorista_nc:.
WITH names AS (SELECT unnest(ARRAY['auth.users','auth.sessions','public.empresas','public.empresa_usuarios',
 'public.sigo_modulos_catalogo','public.sigo_empresa_modulos','public.productos','public.clientes_sigo',
 'public.ventas_sigo','public.venta_items_sigo','public.cliente_movimientos_sigo','public.caja_movimientos_sigo',
 'public.ofertas_productos_sigo','public.devoluciones_sigo','public.devolucion_items_sigo','public.arca_comprobantes']) AS name)
SELECT n.name,c.relkind,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity,c.relacl
FROM names n LEFT JOIN pg_class c ON c.oid=to_regclass(n.name) ORDER BY n.name;

SELECT n.nspname AS schema_name,c.relname,k.conname,k.contype,k.convalidated,pg_get_constraintdef(k.oid,true) AS definition
FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('empresas','empresa_usuarios','sigo_modulos_catalogo','sigo_empresa_modulos',
 'productos','clientes_sigo','ventas_sigo','venta_items_sigo','cliente_movimientos_sigo','caja_movimientos_sigo',
 'ofertas_productos_sigo','devoluciones_sigo','devolucion_items_sigo','arca_comprobantes')
 OR n.nspname='auth' AND c.relname IN ('users','sessions') ORDER BY 1,2,3;

SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename IN ('empresas','empresa_usuarios','sigo_modulos_catalogo','sigo_empresa_modulos',
 'productos','clientes_sigo','ventas_sigo','venta_items_sigo','cliente_movimientos_sigo','caja_movimientos_sigo',
 'ofertas_productos_sigo','devoluciones_sigo','devolucion_items_sigo','arca_comprobantes') ORDER BY 1,2,3;

SELECT n.nspname AS schema_name,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true) AS definition,
 p.oid::regprocedure AS trigger_function,md5(pg_get_functiondef(p.oid)) AS function_fingerprint_md5
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname IN ('empresas','empresa_usuarios','sigo_modulos_catalogo',
 'sigo_empresa_modulos','productos','clientes_sigo','ventas_sigo','venta_items_sigo','cliente_movimientos_sigo',
 'caja_movimientos_sigo','ofertas_productos_sigo','devoluciones_sigo','devolucion_items_sigo','arca_comprobantes') ORDER BY 1,2,3;

SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename IN ('empresas','empresa_usuarios','sigo_modulos_catalogo','sigo_empresa_modulos',
 'productos','clientes_sigo','ventas_sigo','venta_items_sigo','cliente_movimientos_sigo','caja_movimientos_sigo',
 'ofertas_productos_sigo','devoluciones_sigo','devolucion_items_sigo','arca_comprobantes') ORDER BY 1,2,3;

-- 5. Colisiones y estado administrado. No leer filas del módulo ni usuarios.
-- Si existe Mayorista sin release_migrations: abortar y reconciliar por separado.
SELECT nspname,pg_get_userbyid(nspowner) AS owner,nspacl FROM pg_namespace
WHERE nspname IN ('mayorista','mayorista_private','public','auth') ORDER BY nspname;
SELECT n.nspname AS schema_name,c.relname,c.relkind,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('mayorista','mayorista_private') OR n.nspname='public'
 AND (c.relname LIKE 'sigo_mayorista_%' OR c.relname='sigo_empresa_tipo_negocio') ORDER BY 1,2;
SELECT n.nspname AS schema_name,p.oid::regprocedure AS function_name,pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig,p.proacl,
 md5(pg_get_functiondef(p.oid)) AS definition_fingerprint_md5
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE p.prokind='f' AND (n.nspname IN ('mayorista','mayorista_private') OR n.nspname='public'
 AND (p.proname LIKE '%mayorista%' OR p.proname IN ('leer_tipo_negocio_sigo','declarar_tipo_negocio_sigo')))
ORDER BY 1,2;

-- 6. Roles: completar ambos NULL localmente con nombres revisados antes de usar.
-- No se presupone que el rol runtime productivo exista o se llame como QA.
WITH chosen(kind,role_name) AS (VALUES ('runtime',NULL::text),('migration',NULL::text))
SELECT chosen.kind,chosen.role_name,r.rolname IS NOT NULL AS present,r.rolsuper,r.rolbypassrls,r.rolcanlogin,r.rolinherit,r.rolcreaterole,r.rolcreatedb
FROM chosen LEFT JOIN pg_roles r ON r.rolname=chosen.role_name;
SELECT rolname,rolsuper,rolbypassrls,rolcanlogin,rolinherit,rolcreaterole,rolcreatedb FROM pg_roles
WHERE rolname IN ('anon','authenticated',current_user) ORDER BY rolname;
SELECT parent.rolname AS granted_role,child.rolname AS member,m.admin_option
FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles child ON child.oid=m.member
ORDER BY 1,2;
ROLLBACK;

SET log_min_messages=notice;

SET ROLE postgres;

INSERT INTO auth.users(id) VALUES ('20000000-0000-0000-0000-000000000001'),('20000000-0000-0000-0000-000000000002'),('20000000-0000-0000-0000-000000000003'),('20000000-0000-0000-0000-000000000004');

INSERT INTO empresas(id,nombre,created_by) VALUES ('10000000-0000-0000-0000-000000000001','Empresa sintética A','20000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002','Empresa sintética B','20000000-0000-0000-0000-000000000002');

INSERT INTO empresa_usuarios(empresa_id,user_id,rol) VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','owner'),('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','owner'),('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','seller'),('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','warehouse');

SELECT set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',false);

INSERT INTO clientes_sigo(id,empresa_id,nombre,limite_credito) VALUES ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Cliente sintético',100000);

INSERT INTO proveedores_sigo(id,empresa_id,razon_social) VALUES ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Proveedor sintético 1');

INSERT INTO productos(id,empresa_id,codigo_interno,nombre,unidad_medida,precio_venta,costo_actual,costo_ultima_compra,stock_actual) VALUES ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','SYN-1','Producto sintético 1','kg',100,4,4,10);

INSERT INTO productos(id,empresa_id,codigo_interno,nombre,unidad_medida,precio_venta,costo_actual,costo_ultima_compra,stock_actual) VALUES ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','SYN-2','Producto sintético 2','m',100,4,4,10);

INSERT INTO productos(id,empresa_id,codigo_interno,nombre,unidad_medida,precio_venta,costo_actual,costo_ultima_compra,stock_actual) VALUES ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','SYN-3','Producto sintético 3','kg',5,4,4,10);

INSERT INTO productos(id,empresa_id,codigo_interno,nombre,unidad_medida,precio_venta,costo_actual,costo_ultima_compra,stock_actual) VALUES ('30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','SYN-4','Producto sintético 4','UNIDAD',100,4,4,10);

INSERT INTO productos(id,empresa_id,codigo_interno,nombre,unidad_medida,precio_venta,costo_actual,costo_ultima_compra,stock_actual) VALUES ('30000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','SYN-6','Producto sintético 6','UNIDAD',100,4,4,0);

SELECT set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',false);

INSERT INTO clientes_sigo(id,empresa_id,nombre,limite_credito) VALUES ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Cliente sintético',100000);

INSERT INTO proveedores_sigo(id,empresa_id,razon_social) VALUES ('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Proveedor sintético 2');

INSERT INTO productos(id,empresa_id,codigo_interno,nombre,unidad_medida,precio_venta,costo_actual,costo_ultima_compra,stock_actual) VALUES ('30000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000002','SYN-5','Producto sintético 5','kg',100,4,4,10);

SELECT set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',false);

INSERT INTO compras(id,empresa_id) VALUES ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');

INSERT INTO detalle_compras(compra_id,producto_id,cantidad,precio_unitario,subtotal) VALUES ('60000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,4,4);

SELECT set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',false);

INSERT INTO compras(id,empresa_id) VALUES ('60000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');

INSERT INTO detalle_compras(compra_id,producto_id,cantidad,precio_unitario,subtotal) VALUES ('60000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000005',1,4,4);


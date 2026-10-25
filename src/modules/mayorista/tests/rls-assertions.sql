insert into mayorista.vendedores values
 ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000011','Vendedor A',true),
 ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000012','Vendedor A2',true),
 ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000021','Vendedor B',true);
insert into mayorista.miembros values
 ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000001001','10000000-0000-4000-8000-000000000011','vendedor',true),
 ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000001003','10000000-0000-4000-8000-000000000012','administrador',true);
insert into mayorista.clientes(empresa_id,cliente_id,vendedor_id,nombre) values
 ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000011','Cliente A'),
 ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000102','10000000-0000-4000-8000-000000000012','Cliente A2'),
 ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000201','10000000-0000-4000-8000-000000000021','Cliente B');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001001',true);
select set_config('request.jwt.claims','{"is_anonymous":false}',true);
set local role authenticated;
do $$begin
 if (select count(*) from mayorista.clientes)<>1 then raise exception 'RLS cliente no asignado visible'; end if;
 if (select count(*) from mayorista.vendedores)<>1 then raise exception 'RLS vendedor ajeno visible'; end if;
 raise notice 'PASS 1: empresa y vendedor aislados';
end$$;
insert into mayorista.pedidos(empresa_id,pedido_id,vendedor_id,cliente_id,creado_en,lineas,huella) values
 ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000009001','10000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000101',now(),'[{"productoId":"p","cantidad":1,"precioUnitario":10}]',repeat('a',64));
do $$begin
 if (select count(*) from mayorista.pedidos)<>1 then raise exception 'Pedido propio no recibido'; end if;
 raise notice 'PASS 2: insert propio autorizado';
 begin
  insert into mayorista.pedidos(empresa_id,pedido_id,vendedor_id,cliente_id,creado_en,lineas,huella) values
  ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000009002','10000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000201',now(),'[{}]',repeat('b',64));
  raise exception 'Insert de otra empresa fue permitido';
 exception when insufficient_privilege then null; end;
 raise notice 'PASS 3: insert de otra empresa rechazado';
 begin
  insert into mayorista.pedidos select * from mayorista.pedidos;
  raise exception 'UUID duplicado permitido';
 exception when unique_violation then null; end;
 if (select count(*) from mayorista.pedidos)<>1 then raise exception 'Duplicación de pedido'; end if;
 raise notice 'PASS 4: unicidad empresa+UUID';
 begin
  update mayorista.miembros set rol='administrador';
  raise exception 'Escalamiento permitido';
 exception when insufficient_privilege then null; end;
 raise notice 'PASS 5: no autoasignar rol';
end$$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001003',true);
set local role authenticated;
do $$begin
 if (select count(*) from mayorista.clientes)<>2 then raise exception 'Admin sin aislamiento por empresa'; end if;
 raise notice 'PASS 6: administrador ve solo su empresa';
end$$;
reset role;
update mayorista.miembros set activo=false where user_id='10000000-0000-4000-8000-000000001001';
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001001',true);
set local role authenticated;
do $$begin
 if (select count(*) from mayorista.clientes)<>0 or (select count(*) from mayorista.pedidos)<>0 then raise exception 'Miembro revocado conserva acceso'; end if;
 raise notice 'PASS 7: revocación de membresía';
end$$;
reset role;

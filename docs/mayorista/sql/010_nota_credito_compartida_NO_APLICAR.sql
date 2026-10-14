-- Extensión Mayorista exclusivamente. Comprobantes en arca_comprobantes SIGO; no otro emisor.
begin;
create function public.leer_nota_credito_mayorista_sigo(p_empresa_id uuid,p_devolucion uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare control record;factura record;datos jsonb;
begin
 perform public.sigo_mayorista_operador_comercial(p_empresa_id);
 select * into control from public.sigo_mayorista_devoluciones_control where empresa_id=p_empresa_id and devolucion_id=p_devolucion;
 if not found then raise exception 'RETURN_NOT_FOUND';end if;
 select * into factura from public.arca_comprobantes where empresa_id=p_empresa_id and id=(control.nota_credito->>'facturaId')::uuid and venta_id=control.venta_id and cae is not null;
 if not found then raise exception 'CREDIT_NOTE_INVOICE_REQUIRED';end if;
 datos:=jsonb_build_object('empresaId',p_empresa_id,'devolucionId',p_devolucion,'original',to_jsonb(factura),'total',(select total from public.devoluciones_sigo where empresa_id=p_empresa_id and id=p_devolucion),'cliente',(select to_jsonb(c) from public.clientes_sigo c join public.ventas_sigo v on v.empresa_id=c.empresa_id and v.cliente_id=c.id where v.empresa_id=p_empresa_id and v.id=control.venta_id),'items',(select jsonb_agg(to_jsonb(i)) from public.devolucion_items_sigo i where i.empresa_id=p_empresa_id and i.devolucion_id=p_devolucion),'productos',(select jsonb_agg(to_jsonb(p)) from public.productos p where p.empresa_id=p_empresa_id and p.id in (select producto_id from public.devolucion_items_sigo where empresa_id=p_empresa_id and devolucion_id=p_devolucion)),'reserva',(select to_jsonb(a) from public.arca_comprobantes a where a.empresa_id=p_empresa_id and a.id=(control.nota_credito->>'comprobanteId')::uuid));
 -- Al reservar quedan congelados los datos utilizados por el emisor SIGO para ese comprobante.
 return case when control.nota_credito ? 'datosReservados' then (control.nota_credito->'datosReservados')||jsonb_build_object('reserva',datos->'reserva') else datos end;
end $$;
create function public.reservar_nota_credito_mayorista_sigo(p_empresa_id uuid,p_devolucion uuid,p_numero bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare control record;datos jsonb;comprobante record;tipo integer;punto integer;
begin
 perform public.sigo_mayorista_operador_comercial(p_empresa_id);
 select * into control from public.sigo_mayorista_devoluciones_control where empresa_id=p_empresa_id and devolucion_id=p_devolucion for update;
 if not found or p_numero is null or p_numero<=0 then raise exception 'CREDIT_NOTE_INVALID';end if;
 datos:=public.leer_nota_credito_mayorista_sigo(p_empresa_id,p_devolucion);
 if datos->'reserva' is not null and datos->'reserva'<>'null'::jsonb then return datos;end if;
 tipo:=case (datos->'original'->>'tipo_cbte')::integer when 1 then 3 when 6 then 8 when 11 then 13 end;punto:=(datos->'original'->>'punto_venta')::integer;
 if tipo is null or (datos->>'total')::numeric<=0 then raise exception 'CREDIT_NOTE_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_empresa_id::text||':NC:'||punto::text||':'||tipo::text,0));
 -- La venta_id original conserva su índice único. La NC enlaza factura y devolución por control existente.
 insert into public.arca_comprobantes(empresa_id,punto_venta,tipo_cbte,numero_cbte,resultado,request_id,observaciones) values(p_empresa_id,punto,tipo,p_numero,'reservado','mayorista_nc:'||p_devolucion::text,'[]') returning * into comprobante;
 update public.sigo_mayorista_devoluciones_control set nota_credito=nota_credito||jsonb_build_object('estado','reservado','comprobanteId',comprobante.id,'datosReservados',datos),historial=historial||jsonb_build_array(jsonb_build_object('tipo','reserva_nota_credito','responsable',auth.uid(),'fecha',now(),'comprobanteId',comprobante.id)) where empresa_id=p_empresa_id and comando_id=control.comando_id;
 return datos||jsonb_build_object('reserva',to_jsonb(comprobante));
end $$;
create function public.confirmar_nota_credito_mayorista_sigo(p_empresa_id uuid,p_devolucion uuid,p_datos jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare control record;comprobante record;
begin
 perform public.sigo_mayorista_operador_comercial(p_empresa_id);
 select * into control from public.sigo_mayorista_devoluciones_control where empresa_id=p_empresa_id and devolucion_id=p_devolucion for update;
 if not found or coalesce(p_datos->>'cae','') !~ '^[0-9]{14}$' or p_datos->>'resultado' is distinct from 'A' or nullif(p_datos->>'caeVencimiento','') is null then raise exception 'CREDIT_NOTE_CONFIRMATION_INVALID';end if;
 select * into comprobante from public.arca_comprobantes where empresa_id=p_empresa_id and id=(control.nota_credito->>'comprobanteId')::uuid for update;
 if not found then raise exception 'CREDIT_NOTE_RESERVATION_REQUIRED';end if;
 if comprobante.cae is not null then if comprobante.cae<>p_datos->>'cae' then raise exception 'CREDIT_NOTE_CONFLICT';end if;return to_jsonb(comprobante);end if;
 update public.arca_comprobantes set cae=p_datos->>'cae',cae_vencimiento=(p_datos->>'caeVencimiento')::date,resultado='A',observaciones=coalesce(p_datos->'observaciones','[]'),emitido_at=now() where id=comprobante.id and empresa_id=p_empresa_id returning * into comprobante;
 update public.sigo_mayorista_devoluciones_control set nota_credito=nota_credito||jsonb_build_object('estado','confirmado','cae',comprobante.cae),historial=historial||jsonb_build_array(jsonb_build_object('tipo','nota_credito_confirmada','responsable',auth.uid(),'fecha',now(),'comprobanteId',comprobante.id)) where empresa_id=p_empresa_id and comando_id=control.comando_id;
 return to_jsonb(comprobante);
end $$;
revoke all on function public.leer_nota_credito_mayorista_sigo(uuid,uuid),public.reservar_nota_credito_mayorista_sigo(uuid,uuid,bigint),public.confirmar_nota_credito_mayorista_sigo(uuid,uuid,jsonb) from public,anon;
grant execute on function public.leer_nota_credito_mayorista_sigo(uuid,uuid),public.reservar_nota_credito_mayorista_sigo(uuid,uuid,bigint),public.confirmar_nota_credito_mayorista_sigo(uuid,uuid,jsonb) to authenticated;
rollback;

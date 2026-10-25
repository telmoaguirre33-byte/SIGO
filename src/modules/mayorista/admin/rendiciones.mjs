// Rendiciones demo: registros independientes, sin cobros ni movimientos en Caja SIGO.
export function saveRendition(state,input){
  if(input.empresaId && input.empresaId!==state.empresaId)throw new Error('Rendición de otra empresa');
  if(!state.vendedores.some(v=>v.id===input.vendedorId && v.activo))throw new Error('Vendedor no habilitado');
  if(typeof input.id!=='string' || !input.id || typeof input.fecha!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.fecha) ||
      new Date(input.fecha+'T00:00:00Z').toISOString().slice(0,10)!==input.fecha)throw new Error('Identificador o fecha inválidos');
  const centavos=Math.round(input.importe*100);
  if(!Number.isFinite(input.importe) || input.importe<=0 || !Number.isSafeInteger(centavos) || Math.abs(centavos/100-input.importe)>0.000001)throw new Error('Importe inválido');
  if(!['efectivo','transferencia','cheque'].includes(input.medio) || (input.nota??'').length>500)throw new Error('Medio o nota inválidos');
  const next=structuredClone(state),payload={id:input.id,vendedorId:input.vendedorId,fecha:input.fecha,centavos,medio:input.medio,nota:input.nota??''};
  next.rendiciones??=[];
  const existing=next.rendiciones.find(r=>r.id===payload.id);
  if(existing){const {estado,...old}=existing;if(JSON.stringify(old)!==JSON.stringify(payload))throw new Error('UUID de rendición reutilizado con otro contenido');return next;}
  next.rendiciones.push({...payload,estado:'presentada'});return next;
}
export function reviewRendition(state,id,actor){
  if(actor.empresaId!==state.empresaId || !['owner','admin'].includes(actor.rol))throw new Error('Sin permiso administrativo para esta empresa');
  const next=structuredClone(state),r=next.rendiciones?.find(r=>r.id===id);if(!r)throw new Error('Rendición inexistente');r.estado='revisada';return next;
}

// RG 1415 Annex II A.I and A.V.3/6. Never infer exemption from missing data.
export const CONDICIONES_IVA_EMISOR = ['IVA RESPONSABLE INSCRITO', 'IVA EXENTO', 'NO RESPONSABLE IVA', 'RESPONSABLE MONOTRIBUTO', 'MONOTRIBUTO TRABAJADOR INDEPENDIENTE PROMOVIDO', 'MONOTRIBUTISTA SOCIAL'];
export const EXCEPCIONES_INICIO = ['profesional_universitario_honorarios', 'servicios_sin_local_atencion'];
export function validarImpresionEmisor(value = {}) {
  const campos = {
    domicilio: String(value.domicilio || '').trim(),
    condicion_iva: String(value.condicion_iva || '').trim(),
    ingresos_brutos: String(value.ingresos_brutos || '').trim(),
    inicio_actividades: value.inicio_actividades ? String(value.inicio_actividades) : null,
    excepcion_inicio: value.excepcion_inicio ? String(value.excepcion_inicio) : null,
  };
  const faltantes = [];
  if (campos.domicilio.length < 4 || campos.domicilio.length > 240) faltantes.push('domicilio comercial');
  if (!CONDICIONES_IVA_EMISOR.includes(campos.condicion_iva)) faltantes.push('condición IVA del emisor');
  if (campos.ingresos_brutos.length < 2 || campos.ingresos_brutos.length > 80) faltantes.push('Ingresos Brutos o condición de no contribuyente');
  const f = campos.inicio_actividades;
  const fechaValida = f && /^\d{4}-\d{2}-\d{2}$/.test(f) && Number.isFinite(Date.parse(f)) && new Date(f).toISOString().slice(0,10) === f && f <= new Date().toISOString().slice(0,10);
  if (!fechaValida && !EXCEPCIONES_INICIO.includes(campos.excepcion_inicio)) faltantes.push('inicio de actividades o excepción legal expresa');
  if (campos.excepcion_inicio && (!EXCEPCIONES_INICIO.includes(campos.excepcion_inicio) || f)) faltantes.push('excepción de inicio de actividades incompatible');
  return { campos, faltantes };
}
export function camposSnapshotEmisor(campos) {
  return { emisorDomicilio: campos.domicilio, emisorCondicionIva: campos.condicion_iva, emisorIngresosBrutos: campos.ingresos_brutos,
    ...(campos.inicio_actividades ? { emisorInicioActividades: campos.inicio_actividades } : {}),
    ...(campos.excepcion_inicio ? { emisorExcepcionInicioActividades: campos.excepcion_inicio } : {}) };
}
// Reconciliation must not attach another authorization to the reserved sale.
export function coincideComprobanteOriginal(snapshot, original) {
  const igualImporte = (a, b) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) <= 0.005;
  const doc = value => String(value ?? '').replace(/^0+(?=\d)/, '');
  return Boolean(snapshot && original && snapshot.fecha === original.fecha
    && Number(snapshot.receptorDocTipo) === Number(original.receptorDocTipo)
    && doc(snapshot.receptorDocumento) === doc(original.receptorDocumento)
    && snapshot.moneda === original.moneda && igualImporte(snapshot.cotizacion, original.cotizacion)
    && igualImporte(snapshot.total, original.total) && igualImporte(snapshot.neto, original.neto) && igualImporte(snapshot.iva, original.iva));
}

// Optional historical unit only. Never infer a missing legacy unit from products.
export async function leerItemsImpresion(sesion, rest, empresaId, ventaId) {
  const base = `venta_items_sigo?empresa_id=eq.${encodeURIComponent(empresaId)}&venta_id=eq.${encodeURIComponent(ventaId)}&select=producto_id,cantidad,precio_unitario,subtotal`;
  try { return await rest(sesion, `${base},unidad_medida`); }
  catch (error) { if (error?.status !== 400) throw error; return rest(sesion, base); }
}

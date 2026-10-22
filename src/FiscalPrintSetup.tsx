import { useRef, useState } from 'react';
import { guardarImpresionFiscal, type ConfigImpresion, type DatosEmisorImpresion } from './fiscalCaja';
const CONDICIONES = ['IVA RESPONSABLE INSCRITO', 'IVA EXENTO', 'NO RESPONSABLE IVA', 'RESPONSABLE MONOTRIBUTO', 'MONOTRIBUTO TRABAJADOR INDEPENDIENTE PROMOVIDO', 'MONOTRIBUTISTA SOCIAL'];
export default function FiscalPrintSetup({ empresaId, puntoVenta, configuracion, alGuardar }: { empresaId: string; puntoVenta: number; configuracion: ConfigImpresion; alGuardar: (config: ConfigImpresion) => void }) {
  const [datos, setDatos] = useState<DatosEmisorImpresion>(configuracion.config || { domicilio: '', condicion_iva: '', ingresos_brutos: '', inicio_actividades: null, excepcion_inicio: null });
  const [ocupado, setOcupado] = useState(false), [error, setError] = useState('');
  const guardandoRef = useRef(false);
  function cambiar<K extends keyof DatosEmisorImpresion>(key: K, value: DatosEmisorImpresion[K]) { setDatos(d => ({ ...d, [key]: value })); }
  async function guardar() {
    if (guardandoRef.current) return; guardandoRef.current = true; setOcupado(true); setError('');
    try { alGuardar(await guardarImpresionFiscal(empresaId, puntoVenta, datos)); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron guardar los datos.'); }
    finally { guardandoRef.current = false; setOcupado(false); }
  }
  return <fieldset disabled={ocupado} className="form-grid">
    <legend>Completar impresión fiscal una sola vez</legend>
    <p>{configuracion.identidad.razon_social} · CUIT {configuracion.identidad.cuit_emisor} · PV {puntoVenta}</p>
    <p>Faltan datos obligatorios de la factura. La venta ya está cobrada; todavía no se solicitó CAE. No se cambian credenciales, CUIT ni puntos de venta de ARCA.</p>
    {configuracion.puedeConfigurar ? <>
      <label>Domicilio comercial del lugar de emisión<input value={datos.domicilio} maxLength={240} onChange={e => cambiar('domicilio', e.target.value)} /></label>
      <label>Condición IVA del emisor<select value={datos.condicion_iva} onChange={e => cambiar('condicion_iva', e.target.value)}><option value="">Elegir condición real</option>{CONDICIONES.map(c => <option key={c}>{c}</option>)}</select></label>
      <label>Ingresos Brutos: número o condición de no contribuyente<input value={datos.ingresos_brutos} maxLength={80} onChange={e => cambiar('ingresos_brutos', e.target.value)} placeholder="Completar según constancia" /></label>
      <label>Inicio de actividades en este establecimiento<input type="date" value={datos.inicio_actividades || ''} disabled={Boolean(datos.excepcion_inicio)} onChange={e => cambiar('inicio_actividades', e.target.value || null)} /></label>
      <label>Excepción legal de inicio de actividades, solo si corresponde<select value={datos.excepcion_inicio || ''} onChange={e => setDatos(d => ({ ...d, excepcion_inicio: e.target.value || null, inicio_actividades: e.target.value ? null : d.inicio_actividades }))}><option value="">No aplica excepción</option><option value="profesional_universitario_honorarios">Profesional universitario: honorarios propios</option><option value="servicios_sin_local_atencion">Prestación de servicios sin local de atención</option></select></label>
      <small>Los datos deben coincidir con la situación real del emisor. La excepción no aplica por desconocer la fecha.</small>
      <button type="button" onClick={() => void guardar()}>Guardar datos de impresión</button>
    </> : <p>Un administrador con permiso fiscal debe completar estos datos. No vuelvas a cobrar esta venta.</p>}
    {error ? <p role="alert">{error}</p> : null}
  </fieldset>;
}

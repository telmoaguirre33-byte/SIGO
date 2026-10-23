import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { validarPerfilBalanza, type PerfilBalanza } from './perfilBalanza';
import type { BarcodeProduct } from './barcode';
const vacio = (empresaId: string): PerfilBalanza => ({ version: 1, empresaId, habilitado: false, formato: { prefijo: '20', longitudPlu: 5, tipo: 'peso', divisor: 1000 }, productos: [] });
export default function ConfiguracionBalanza({ empresaId, productos, puedeEditar, bloqueada, onChange }: { empresaId: string; productos: readonly BarcodeProduct[]; puedeEditar: boolean; bloqueada: boolean; onChange: (p: PerfilBalanza | null) => void }) {
  const [perfil, setPerfil] = useState(() => vacio(empresaId));
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [plu, setPlu] = useState('');
  const [productoId, setProductoId] = useState('');
  const [verificado, setVerificado] = useState(false);
  useEffect(() => {
    let vigente = true;
    let authEpoch = 0;
    setClave(''); setPerfil(vacio(empresaId)); setError(''); setPlu(''); setProductoId(''); setVerificado(false); onChange(null);
    const cargar = (id?: string) => {
      if (!vigente) return;
      onChange(null); setClave(''); setPerfil(vacio(empresaId)); setVerificado(false);
      if (!id) return;
      const key = `sigo:balanza:v1:${id}:${empresaId}`;
      try {
        const raw = localStorage.getItem(key);
        const p = raw ? validarPerfilBalanza(JSON.parse(raw), empresaId) : vacio(empresaId);
        setPerfil(p); setClave(key); onChange(p.productos.length ? p : null);
      } catch { setError('No se pudo leer la configuración local. Etiquetas desactivadas.'); }
    };
    const epoch = authEpoch;
    void supabase.auth.getUser().then(({ data, error }) => { if (!error && vigente && epoch === authEpoch) cargar(data.user?.id); }).catch(() => { if (vigente && epoch === authEpoch) { onChange(null); setClave(''); setError('No se pudo verificar el usuario. Etiquetas desactivadas.'); } });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { authEpoch++; cargar(session?.user.id); });
    return () => { vigente = false; data.subscription.unsubscribe(); };
  }, [empresaId, onChange]);
  function desactivar() {
    if (!puedeEditar || bloqueada) return;
    onChange(null); setPerfil(vacio(empresaId)); setVerificado(false);
    try { if (clave) localStorage.removeItem(clave); setError(''); }
    catch { setError('Desactivada en esta sesión, pero no se pudo borrar la configuración guardada. Revisala antes de volver a ingresar.'); }
  }
  function guardar(habilitado: boolean) {
    if (!puedeEditar || bloqueada || !clave) return;
    try {
      if (habilitado && !verificado) throw new Error('Verificá una etiqueta real antes de habilitar.');
      const p = validarPerfilBalanza({ ...perfil, habilitado }, empresaId);
      localStorage.setItem(clave, JSON.stringify(p)); setPerfil(p); onChange(p); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.'); }
  }
  return <details className="sigo-balanza-config" onKeyDown={e => { if (/^F(?:9|10|11|12)$/.test(e.key)) { e.preventDefault(); e.stopPropagation(); } }}>
    <summary>Etiquetas de balanza · {perfil.habilitado ? 'activas en esta caja' : 'desactivadas'}</summary>
    <p>Configuración local de este usuario, empresa y navegador. No se sincroniza con otras cajas ni programa la balanza.</p>
    <p>Formato admitido: prefijo + PLU + peso o unidades + dígito EAN-13. Sin dígito interno de peso/precio. Se cobra al precio de SIGO; la descripción se obtiene del producto vinculado.</p>
    {!puedeEditar ? <p>Un usuario con permiso de edición de productos debe configurar esta caja.</p> : <fieldset disabled={bloqueada || !clave}>
      <label>Prefijo (2 dígitos) <input aria-label="Prefijo balanza" inputMode="numeric" maxLength={2} value={perfil.formato.prefijo} onChange={e => { setVerificado(false); setPerfil({ ...perfil, formato: { ...perfil.formato, prefijo: e.target.value } }); }} /></label>
      <label>Dígitos del PLU <input aria-label="Longitud PLU" type="number" min={1} max={8} value={perfil.formato.longitudPlu} onChange={e => { setVerificado(false); setPerfil({ ...perfil, formato: { ...perfil.formato, longitudPlu: Number(e.target.value) } }); }} /></label>
      <label>Contenido <select aria-label="Contenido etiqueta" value={perfil.formato.tipo} onChange={e => { setVerificado(false); setPerfil({ ...perfil, formato: { ...perfil.formato, tipo: e.target.value as 'peso' | 'unidad', divisor: e.target.value === 'unidad' ? 1 : 1000 } }); }}><option value="peso">Peso en kg</option><option value="unidad">Cantidad de unidades</option></select></label>
      <label>Decimales del peso <select aria-label="Decimales etiqueta" disabled={perfil.formato.tipo === 'unidad'} value={perfil.formato.divisor} onChange={e => { setVerificado(false); setPerfil({ ...perfil, formato: { ...perfil.formato, divisor: Number(e.target.value) } }); }}><option value={1}>0</option><option value={10}>1</option><option value={100}>2</option><option value={1000}>3 (gramos)</option></select></label>
      <p>Los códigos que contienen sólo importe no están habilitados: no permiten conocer el peso exacto.</p>
      <label>PLU de la balanza <input aria-label="PLU balanza" inputMode="numeric" value={plu} onChange={e => setPlu(e.target.value)} /></label>
      <label>Producto SIGO <select aria-label="Producto balanza" value={productoId} onChange={e => setProductoId(e.target.value)}><option value="">Seleccionar</option>{productos.filter(p => p.empresa_id === empresaId).map(p => <option value={p.id} key={p.id}>{p.nombre}</option>)}</select></label>
      <button type="button" onClick={() => { try { const p = validarPerfilBalanza({ ...perfil, productos: [...perfil.productos, { plu, productoId }] }, empresaId); setPerfil(p); setPlu(''); setProductoId(''); setVerificado(false); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Vínculo inválido.'); } }}>Vincular PLU</button>
      <ul>{perfil.productos.map(x => <li key={x.plu}>{x.plu} · {productos.find(p => p.id === x.productoId)?.nombre ?? 'Producto no disponible'} <button type="button" onClick={() => { setPerfil({ ...perfil, productos: perfil.productos.filter(y => y.plu !== x.plu) }); setVerificado(false); }}>Quitar vínculo</button></li>)}</ul>
      <label><input type="checkbox" checked={verificado} onChange={e => setVerificado(e.target.checked)} />Verifiqué el formato con una etiqueta real y no contiene un dígito interno adicional.</label>
      <button type="button" onClick={() => guardar(true)}>Guardar y habilitar en esta caja</button>
      <button type="button" onClick={desactivar}>Desactivar en esta caja</button>
    </fieldset>}
    {error && <p role="alert">{error}</p>}
  </details>;
}

import { useEffect, useMemo, useState } from "react";
import type { EmpresaOperativa } from "./tenant";
import {
  actualizarModuloEmpresa,
  aplicarPresetModulosEmpresa,
  listarModulosEmpresa,
  type ModuloEmpresa,
  type PresetModulo,
} from "./modulosEmpresa";

const PRESETS: Array<{ clave: PresetModulo; nombre: string; detalle: string }> = [
  { clave: "kiosco", nombre: "Kiosco", detalle: "Venta rápida, stock, precios, scanner, clientes y ARCA." },
  { clave: "almacen", nombre: "Almacén", detalle: "Operación tradicional con stock, compras, cuentas y facturación." },
  { clave: "libreria", nombre: "Librería", detalle: "Productos, stock, scanner, precios, compras y cuentas corrientes." },
  { clave: "mayorista", nombre: "Mayorista", detalle: "Incluye portal cliente además de la operación comercial completa." },
  { clave: "fiambreria", nombre: "Fiambrería", detalle: "Base comercial lista para sumar venta por peso cuando esté disponible." },
  { clave: "gastronomia", nombre: "Gastronomía", detalle: "Base para comida al paso, preparada para precio libre, combos y comandas." },
  { clave: "mixto", nombre: "Mixto", detalle: "Activa todos los módulos operativos actualmente disponibles." },
];

function ordenarCategorias(modulos: ModuloEmpresa[]) {
  const mapa = new Map<string, ModuloEmpresa[]>();
  for (const modulo of modulos) {
    const lista = mapa.get(modulo.categoria) ?? [];
    lista.push(modulo);
    mapa.set(modulo.categoria, lista);
  }
  return Array.from(mapa.entries()).map(([categoria, items]) => ({
    categoria,
    items: items.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es")),
  }));
}

export default function ModulosControlPanel({ empresa }: { empresa: EmpresaOperativa }) {
  const [modulos, setModulos] = useState<ModuloEmpresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [preset, setPreset] = useState<PresetModulo>("kiosco");

  const puedeEditar = empresa.rol === "owner" || empresa.rol === "admin";

  async function cargar() {
    setLoading(true);
    setError("");
    try {
      setModulos(await listarModulosEmpresa(empresa.empresa_id));
    } catch (err) {
      setModulos([]);
      setError(err instanceof Error ? err.message : "No se pudo cargar el tablero de módulos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void cargar(); }, [empresa.empresa_id]);

  const categorias = useMemo(() => ordenarCategorias(modulos), [modulos]);
  const activos = modulos.filter((m) => m.habilitado).length;
  const disponibles = modulos.filter((m) => m.disponible).length;
  const enPreparacion = modulos.filter((m) => !m.disponible).length;

  async function cambiar(modulo: ModuloEmpresa) {
    if (!puedeEditar || modulo.obligatorio || !modulo.disponible || working) return;
    setWorking(modulo.clave);
    setError("");
    setMensaje("");
    try {
      await actualizarModuloEmpresa(empresa.empresa_id, modulo.clave, !modulo.habilitado);
      await cargar();
      setMensaje(`${modulo.nombre}: ${modulo.habilitado ? "desactivado" : "activado"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar el módulo.");
    } finally {
      setWorking(null);
    }
  }

  async function aplicarPreset() {
    if (!puedeEditar || working) return;
    const elegido = PRESETS.find((item) => item.clave === preset);
    if (!window.confirm(`¿Aplicar la configuración “${elegido?.nombre ?? preset}” a ${empresa.empresa_nombre}? Los módulos operativos se ajustarán al perfil elegido.`)) return;
    setWorking(`preset:${preset}`);
    setError("");
    setMensaje("");
    try {
      await aplicarPresetModulosEmpresa(empresa.empresa_id, preset);
      await cargar();
      setMensaje(`Configuración ${elegido?.nombre ?? preset} aplicada correctamente.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo aplicar la configuración del negocio.");
    } finally {
      setWorking(null);
    }
  }

  return (
    <section className="panel" aria-label="Tablero de control de módulos">
      <div className="page-header">
        <div>
          <div className="sigo-detail-title"><span>▦</span><h3>Tablero de control de módulos</h3></div>
          <p>Elegí qué funciones utiliza esta empresa. Los módulos que no necesita dejan de formar parte de su configuración operativa.</p>
        </div>
        <button className="admin-button" type="button" onClick={() => void cargar()} disabled={loading || Boolean(working)}>
          {loading ? "Cargando…" : "Actualizar"}
        </button>
      </div>

      <div className="stats-grid" style={{ marginBottom: 18 }}>
        <div className="stat-card"><span>Módulos activos</span><strong>{activos}</strong><small>Configurados para esta empresa</small></div>
        <div className="stat-card"><span>Disponibles</span><strong>{disponibles}</strong><small>Se pueden activar ahora</small></div>
        <div className="stat-card"><span>En preparación</span><strong>{enPreparacion}</strong><small>Nuevos rubros y modalidades</small></div>
      </div>

      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="page-header">
          <div>
            <h3>Configuración rápida por tipo de negocio</h3>
            <p>Usá un perfil inicial y después ajustá módulo por módulo.</p>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 280px) 1fr auto", gap: 12, alignItems: "end" }}>
          <div className="form-group">
            <label htmlFor="preset-negocio">Tipo de negocio</label>
            <select id="preset-negocio" value={preset} onChange={(e) => setPreset(e.target.value as PresetModulo)} disabled={!puedeEditar || Boolean(working)}>
              {PRESETS.map((item) => <option key={item.clave} value={item.clave}>{item.nombre}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 13, opacity: .8, paddingBottom: 10 }}>
            {PRESETS.find((item) => item.clave === preset)?.detalle}
          </div>
          <button className="primary-button" type="button" onClick={() => void aplicarPreset()} disabled={!puedeEditar || Boolean(working)}>
            {working?.startsWith("preset:") ? "Aplicando…" : "Aplicar configuración"}
          </button>
        </div>
      </div>

      {error ? <div className="form-error" role="alert" style={{ marginBottom: 14 }}>{error}</div> : null}
      {mensaje ? <div className="sigo-matriz-success" style={{ marginBottom: 14 }}>{mensaje}</div> : null}
      {!puedeEditar ? <p className="barcode-help">Tu perfil puede consultar los módulos, pero sólo Propietario o Administrador puede modificarlos.</p> : null}

      {loading ? (
        <div className="empty-state">Cargando módulos…</div>
      ) : (
        <div style={{ display: "grid", gap: 20 }}>
          {categorias.map(({ categoria, items }) => (
            <div key={categoria}>
              <h4 style={{ margin: "0 0 10px" }}>{categoria}</h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
                {items.map((modulo) => {
                  const bloqueado = modulo.obligatorio || !modulo.disponible || !puedeEditar;
                  return (
                    <article key={modulo.clave} className="stat-card" style={{ minHeight: 150, display: "flex", flexDirection: "column", gap: 8, justifyContent: "space-between" }}>
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                          <strong style={{ fontSize: 16 }}>{modulo.nombre}</strong>
                          <span className={modulo.habilitado ? "sigo-status active" : "sigo-status suspended"}>
                            {modulo.obligatorio ? "Esencial" : !modulo.disponible ? "En preparación" : modulo.habilitado ? "Activo" : "Inactivo"}
                          </span>
                        </div>
                        <p style={{ margin: "8px 0 0", fontSize: 13, opacity: .82 }}>{modulo.descripcion}</p>
                      </div>
                      <button
                        className={modulo.habilitado ? "admin-button" : "primary-button"}
                        type="button"
                        disabled={bloqueado || Boolean(working)}
                        onClick={() => void cambiar(modulo)}
                      >
                        {working === modulo.clave ? "Guardando…" : modulo.obligatorio ? "Siempre activo" : !modulo.disponible ? "Próximamente" : modulo.habilitado ? "Desactivar" : "Agregar módulo"}
                      </button>
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

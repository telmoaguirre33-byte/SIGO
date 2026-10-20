import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  guardarClienteSigo,
  listarClientesSigo,
  registrarCobroClienteSigo,
  type ClienteSigo,
  type MedioCobroSigo,
} from "./clientes";

type ClienteForm = {
  nombre: string;
  documento: string;
  telefono: string;
  email: string;
  direccion: string;
  limiteCredito: string;
};

const vacio: ClienteForm = {
  nombre: "",
  documento: "",
  telefono: "",
  email: "",
  direccion: "",
  limiteCredito: "",
};

export default function ClientesOperativos({ empresaId }: { empresaId: string }) {
  const [clientes, setClientes] = useState<ClienteSigo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClienteSigo | null>(null);
  const [form, setForm] = useState<ClienteForm>(vacio);
  const [saving, setSaving] = useState(false);
  const [cobrando, setCobrando] = useState<ClienteSigo | null>(null);
  const [importeCobro, setImporteCobro] = useState("");
  const [medioCobro, setMedioCobro] = useState<MedioCobroSigo>("efectivo");
  const empresaActivaRef = useRef(empresaId);

  async function cargar(targetEmpresaId = empresaId) {
    setLoading(true);
    setError("");
    try {
      const data = await listarClientesSigo(targetEmpresaId);
      if (empresaActivaRef.current === targetEmpresaId) setClientes(data);
    } catch (err) {
      if (empresaActivaRef.current !== targetEmpresaId) return;
      setClientes([]);
      setError(err instanceof Error ? err.message : "No se pudieron cargar los clientes.");
    } finally {
      if (empresaActivaRef.current === targetEmpresaId) setLoading(false);
    }
  }

  useEffect(() => {
    empresaActivaRef.current = empresaId;
    setClientes([]);
    setSearch("");
    setFormOpen(false);
    setEditing(null);
    setForm(vacio);
    setCobrando(null);
    setImporteCobro("");
    setMedioCobro("efectivo");
    setError("");
    void cargar(empresaId);
    // cargar usa únicamente el empresaId capturado para evitar mezclar tenants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);

  const filtrados = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clientes;
    return clientes.filter((cliente) => [cliente.nombre, cliente.documento, cliente.telefono, cliente.email]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q));
  }, [clientes, search]);

  const saldoTotal = clientes.reduce((suma, cliente) => suma + Number(cliente.saldo_actual || 0), 0);
  const conDeuda = clientes.filter((cliente) => Number(cliente.saldo_actual || 0) > 0).length;
  const importeCobroNumero = Number(importeCobro.replace(",", "."));
  const cobroInvalido = !cobrando
    || !Number.isFinite(importeCobroNumero)
    || importeCobroNumero <= 0
    || importeCobroNumero > Number(cobrando.saldo_actual || 0);

  function abrirNuevo() {
    setEditing(null);
    setForm(vacio);
    setFormOpen(true);
    setError("");
  }

  function abrirEdicion(cliente: ClienteSigo) {
    setEditing(cliente);
    setForm({
      nombre: cliente.nombre,
      documento: cliente.documento ?? "",
      telefono: cliente.telefono ?? "",
      email: cliente.email ?? "",
      direccion: cliente.direccion ?? "",
      limiteCredito: cliente.limite_credito == null ? "" : String(cliente.limite_credito),
    });
    setFormOpen(true);
    setError("");
  }

  function abrirCobro(cliente: ClienteSigo) {
    setCobrando(cliente);
    setImporteCobro("");
    setMedioCobro("efectivo");
    setError("");
  }

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const empresaOperacion = empresaId;
    setSaving(true);
    setError("");
    try {
      await guardarClienteSigo({
        id: editing?.id,
        empresaId: empresaOperacion,
        nombre: form.nombre,
        documento: form.documento,
        telefono: form.telefono,
        email: form.email,
        direccion: form.direccion,
        limiteCredito: form.limiteCredito.trim() ? Number(form.limiteCredito) : null,
      });
      if (empresaActivaRef.current !== empresaOperacion) return;
      setFormOpen(false);
      setEditing(null);
      setForm(vacio);
      await cargar(empresaOperacion);
    } catch (err) {
      if (empresaActivaRef.current === empresaOperacion) {
        setError(err instanceof Error ? err.message : "No se pudo guardar el cliente.");
      }
    } finally {
      if (empresaActivaRef.current === empresaOperacion) setSaving(false);
    }
  }

  async function registrarCobro() {
    if (!cobrando || cobroInvalido) return;
    const empresaOperacion = empresaId;
    setSaving(true);
    setError("");
    try {
      await registrarCobroClienteSigo({
        empresaId: empresaOperacion,
        clienteId: cobrando.id,
        importe: importeCobroNumero,
        medioPago: medioCobro,
      });
      if (empresaActivaRef.current !== empresaOperacion) return;
      setCobrando(null);
      setImporteCobro("");
      setMedioCobro("efectivo");
      await cargar(empresaOperacion);
    } catch (err) {
      if (empresaActivaRef.current === empresaOperacion) {
        setError(err instanceof Error ? err.message : "No se pudo registrar el cobro.");
      }
    } finally {
      if (empresaActivaRef.current === empresaOperacion) setSaving(false);
    }
  }

  return (
    <div className="products-page">
      <div className="page-header">
        <div>
          <h2>Clientes</h2>
          <p>Clientes, límites de crédito y saldos de cuenta corriente aislados por empresa.</p>
        </div>
        <div className="topbar-actions">
          <button className="admin-button" onClick={() => void cargar()}>Actualizar</button>
          <button className="primary-button" onClick={abrirNuevo}>Nuevo cliente</button>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card"><span>Clientes activos</span><strong>{clientes.length}</strong></div>
        <div className="stat-card"><span>Con deuda</span><strong>{conDeuda}</strong></div>
        <div className="stat-card"><span>Saldo a cobrar</span><strong>$ {saldoTotal.toLocaleString("es-AR")}</strong></div>
      </div>

      <div className="product-tools">
        <input type="search" placeholder="Buscar cliente, documento, teléfono o email..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {error && <div className="panel"><p className="form-error" role="alert">{error}</p></div>}
      {loading ? (
        <div className="panel"><p>Cargando clientes…</p></div>
      ) : (
        <div className="panel">
          <div className="table-wrapper">
            <table className="products-table">
              <thead><tr><th>Cliente</th><th>Documento</th><th>Contacto</th><th>Límite</th><th>Saldo</th><th>Acciones</th></tr></thead>
              <tbody>
                {filtrados.map((cliente) => (
                  <tr key={cliente.id}>
                    <td><strong>{cliente.nombre}</strong></td>
                    <td>{cliente.documento ?? "-"}</td>
                    <td>{cliente.telefono || cliente.email || "-"}</td>
                    <td>{cliente.limite_credito == null ? "Sin límite" : `$ ${Number(cliente.limite_credito).toLocaleString("es-AR")}`}</td>
                    <td><strong>$ {Number(cliente.saldo_actual || 0).toLocaleString("es-AR")}</strong></td>
                    <td>
                      <div className="row-actions">
                        <button className="admin-button" onClick={() => abrirEdicion(cliente)}>Editar</button>
                        <button className="admin-button" disabled={Number(cliente.saldo_actual || 0) <= 0} onClick={() => abrirCobro(cliente)}>Cobrar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtrados.length === 0 && <div className="table-empty">No hay clientes para mostrar.</div>}
          </div>
        </div>
      )}

      {formOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) setFormOpen(false); }}>
          <div className="modal" role="dialog" aria-modal="true">
            <div className="page-header modal-header">
              <div><h2>{editing ? "Editar cliente" : "Nuevo cliente"}</h2><p>Los datos pertenecen únicamente a la empresa activa.</p></div>
              <button className="admin-button" disabled={saving} onClick={() => setFormOpen(false)}>Cerrar</button>
            </div>
            <form onSubmit={(e) => void guardar(e)}>
              <div className="form-grid">
                <div className="form-group form-span-2"><label>Nombre *</label><input required autoFocus value={form.nombre} onChange={(e) => setForm((actual) => ({ ...actual, nombre: e.target.value }))} /></div>
                <div className="form-group"><label>Documento / CUIT</label><input value={form.documento} onChange={(e) => setForm((actual) => ({ ...actual, documento: e.target.value }))} /></div>
                <div className="form-group"><label>Teléfono</label><input value={form.telefono} onChange={(e) => setForm((actual) => ({ ...actual, telefono: e.target.value }))} /></div>
                <div className="form-group"><label>Email</label><input type="email" value={form.email} onChange={(e) => setForm((actual) => ({ ...actual, email: e.target.value }))} /></div>
                <div className="form-group"><label>Límite de crédito</label><input inputMode="decimal" value={form.limiteCredito} onChange={(e) => setForm((actual) => ({ ...actual, limiteCredito: e.target.value }))} /></div>
                <div className="form-group form-span-2"><label>Dirección</label><input value={form.direccion} onChange={(e) => setForm((actual) => ({ ...actual, direccion: e.target.value }))} /></div>
              </div>
              <div className="form-actions">
                <button type="button" className="admin-button" disabled={saving} onClick={() => setFormOpen(false)}>Cancelar</button>
                <button type="submit" className="primary-button" disabled={saving}>{saving ? "Guardando…" : "Guardar cliente"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {cobrando && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) setCobrando(null); }}>
          <div className="modal" role="dialog" aria-modal="true">
            <div className="page-header modal-header">
              <div><h2>Registrar cobro</h2><p>{cobrando.nombre} · saldo $ {Number(cobrando.saldo_actual).toLocaleString("es-AR")}</p></div>
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label>Importe</label>
                <input autoFocus inputMode="decimal" value={importeCobro} onChange={(e) => setImporteCobro(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Medio de cobro</label>
                <select value={medioCobro} onChange={(e) => setMedioCobro(e.target.value as MedioCobroSigo)}>
                  <option value="efectivo">Efectivo</option>
                  <option value="debito">Débito</option>
                  <option value="credito">Crédito</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
            </div>
            {importeCobro.trim() && importeCobroNumero > Number(cobrando.saldo_actual || 0) && (
              <p className="form-error" role="alert">El importe supera el saldo pendiente. Máximo: $ {Number(cobrando.saldo_actual).toLocaleString("es-AR")}.</p>
            )}
            <p style={{ opacity: 0.78 }}>El cobro reduce la cuenta corriente y registra el ingreso en Caja en una sola operación.</p>
            <div className="form-actions">
              <button className="admin-button" disabled={saving} onClick={() => setCobrando(null)}>Cancelar</button>
              <button className="primary-button" disabled={saving || cobroInvalido} onClick={() => void registrarCobro()}>{saving ? "Registrando…" : "Registrar cobro"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

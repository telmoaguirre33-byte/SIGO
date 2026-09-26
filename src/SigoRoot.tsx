import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ClientesOperativos from "./ClientesOperativos";
import ComprasOperativas from "./ComprasOperativas";
import InformesOperativos from "./InformesOperativos";
import MatrizAdmin from "./MatrizAdmin";
import PortalCliente from "./PortalCliente";
import SigoApp from "./SigoApp";
import TenantSwitcher from "./TenantSwitcher";
import UsuariosOperativos from "./UsuariosOperativos";
import {
  cargarMisEmpresas,
  crearEmpresaSigo,
  resolverEmpresaActiva,
  type EmpresaOperativa,
} from "./tenant";
import { supabase } from "./supabase";
import {
  etiquetaRol,
  type SigoWorkspace,
  workspaceInicial,
  workspacePermitido,
  workspacesPermitidos,
} from "./workspacePermissions";

const WORKSPACE_LABELS: Record<SigoWorkspace, string> = {
  operacion: "Operación",
  usuarios: "Usuarios",
  clientes: "Clientes / Ctas. corrientes",
  compras: "Compras / Proveedores",
  informes: "Informes",
  portal: "Portal Cliente",
};

const PENDING_EMPRESA_METADATA_KEY = "sigo_empresa_nombre";
const ONBOARDING_MODE_METADATA_KEY = "sigo_onboarding_mode";
const STAFF_ONBOARDING_MODE = "member";
type TenantState = "loading" | "ready" | "empty" | "error";
type EmptyTenantMode = "checking" | "member" | "owner";

export default function SigoRoot() {
  const [empresaActiva, setEmpresaActiva] = useState<EmpresaOperativa | null>(null);
  const [tenantReady, setTenantReady] = useState(false);
  const [tenantState, setTenantState] = useState<TenantState>("loading");
  const [tenantRetryKey, setTenantRetryKey] = useState(0);
  const [workspace, setWorkspace] = useState<SigoWorkspace>("operacion");
  const [nuevaEmpresa, setNuevaEmpresa] = useState("");
  const [creandoEmpresa, setCreandoEmpresa] = useState(false);
  const [autoProvisionando, setAutoProvisionando] = useState(false);
  const [errorEmpresa, setErrorEmpresa] = useState("");
  const [autoRetryCount, setAutoRetryCount] = useState(0);
  const [emptyTenantMode, setEmptyTenantMode] = useState<EmptyTenantMode>("checking");
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [matrixMode, setMatrixMode] = useState(false);
  const autoProvisionAttemptedRef = useRef(false);

  const permitidos = useMemo(
    () => (empresaActiva ? workspacesPermitidos(empresaActiva.rol) : []),
    [empresaActiva],
  );

  const handleEmpresaChange = useCallback((empresa: EmpresaOperativa | null) => {
    setEmpresaActiva(empresa);
    window.dispatchEvent(new CustomEvent("sigo:empresa-activa-cambiada", { detail: empresa }));
    setTenantReady(true);
    setMatrixMode(false);
    setWorkspace(empresa ? workspaceInicial(empresa.rol) : "operacion");
    if (empresa) {
      setAutoRetryCount(0);
      setEmptyTenantMode("checking");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void supabase.rpc("es_superadmin_sigo").then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.warn("No se pudo verificar el rol Matriz", error);
        setIsSuperadmin(false);
        return;
      }
      setIsSuperadmin(Boolean(data));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!empresaActiva) return;
    if (!workspacePermitido(empresaActiva.rol, workspace)) {
      setWorkspace(workspaceInicial(empresaActiva.rol));
    }
  }, [empresaActiva, workspace]);

  useEffect(() => {
    if (tenantState !== "error" || autoRetryCount >= 3) return;
    const timer = window.setTimeout(() => {
      setAutoRetryCount((value) => value + 1);
      setTenantRetryKey((value) => value + 1);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [tenantState, autoRetryCount]);

  useEffect(() => {
    if (tenantState !== "empty" || empresaActiva || emptyTenantMode !== "member") return;
    const timer = window.setInterval(() => {
      setTenantRetryKey((value) => value + 1);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [tenantState, empresaActiva, emptyTenantMode]);

  useEffect(() => {
    if (!tenantReady || tenantState !== "empty" || empresaActiva || autoProvisionAttemptedRef.current) return;
    autoProvisionAttemptedRef.current = true;
    let cancelled = false;

    void (async () => {
      let empresaCreadaId: string | null = null;
      setAutoProvisionando(true);
      setErrorEmpresa("");
      setEmptyTenantMode("checking");
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        const user = data.user;
        if (!user) throw new Error("AUTH_REQUIRED");

        const nombrePendiente = String(user.user_metadata?.[PENDING_EMPRESA_METADATA_KEY] ?? "").trim();
        const onboardingMode = String(user.user_metadata?.[ONBOARDING_MODE_METADATA_KEY] ?? "").trim();

        if (!nombrePendiente) {
          if (!cancelled) setEmptyTenantMode(onboardingMode === STAFF_ONBOARDING_MODE ? "member" : "owner");
          return;
        }

        if (!cancelled) {
          setEmptyTenantMode("owner");
          setNuevaEmpresa(nombrePendiente);
        }
        empresaCreadaId = await crearEmpresaSigo(nombrePendiente);
        const empresas = await cargarMisEmpresas();
        const creada = resolverEmpresaActiva(empresas, empresaCreadaId, user.id);
        if (!creada) throw new Error("EMPRESA_CREATED_NOT_VISIBLE");

        const { error: metadataError } = await supabase.auth.updateUser({
          data: { [PENDING_EMPRESA_METADATA_KEY]: null },
        });
        if (metadataError) console.warn("No se pudo limpiar el alta pendiente de empresa", metadataError);
        if (cancelled) return;

        setEmpresaActiva(creada);
        setTenantState("ready");
        setWorkspace(workspaceInicial(creada.rol));
        setNuevaEmpresa("");
        setEmptyTenantMode("checking");
        setTenantRetryKey((value) => value + 1);
      } catch (error) {
        if (cancelled) return;
        console.error("No se pudo completar automáticamente el alta de empresa", error);
        setEmptyTenantMode("owner");
        if (empresaCreadaId) {
          setErrorEmpresa("La empresa ya se creó. Estamos actualizando tu acceso; no vuelvas a crearla.");
          setTenantRetryKey((value) => value + 1);
        } else {
          setErrorEmpresa("No pudimos completar automáticamente el alta. Podés reintentar con el nombre de tu empresa.");
        }
      } finally {
        if (!cancelled) setAutoProvisionando(false);
      }
    })();

    return () => { cancelled = true; };
  }, [tenantReady, tenantState, empresaActiva]);

  function abrirWorkspace(destino: SigoWorkspace) {
    if (!empresaActiva || !workspacePermitido(empresaActiva.rol, destino)) return;
    setMatrixMode(false);
    setWorkspace(destino);
  }

  async function abrirEmpresaSoporte(empresaId: string) {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) throw authError ?? new Error("AUTH_REQUIRED");
    const empresas = await cargarMisEmpresas();
    const empresa = resolverEmpresaActiva(empresas, empresaId, authData.user.id);
    if (!empresa || empresa.empresa_id !== empresaId) throw new Error("SUPPORT_COMPANY_NOT_VISIBLE");
    setEmpresaActiva(empresa);
    window.dispatchEvent(new CustomEvent("sigo:empresa-activa-cambiada", { detail: empresa }));
    setTenantState("ready");
    setMatrixMode(false);
    setWorkspace(workspaceInicial(empresa.rol));
    setTenantRetryKey((value) => value + 1);
  }

  async function crearPrimeraEmpresa(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creandoEmpresa || autoProvisionando) return;
    const nombre = nuevaEmpresa.trim();
    if (!nombre) {
      setErrorEmpresa("Ingresá el nombre de tu empresa o negocio.");
      return;
    }

    setCreandoEmpresa(true);
    setErrorEmpresa("");
    let empresaId: string | null = null;
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw authError ?? new Error("AUTH_REQUIRED");
      const onboardingMode = String(authData.user.user_metadata?.[ONBOARDING_MODE_METADATA_KEY] ?? "").trim();
      if (onboardingMode === STAFF_ONBOARDING_MODE) {
        setEmptyTenantMode("member");
        setErrorEmpresa("Esta cuenta fue creada para sumarse a una empresa existente. Un administrador debe agregarte; SIGO actualizará el acceso automáticamente.");
        return;
      }

      empresaId = await crearEmpresaSigo(nombre);
      const empresas = await cargarMisEmpresas();
      const creada = resolverEmpresaActiva(empresas, empresaId, authData.user.id);
      if (!creada) throw new Error("EMPRESA_CREATED_NOT_VISIBLE");

      const { error: metadataError } = await supabase.auth.updateUser({
        data: { [PENDING_EMPRESA_METADATA_KEY]: null },
      });
      if (metadataError) console.warn("No se pudo limpiar el alta pendiente de empresa", metadataError);

      setEmpresaActiva(creada);
      setTenantState("ready");
      setWorkspace(workspaceInicial(creada.rol));
      setNuevaEmpresa("");
      setEmptyTenantMode("checking");
      setTenantRetryKey((value) => value + 1);
    } catch (error) {
      console.error("No se pudo completar el alta inicial de empresa", error);
      if (empresaId) {
        setErrorEmpresa("La empresa se creó. Estamos actualizando tu acceso; no vuelvas a crearla.");
        setTenantRetryKey((value) => value + 1);
      } else {
        setErrorEmpresa("No pudimos terminar la configuración. Intentá nuevamente.");
      }
    } finally {
      setCreandoEmpresa(false);
    }
  }

  async function cambiarUsuario() {
    await supabase.auth.signOut();
  }

  const workspaceContent = empresaActiva ? (() => {
    if (workspace === "usuarios" && workspacePermitido(empresaActiva.rol, "usuarios")) {
      return <main className="main" style={{ minHeight: "calc(100vh - 88px)" }}><section className="content"><UsuariosOperativos key={empresaActiva.empresa_id} empresaId={empresaActiva.empresa_id} actorRol={empresaActiva.rol} /></section></main>;
    }
    if (workspace === "clientes" && workspacePermitido(empresaActiva.rol, "clientes")) {
      return <main className="main" style={{ minHeight: "calc(100vh - 88px)" }}><section className="content"><ClientesOperativos key={empresaActiva.empresa_id} empresaId={empresaActiva.empresa_id} /></section></main>;
    }
    if (workspace === "compras" && workspacePermitido(empresaActiva.rol, "compras")) {
      return <main className="main" style={{ minHeight: "calc(100vh - 88px)" }}><section className="content"><SigoApp key={`compras-${empresaActiva.empresa_id}`} empresa={empresaActiva} initialSection="Compras" purchasesOnly /></section></main>;
    }
    if (workspace === "informes" && workspacePermitido(empresaActiva.rol, "informes")) {
      return <main className="main" style={{ minHeight: "calc(100vh - 88px)" }}><section className="content"><InformesOperativos key={empresaActiva.empresa_id} empresaId={empresaActiva.empresa_id} /></section></main>;
    }
    if (workspace === "portal" && workspacePermitido(empresaActiva.rol, "portal")) {
      return <main className="main" style={{ minHeight: "calc(100vh - 88px)" }}><section className="content"><PortalCliente key={empresaActiva.empresa_id} empresaId={empresaActiva.empresa_id} /></section></main>;
    }
    if (workspacePermitido(empresaActiva.rol, "operacion")) {
      return <div className={`sigo-operation-only sigo-role-${empresaActiva.rol}`}><SigoApp key={empresaActiva.empresa_id} empresa={empresaActiva} /></div>;
    }
    return <main className="sigo-onboarding-card" role="alert"><h1>Acceso limitado</h1><p>Tu perfil no tiene habilitada esta operación.</p></main>;
  })() : null;

  const contenidoPrincipal = isSuperadmin && matrixMode
    ? <MatrizAdmin onOpenEmpresa={abrirEmpresaSoporte} />
    : workspaceContent;

  return (
    <div className="sigo-root">
      <style>{`
        .sigo-operation-only .sidebar .menu > button:nth-child(4),
        .sigo-operation-only .sidebar .menu > button:nth-child(5),
        .sigo-operation-only .sidebar .menu > button:nth-child(7) { display: none; }
        .sigo-role-seller .sidebar .menu > button:nth-child(2),
        .sigo-role-seller .sidebar .menu > button:nth-child(6),
        .sigo-role-seller .welcome .topbar-actions { display: none; }
        .sigo-role-warehouse .sidebar .menu > button:nth-child(3) { display: none; }
        .sigo-onboarding-card { width:min(540px,calc(100% - 32px)); margin:48px auto; padding:28px; border-radius:22px; background:#fff; box-shadow:0 18px 50px rgba(15,23,42,.12); }
        .sigo-onboarding-card h1 { margin:0 0 8px; }
        .sigo-onboarding-card p { color:#64748b; line-height:1.5; }
        .sigo-onboarding-card form { display:grid; gap:14px; margin-top:20px; }
        .sigo-onboarding-card input { min-height:50px; padding:12px 14px; border:1px solid #dbe3ee; border-radius:14px; font-size:16px; }
        .sigo-onboarding-error { color:#b91c1c; font-size:13px; }
        .sigo-recovery { width:min(560px,calc(100% - 28px)); margin:42px auto; background:#fff; border:1px solid #e5edf6; border-radius:24px; box-shadow:0 24px 60px rgba(15,23,42,.10); overflow:hidden; }
        .sigo-recovery-head { padding:28px 28px 20px; }
        .sigo-recovery-brand { display:flex; align-items:center; gap:12px; margin-bottom:22px; }
        .sigo-recovery-mark { width:42px; height:42px; border-radius:12px; display:grid; place-items:center; background:#2563eb; color:#fff; font-weight:900; }
        .sigo-recovery-status { display:inline-flex; align-items:center; gap:8px; padding:7px 11px; border-radius:999px; background:#eef5ff; color:#1d4ed8; font-size:13px; font-weight:800; }
        .sigo-recovery-dot { width:8px; height:8px; border-radius:50%; background:#2563eb; }
        .sigo-recovery h1 { margin:18px 0 10px; color:#0f172a; }
        .sigo-recovery p { margin:0; color:#64748b; line-height:1.6; }
        .sigo-recovery-actions { display:grid; gap:10px; padding:0 28px 28px; }
        .sigo-recovery-secondary { min-height:50px; border:1px solid #dbe3ee; border-radius:14px; background:#fff; color:#334155; font-weight:800; }
        .sigo-recovery-foot { border-top:1px solid #eef2f7; padding:16px 28px 20px; color:#94a3b8; font-size:12px; }
      `}</style>

      <div className={`sigo-tenant-bar ${matrixMode ? "sigo-tenant-bar-matrix" : ""}`} role="region" aria-label="Contexto operativo SIGO">
        <div className="sigo-tenant-copy">
          <strong>SIGO</strong>
          <span>Sistema Inteligente de Gestión Operativa</span>
          {matrixMode && isSuperadmin
            ? <small>Matriz · Superadmin</small>
            : empresaActiva && <small>{empresaActiva.empresa_nombre} · {etiquetaRol(empresaActiva.rol)}</small>}
        </div>
        <div className="topbar-actions sigo-context-actions" role="navigation" aria-label="Módulos habilitados">
          {isSuperadmin ? (
            <button className={matrixMode ? "primary-button" : "admin-button"} onClick={() => setMatrixMode(true)}>Matriz</button>
          ) : null}
          {!matrixMode && empresaActiva ? permitidos.map((item) => (
            <button key={item} className={workspace === item ? "primary-button" : "admin-button"} aria-current={workspace === item ? "page" : undefined} onClick={() => abrirWorkspace(item)}>
              {WORKSPACE_LABELS[item]}
            </button>
          )) : null}
        </div>
        {matrixMode && isSuperadmin ? (
          <button className="admin-button sigo-return-company" type="button" onClick={() => setMatrixMode(false)} disabled={!empresaActiva}>Volver a empresa</button>
        ) : (
          <TenantSwitcher key={tenantRetryKey} value={empresaActiva?.empresa_id ?? null} onChange={handleEmpresaChange} onStateChange={setTenantState} />
        )}
      </div>

      {!tenantReady || tenantState === "loading" ? (
        <main className="sigo-onboarding-card" aria-live="polite"><h1>Preparando SIGO…</h1><p>Estamos cargando tu empresa y tus permisos.</p></main>
      ) : tenantState === "error" ? (
        <main className="sigo-recovery" role="status" aria-live="polite">
          <div className="sigo-recovery-head"><div className="sigo-recovery-brand"><div className="sigo-recovery-mark">SG</div><div><strong>SIGO</strong><span>Sistema Inteligente de Gestión Operativa</span></div></div><div className="sigo-recovery-status"><span className="sigo-recovery-dot" />Reconectando tu empresa</div><h1>Estamos recuperando tu acceso</h1><p>SIGO está intentando restablecer la conexión con tu empresa automáticamente. No necesitás configurar nada.</p></div>
          <div className="sigo-recovery-actions"><button className="primary-button" type="button" onClick={() => { setAutoRetryCount(0); setTenantRetryKey((value) => value + 1); }}>Reintentar ahora</button><button className="sigo-recovery-secondary" type="button" onClick={() => void cambiarUsuario()}>Volver al ingreso</button></div>
          <div className="sigo-recovery-foot">Tus datos permanecen protegidos. SIGO no modifica información mientras completa la reconexión.</div>
        </main>
      ) : empresaActiva ? contenidoPrincipal : emptyTenantMode === "member" ? (
        <main className="sigo-recovery" role="status" aria-live="polite">
          <div className="sigo-recovery-head">
            <div className="sigo-recovery-brand"><div className="sigo-recovery-mark">SG</div><div><strong>SIGO</strong><span>Sistema Inteligente de Gestión Operativa</span></div></div>
            <div className="sigo-recovery-status"><span className="sigo-recovery-dot" />Esperando asignación</div>
            <h1>Tu cuenta está lista</h1>
            <p>Esta cuenta fue creada para trabajar dentro de una empresa existente. Pedile al administrador que agregue tu mismo email. SIGO verifica el acceso automáticamente cada pocos segundos.</p>
          </div>
          <div className="sigo-recovery-actions">
            <button className="primary-button" type="button" onClick={() => setTenantRetryKey((value) => value + 1)}>Actualizar acceso ahora</button>
            <button className="sigo-recovery-secondary" type="button" onClick={() => void cambiarUsuario()}>Volver al ingreso</button>
          </div>
          <div className="sigo-recovery-foot">No se crea una empresa nueva para este tipo de cuenta, evitando tenants duplicados por error.</div>
        </main>
      ) : emptyTenantMode === "checking" || autoProvisionando ? (
        <main className="sigo-onboarding-card" aria-live="polite"><h1>Revisando tu acceso…</h1><p>Estamos verificando si tenés una empresa asignada o un alta pendiente.</p></main>
      ) : (
        <main className="sigo-onboarding-card" aria-live="polite">
          <h1>Todavía no tenés una empresa asignada</h1>
          <p>Si vas a administrar tu propio negocio, podés crear la empresa ahora. Si pertenecés a un equipo existente, cerrá sesión y creá una cuenta de usuario para que el administrador te asigne correctamente.</p>
          <form onSubmit={crearPrimeraEmpresa}>
            <input aria-label="Nombre de la empresa" placeholder="Nombre de la empresa o negocio" value={nuevaEmpresa} onChange={(event) => setNuevaEmpresa(event.target.value)} autoComplete="organization" required disabled={autoProvisionando} />
            {errorEmpresa ? <div className="sigo-onboarding-error" role="alert">{errorEmpresa}</div> : null}
            <button className="primary-button" type="submit" disabled={creandoEmpresa || autoProvisionando}>{creandoEmpresa || autoProvisionando ? "Configurando…" : "Crear mi empresa"}</button>
          </form>
        </main>
      )}
    </div>
  );
}

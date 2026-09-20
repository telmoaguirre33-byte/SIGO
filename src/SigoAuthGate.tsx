import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import "./auth.css";

type Props = { children: ReactNode };
type AuthMode = "login" | "register" | "register_member" | "subscription" | "recovery";

const SIGO_PRODUCTION_URL = "https://comercial-lilac.vercel.app/";
const PENDING_EMPRESA_METADATA_KEY = "sigo_empresa_nombre";
const ONBOARDING_MODE_METADATA_KEY = "sigo_onboarding_mode";
const OWNER_ONBOARDING_MODE = "owner";
const STAFF_ONBOARDING_MODE = "member";
const SIGO_TRIAL_DAYS = 15;
const SIGO_TRIAL_MS = SIGO_TRIAL_DAYS * 24 * 60 * 60 * 1000;
const SIGO_TRIAL_POLICY_EFFECTIVE_AT = Date.parse("2026-09-20T17:00:00.000Z");
const MERCADOPAGO_SUBSCRIPTION_URL = String(import.meta.env.VITE_MERCADOPAGO_SUBSCRIPTION_URL ?? "").trim();

function pruebaVencida(session: Session) {
  const metadata = session.user.user_metadata ?? {};
  if (metadata[ONBOARDING_MODE_METADATA_KEY] !== OWNER_ONBOARDING_MODE) return false;
  const createdAt = Date.parse(session.user.created_at);
  if (!Number.isFinite(createdAt) || createdAt < SIGO_TRIAL_POLICY_EFFECTIVE_AT) return false;
  return Date.now() >= createdAt + SIGO_TRIAL_MS;
}

function esLimiteTemporal(errorMessage: string) {
  const normalized = errorMessage.toLowerCase();
  return normalized.includes("rate limit") || normalized.includes("too many requests");
}

function mensajeAcceso(errorMessage: string) {
  const normalized = errorMessage.toLowerCase();
  if (normalized.includes("invalid login credentials")) return "Email o contraseña incorrectos.";
  if (normalized.includes("email not confirmed")) return "Tu cuenta necesita activación. Podés reenviar el correo desde acá.";
  if (normalized.includes("already registered") || normalized.includes("user already registered")) return "Ese email ya tiene una cuenta. Ingresá o usá Recuperar acceso.";
  if (normalized.includes("expired") && (normalized.includes("link") || normalized.includes("token"))) return "El enlace venció. Solicitá uno nuevo desde Recuperar acceso.";
  if (esLimiteTemporal(errorMessage)) return "El servicio de correo está temporalmente ocupado. Probá nuevamente en un minuto.";
  if (normalized.includes("banned") || normalized.includes("disabled")) return "Tu acceso está deshabilitado. Contactá al administrador de tu empresa.";
  if (normalized.includes("network") || normalized.includes("fetch")) return "No pudimos conectarnos. Revisá tu conexión a internet e intentá otra vez.";
  return "No pudimos completar la operación. Revisá los datos e intentá nuevamente.";
}

export default function SigoAuthGate({ children }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [empresaNombre, setEmpresaNombre] = useState("");
  const [telefonoRegistro, setTelefonoRegistro] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<AuthMode>("login");
  const [puedeReenviarActivacion, setPuedeReenviarActivacion] = useState(false);
  const requestInFlight = useRef(false);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!mounted) return;
      if (sessionError) setError("No pudimos verificar tu sesión. Intentá nuevamente.");
      setSession(data.session ?? null);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      if (event === "PASSWORD_RECOVERY") {
        setMode("recovery");
        setError("");
        setSuccess("Enlace validado. Elegí una nueva contraseña.");
      }
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  function limpiarMensajes() {
    setError("");
    setSuccess("");
    setPuedeReenviarActivacion(false);
  }

  function cambiarModo(next: AuthMode) {
    limpiarMensajes();
    setMode(next);
  }

  function comenzarSolicitud(): boolean {
    if (requestInFlight.current) return false;
    requestInFlight.current = true;
    setSubmitting(true);
    return true;
  }

  function terminarSolicitud() {
    requestInFlight.current = false;
    setSubmitting(false);
  }

  function abrirMercadoPago() {
    limpiarMensajes();
    if (!MERCADOPAGO_SUBSCRIPTION_URL) {
      setError("Mercado Pago está preparado en SIGO, pero todavía falta vincular el plan de suscripción de producción.");
      return;
    }
    window.location.assign(MERCADOPAGO_SUBSCRIPTION_URL);
  }

  async function iniciarSesion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!comenzarSolicitud()) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      terminarSolicitud();
      return;
    }

    limpiarMensajes();
    const { data, error: loginError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
    terminarSolicitud();

    if (loginError || !data.session) {
      const mensaje = loginError?.message ?? "unknown";
      setError(mensajeAcceso(mensaje));
      setPuedeReenviarActivacion(mensaje.toLowerCase().includes("email not confirmed"));
      return;
    }
    setEmail(normalizedEmail);
    setSession(data.session);
  }

  async function registrarme(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!comenzarSolicitud()) return;
    const normalizedEmail = email.trim().toLowerCase();
    const nombre = empresaNombre.trim();
    const telefono = telefonoRegistro.trim();

    if (!nombre) {
      setError("Ingresá la razón social o nombre de tu empresa.");
      terminarSolicitud();
      return;
    }
    if (!telefono) {
      setError("Ingresá un teléfono de contacto.");
      terminarSolicitud();
      return;
    }
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      terminarSolicitud();
      return;
    }

    limpiarMensajes();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: SIGO_PRODUCTION_URL,
        data: {
          [PENDING_EMPRESA_METADATA_KEY]: nombre,
          [ONBOARDING_MODE_METADATA_KEY]: OWNER_ONBOARDING_MODE,
          sigo_telefono_contacto: telefono,
          sigo_email_contacto: normalizedEmail,
          sigo_trial_days: SIGO_TRIAL_DAYS,
          sigo_trial_started_at: new Date().toISOString(),
        },
      },
    });

    if (signUpError) {
      terminarSolicitud();
      if (esLimiteTemporal(signUpError.message)) {
        setEmail(normalizedEmail);
        setMode("login");
        setPuedeReenviarActivacion(true);
        setError("No pudimos enviar el correo de activación en este momento. Tu cuenta puede haber quedado creada; probá ingresar o reenviá la activación en un minuto.");
        return;
      }
      setError(mensajeAcceso(signUpError.message));
      return;
    }

    if (!data.session) {
      terminarSolicitud();
      setEmail(normalizedEmail);
      setSuccess("Cuenta creada. Te enviamos un correo para activarla. Tu prueba gratis de 15 días queda asociada al alta de la empresa.");
      setPuedeReenviarActivacion(true);
      setMode("login");
      return;
    }

    const { error: empresaError } = await supabase.rpc("crear_empresa", {
      p_nombre: nombre,
      p_razon_social: null,
      p_cuit: null,
    });

    if (!empresaError) {
      const { error: metadataError } = await supabase.auth.updateUser({
        data: { [PENDING_EMPRESA_METADATA_KEY]: null },
      });
      if (metadataError) console.warn("No se pudo limpiar el alta pendiente de empresa", metadataError);
    }
    terminarSolicitud();

    if (empresaError) {
      setError("La cuenta se creó, pero no pudimos terminar el alta de la empresa. SIGO va a reintentar automáticamente cuando ingreses.");
      setSession(data.session);
      return;
    }

    setSuccess("Cuenta y empresa creadas correctamente. Tu prueba gratis de 15 días ya comenzó.");
    setSession(data.session);
  }

  async function registrarmeComoUsuario(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!comenzarSolicitud()) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Ingresá tu email.");
      terminarSolicitud();
      return;
    }
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      terminarSolicitud();
      return;
    }

    limpiarMensajes();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: SIGO_PRODUCTION_URL,
        data: { [ONBOARDING_MODE_METADATA_KEY]: STAFF_ONBOARDING_MODE },
      },
    });
    terminarSolicitud();

    if (signUpError) {
      setError(mensajeAcceso(signUpError.message));
      return;
    }

    setEmail(normalizedEmail);
    if (data.session) {
      setSuccess("Cuenta creada. Pedile al administrador de tu empresa que agregue este email; SIGO va a detectar el acceso automáticamente.");
      setSession(data.session);
      return;
    }

    setSuccess("Cuenta de usuario creada. Activala desde el correo y pedile al administrador que agregue este mismo email a la empresa.");
    setPuedeReenviarActivacion(true);
    setMode("login");
  }

  async function reenviarActivacion() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !comenzarSolicitud()) return;
    setError("");
    setSuccess("");

    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email: normalizedEmail,
      options: { emailRedirectTo: SIGO_PRODUCTION_URL },
    });
    terminarSolicitud();

    if (resendError) {
      setError(mensajeAcceso(resendError.message));
      return;
    }
    setSuccess("Te reenviamos el correo de activación.");
  }

  async function recuperarAcceso() {
    const normalizedEmail = email.trim().toLowerCase();
    limpiarMensajes();
    if (!normalizedEmail) {
      setError("Ingresá tu email para recuperar el acceso.");
      return;
    }
    if (!comenzarSolicitud()) return;

    const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: SIGO_PRODUCTION_URL,
    });
    terminarSolicitud();

    if (recoveryError) {
      setError(mensajeAcceso(recoveryError.message));
      return;
    }
    setSuccess("Si ese email tiene una cuenta, vas a recibir un mensaje para crear una nueva contraseña.");
  }

  async function guardarNuevaPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!comenzarSolicitud()) return;
    limpiarMensajes();
    if (newPassword.length < 8) {
      setError("La nueva contraseña debe tener al menos 8 caracteres.");
      terminarSolicitud();
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    terminarSolicitud();
    if (updateError) {
      setError("No pudimos guardar la nueva contraseña. Volvé a abrir el enlace recibido e intentá otra vez.");
      return;
    }
    setNewPassword("");
    setMode("login");
    setSuccess("Contraseña actualizada. Ya podés continuar en SIGO.");
  }

  if (loading) return <main className="sigo-auth-screen"><section className="sigo-auth-card">Verificando sesión…</section></main>;
  if (session && mode !== "recovery") {
    if (!pruebaVencida(session)) return <>{children}</>;
    return (
      <main className="sigo-auth-screen">
        <section className="sigo-auth-card" aria-labelledby="sigo-trial-expired-title">
          <div className="sigo-auth-brand">
            <div className="sigo-auth-brand-mark" aria-hidden="true">SG</div>
            <div className="sigo-auth-brand-copy"><strong>SIGO</strong><span>Sistema Inteligente de Gestión Operativa</span></div>
          </div>
          <h1 id="sigo-trial-expired-title">Finalizó tu prueba de 15 días</h1>
          <p className="sigo-auth-subtitle">Tus datos siguen guardados. Activá la suscripción para continuar usando SIGO.</p>
          {error ? <div className="sigo-auth-error" role="alert">{error}</div> : null}
          <button className="sigo-auth-submit sigo-mercadopago-button" type="button" onClick={abrirMercadoPago}>Activar con Mercado Pago</button>
          <button className="sigo-auth-secondary" type="button" onClick={() => void supabase.auth.signOut()}>Cerrar sesión</button>
        </section>
      </main>
    );
  }

  const campoPassword = (value: string, onChange: (value: string) => void, autoComplete: string) => (
    <label className="sigo-auth-field">
      <span>Contraseña</span>
      <div className="sigo-password-wrap">
        <input
          type={showPassword ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          minLength={mode === "register" || mode === "register_member" || mode === "recovery" ? 8 : undefined}
          required
        />
        <button className="sigo-password-toggle" type="button" onClick={() => setShowPassword((value) => !value)}>
          {showPassword ? "Ocultar" : "Ver"}
        </button>
      </div>
    </label>
  );

  return (
    <main className="sigo-auth-screen">
      <section className="sigo-auth-card" aria-labelledby="sigo-login-title">
        <div className="sigo-auth-brand">
          <div className="sigo-auth-brand-mark" aria-hidden="true">SG</div>
          <div className="sigo-auth-brand-copy"><strong>SIGO</strong><span>Sistema Inteligente de Gestión Operativa</span></div>
        </div>

        {mode === "recovery" ? (
          <>
            <h1 id="sigo-login-title">Nueva contraseña</h1>
            <p className="sigo-auth-subtitle">Elegí una contraseña nueva para recuperar tu acceso.</p>
            <form onSubmit={guardarNuevaPassword} className="sigo-auth-form">
              {campoPassword(newPassword, setNewPassword, "new-password")}
              {error ? <div className="sigo-auth-error" role="alert">{error}</div> : null}
              {success ? <div className="sigo-auth-success" role="status">{success}</div> : null}
              <button className="sigo-auth-submit" type="submit" disabled={submitting}>{submitting ? "Guardando…" : "Guardar contraseña"}</button>
            </form>
          </>
        ) : mode === "subscription" ? (
          <>
            <h1 id="sigo-login-title">Suscripción</h1>
            <p className="sigo-auth-subtitle">Elegí el medio de pago para activar o renovar SIGO. El cobro recurrente se gestiona de forma segura fuera de la app.</p>
            <div className="sigo-subscription-card">
              <div className="sigo-subscription-provider">
                <span className="sigo-subscription-logo" aria-hidden="true">MP</span>
                <div><strong>Mercado Pago</strong><small>Suscripción mensual · pago seguro</small></div>
              </div>
              {error ? <div className="sigo-auth-error" role="alert">{error}</div> : null}
              <button className="sigo-auth-submit sigo-mercadopago-button" type="button" onClick={abrirMercadoPago}>Continuar con Mercado Pago</button>
              <p className="sigo-subscription-note">SIGO no guarda datos de tarjeta. Mercado Pago procesa el medio de pago y los cobros recurrentes.</p>
            </div>
            <button className="sigo-auth-secondary" type="button" onClick={() => cambiarModo("login")}>Volver al ingreso</button>
          </>
        ) : mode === "register_member" ? (
          <>
            <h1 id="sigo-login-title">Crear cuenta de usuario</h1>
            <p className="sigo-auth-subtitle">Usá esta opción si un administrador te va a sumar a una empresa existente. No se crea una empresa nueva.</p>
            <form onSubmit={registrarmeComoUsuario} className="sigo-auth-form">
              <label className="sigo-auth-field"><span>Email</span><input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
              {campoPassword(password, setPassword, "new-password")}
              {error ? <div className="sigo-auth-error" role="alert">{error}</div> : null}
              {success ? <div className="sigo-auth-success" role="status">{success}</div> : null}
              <button className="sigo-auth-submit" type="submit" disabled={submitting}>{submitting ? "Creando usuario…" : "Crear cuenta de usuario"}</button>
              <button className="sigo-auth-secondary" type="button" onClick={() => cambiarModo("login")}>Volver al ingreso</button>
            </form>
          </>
        ) : mode === "register" ? (
          <>
            <h1 id="sigo-login-title">Prueba gratis 15 días</h1>
            <p className="sigo-auth-subtitle">Creá tu empresa, quedá como administrador principal y probá SIGO durante 15 días sin pagar para empezar.</p>
            <form onSubmit={registrarme} className="sigo-auth-form">
              <label className="sigo-auth-field"><span>Razón social / negocio</span><input value={empresaNombre} onChange={(e) => setEmpresaNombre(e.target.value)} autoComplete="organization" required /></label>
              <label className="sigo-auth-field"><span>Teléfono de contacto</span><input type="tel" inputMode="tel" autoComplete="tel" value={telefonoRegistro} onChange={(e) => setTelefonoRegistro(e.target.value)} placeholder="Ej.: +54 9 376..." required /></label>
              <label className="sigo-auth-field"><span>Email</span><input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
              {campoPassword(password, setPassword, "new-password")}
              {error ? <div className="sigo-auth-error" role="alert">{error}</div> : null}
              {success ? <div className="sigo-auth-success" role="status">{success}</div> : null}
              <button className="sigo-auth-submit" type="submit" disabled={submitting}>{submitting ? "Creando cuenta…" : "Comenzar prueba gratis 15 días"}</button>
              <button className="sigo-auth-secondary" type="button" onClick={() => cambiarModo("subscription")}>Suscripción</button>
              <button className="sigo-auth-secondary" type="button" onClick={() => cambiarModo("register_member")}>Me voy a sumar a una empresa</button>
              <button className="sigo-auth-secondary" type="button" onClick={() => cambiarModo("login")}>Ya tengo cuenta</button>
            </form>
          </>
        ) : (
          <>
            <h1 id="sigo-login-title">Ingresar</h1>
            <p className="sigo-auth-subtitle">Ingresá con tu email y contraseña.</p>
            <form onSubmit={iniciarSesion} className="sigo-auth-form">
              <label className="sigo-auth-field"><span>Email</span><input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
              {campoPassword(password, setPassword, "current-password")}
              {error ? <div className="sigo-auth-error" role="alert">{error}</div> : null}
              {success ? <div className="sigo-auth-success" role="status">{success}</div> : null}
              <button className="sigo-auth-submit" type="submit" disabled={submitting}>{submitting ? "Ingresando…" : "Ingresar a SIGO"}</button>
              {puedeReenviarActivacion ? <button className="sigo-auth-secondary" type="button" disabled={submitting} onClick={() => void reenviarActivacion()}>Reenviar activación</button> : null}
              <button className="sigo-auth-trial" type="button" disabled={submitting} onClick={() => cambiarModo("register")}>Probar gratis 15 días</button>
              <button className="sigo-auth-subscription" type="button" disabled={submitting} onClick={() => cambiarModo("subscription")}>Suscripción</button>
              <button className="sigo-auth-secondary" type="button" disabled={submitting} onClick={() => cambiarModo("register_member")}>Crear cuenta de usuario</button>
              <button className="sigo-auth-secondary" type="button" disabled={submitting} onClick={() => void recuperarAcceso()}>Recuperar acceso</button>
            </form>
          </>
        )}

        <div className="sigo-auth-help">Acceso seguro por empresa, rol y permisos.</div>
      </section>
    </main>
  );
}

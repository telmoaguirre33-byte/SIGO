import { useCallback, useEffect, useState } from "react";
import { Bell, BellRing, BellOff, Check, LoaderCircle, Send, Smartphone } from "lucide-react";
import { supabase } from "./supabase";

type NotificationRow = { id: string; title: string; body: string; created_at: string; read_at: string | null };

function decodeKey(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function tokenActual() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || "";
}

export default function AdminNotifications() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [unread, setUnread] = useState(0);

  const loadHistory = useCallback(async () => {
    const { data, error } = await supabase.from("sigo_admin_notifications")
      .select("id,title,body,created_at,read_at")
      .order("created_at", { ascending: false }).limit(50);
    if (error) return;
    const list = (data || []) as NotificationRow[];
    setRows(list);
    setUnread(list.filter((row) => !row.read_at).length);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    setPermission(Notification.permission);
    void navigator.serviceWorker?.getRegistration("/").then(async (registration) => {
      if (!registration) return;
      setEnabled(Boolean(await registration.pushManager.getSubscription()));
    });
    void loadHistory();
    const channel = supabase.channel("sigo-admin-notification-history")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sigo_admin_notifications" }, () => void loadHistory())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadHistory]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => void loadHistory(), 20_000);
    return () => window.clearInterval(timer);
  }, [open, loadHistory]);

  async function enablePush() {
    setBusy(true); setMessage("");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setMessage("Este navegador no permite notificaciones push. Abrí SIGO en Chrome para Android.");
        return;
      }
      const decision = await Notification.requestPermission();
      setPermission(decision);
      if (decision !== "granted") {
        setMessage("Habilitá las notificaciones de SIGO en los permisos del navegador y volvé a intentar.");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const configResponse = await fetch("/api/notificaciones?config=push", { cache: "no-store" });
      const config = await configResponse.json();
      if (!configResponse.ok || !config.publicKey) throw new Error("PUSH_NOT_CONFIGURED");
      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeKey(config.publicKey),
      });
      const accessToken = await tokenActual();
      if (!accessToken) throw new Error("AUTH_REQUIRED");
      const response = await fetch("/api/notificaciones", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ action: "subscribe", subscription: subscription.toJSON() }),
      });
      if (!response.ok) throw new Error((await response.json()).error || "SUBSCRIPTION_SAVE_FAILED");
      setEnabled(true);
      setMessage("Notificaciones habilitadas en este celular.");
    } catch (error) {
      const code = error instanceof Error ? error.message : "UNKNOWN";
      setMessage(code === "PUSH_NOT_CONFIGURED" ? "Falta configurar las claves Web Push del servidor." : "No se pudo habilitar este dispositivo. Revisá la conexión y los permisos del navegador.");
    } finally { setBusy(false); }
  }

  async function disablePush() {
    setBusy(true); setMessage("");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const accessToken = await tokenActual();
        await fetch("/api/notificaciones", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ action: "unsubscribe", endpoint: subscription.endpoint }) });
        await subscription.unsubscribe();
      }
      setEnabled(false); setMessage("Notificaciones desactivadas en este celular.");
    } finally { setBusy(false); }
  }

  async function sendTest() {
    setBusy(true); setMessage("");
    try {
      const accessToken = await tokenActual();
      const response = await fetch("/api/notificaciones", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ action: "test" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "PUSH_SEND_FAILED");
      setMessage("Prueba enviada al servicio push. Revisá la notificación en este celular; el servidor no puede confirmar lo que muestra Android.");
      await loadHistory();
    } catch (error) {
      const code = error instanceof Error ? error.message : "UNKNOWN";
      setMessage(code === "NO_ACTIVE_DEVICE" ? "Primero habilitá las notificaciones en este celular." : "No se pudo enviar la prueba. Revisá la configuración y la conexión.");
    } finally { setBusy(false); }
  }

  async function markRead() {
    const ids = rows.filter((row) => !row.read_at).map((row) => row.id);
    if (!ids.length) return;
    await supabase.from("sigo_admin_notifications").update({ read_at: new Date().toISOString() }).in("id", ids);
    await loadHistory();
  }

  const buttonStyle = { display: "inline-flex", alignItems: "center", gap: 8 } as const;
  return <section className="panel" aria-label="Notificaciones privadas del administrador">
    <div className="panel-header" style={{ alignItems: "center", flexWrap: "wrap" }}>
      <div><h3><Bell size={18} style={{ verticalAlign: "-3px", marginRight: 7 }} />Notificaciones del administrador</h3><p>Privadas para la cuenta superadministradora de SIGO.</p></div>
      <button type="button" className={open ? "primary-button" : "admin-button"} onClick={() => { setOpen((value) => !value); void loadHistory(); }} aria-expanded={open} style={buttonStyle}>
        {unread ? <BellRing size={17} /> : <Bell size={17} />} Historial{unread ? ` (${unread})` : ""}
      </button>
    </div>
    {open && <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {enabled ? <button type="button" className="admin-button" onClick={() => void disablePush()} disabled={busy} style={buttonStyle}><BellOff size={16} />Desactivar en este celular</button> : <button type="button" className="primary-button" onClick={() => void enablePush()} disabled={busy} style={buttonStyle}><Smartphone size={16} />Habilitar en este celular</button>}
        <button type="button" className="admin-button" onClick={() => void sendTest()} disabled={busy || !enabled} style={buttonStyle}><Send size={16} />Enviar prueba</button>
        <button type="button" className="admin-button" onClick={() => void markRead()} disabled={!unread || busy} style={buttonStyle}><Check size={16} />Marcar leídas</button>
        {busy && <LoaderCircle size={18} className="spin" aria-label="Procesando" />}
      </div>
      <small role="status" aria-live="polite">{message || (permission === "denied" ? "El navegador bloqueó los avisos. Habilitalos desde Ajustes del sitio en Chrome." : enabled ? "Este dispositivo quedó registrado para recibir avisos aunque SIGO esté cerrado." : "Android mostrará el pedido de permiso al habilitar esta opción.")}</small>
      {rows.length ? <div style={{ display: "grid", gap: 7 }}>{rows.map((row) => <article key={row.id} style={{ padding: 10, border: "1px solid #e2e8f0", borderRadius: 10, background: row.read_at ? "#fff" : "#eff6ff" }}><strong>{row.title}</strong><p style={{ margin: "4px 0", color: "#475569" }}>{row.body}</p><small>{new Date(row.created_at).toLocaleString("es-AR")}{!row.read_at ? " · Nueva" : ""}</small></article>)}</div> : <p>No hay notificaciones todavía.</p>}
    </div>}
  </section>;
}

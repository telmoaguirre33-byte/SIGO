import { supabase } from "./supabase";

export async function notificarAltaEmpresaAdmin(empresaId: string) {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token || !empresaId) return;
    await fetch("/api/notificaciones", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "new-client", companyId: empresaId }),
    });
  } catch (error) {
    console.warn("El aviso de alta se enviará en el próximo ciclo de notificaciones", error);
  }
}

export async function cerrarSesionConPushRevocado() {
  const registration = await navigator.serviceWorker?.getRegistration("/").catch(() => undefined);
  const subscription = await registration?.pushManager.getSubscription().catch(() => null);
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (token) {
    try {
      await fetch("/api/notificaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "unsubscribe-all" }),
      });
    } catch { /* El cierre de sesión debe seguir disponible aunque no haya conexión. */ }
  }
  if (subscription) await subscription.unsubscribe().catch(() => false);
  await supabase.auth.signOut();
}

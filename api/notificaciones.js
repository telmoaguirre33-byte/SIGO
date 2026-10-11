import { authorizeSuperadmin, authorizeUser, configureWebPush, json, sendToAdminSubscriptions } from "../lib/admin-notifications.js";

export default async function handler(req, res) {
  if (req.method === "GET" && req.query?.config === "push") {
    const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
    if (!publicKey) return json(res, 503, { error: "PUSH_NOT_CONFIGURED" });
    return json(res, 200, { publicKey });
  }

  if (req.method !== "POST") return json(res, 405, { error: "METHOD_NOT_ALLOWED" });
  const action = String(req.body?.action || "");
  let auth;
  try {
    auth = action === "new-client" ? await authorizeUser(req) : await authorizeSuperadmin(req);
  } catch {
    return json(res, 503, { error: "NOTIFICATIONS_UNAVAILABLE" });
  }
  if (auth.error) return json(res, auth.status, { error: auth.error });

  const { client, user } = auth;
  if (action === "subscribe") {
    const subscription = req.body?.subscription;
    const endpoint = String(subscription?.endpoint || "");
    const p256dh = String(subscription?.keys?.p256dh || "");
    const authSecret = String(subscription?.keys?.auth || "");
    if (!endpoint.startsWith("https://") || endpoint.length > 4096 || !p256dh || p256dh.length > 512 || !authSecret || authSecret.length > 512) {
      return json(res, 400, { error: "INVALID_SUBSCRIPTION" });
    }
    try { configureWebPush(); } catch { return json(res, 503, { error: "PUSH_NOT_CONFIGURED" }); }
    const { error } = await client.from("sigo_admin_push_subscriptions").upsert({
      user_id: user.id, endpoint, p256dh, auth_secret: authSecret,
      updated_at: new Date().toISOString(), revoked_at: null,
    }, { onConflict: "endpoint" });
    if (error) return json(res, 500, { error: "SUBSCRIPTION_SAVE_FAILED" });
    return json(res, 200, { ok: true });
  }

  if (action === "unsubscribe") {
    const endpoint = String(req.body?.endpoint || "");
    if (!endpoint.startsWith("https://") || endpoint.length > 4096) return json(res, 400, { error: "INVALID_ENDPOINT" });
    const { error } = await client.from("sigo_admin_push_subscriptions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", user.id).eq("endpoint", endpoint);
    if (error) return json(res, 500, { error: "UNSUBSCRIBE_FAILED" });
    return json(res, 200, { ok: true });
  }

  if (action === "unsubscribe-all") {
    const { error } = await client.from("sigo_admin_push_subscriptions")
      .update({ revoked_at: new Date().toISOString() }).eq("user_id", user.id).is("revoked_at", null);
    return error ? json(res, 500, { error: "UNSUBSCRIBE_FAILED" }) : json(res, 200, { ok: true });
  }

  if (action === "test") {
    const timeBucket = Math.floor(Date.now() / 60_000);
    const eventKey = `push-test:${user.id}:${timeBucket}`;
    const { data: recent } = await client.from("sigo_admin_notifications")
      .select("created_at").like("event_key", `push-test:${user.id}:%`)
      .gte("created_at", new Date(Date.now() - 60_000).toISOString()).limit(1);
    if (recent?.length) return json(res, 429, { error: "TEST_RATE_LIMIT" });

    const notification = {
      title: "SIGO Gestión — Prueba",
      body: "Las notificaciones de SIGO funcionan correctamente.",
      tag: `sigo-${eventKey}`,
      data: { url: "/", notificationId: eventKey },
    };
    const { error } = await client.from("sigo_admin_notifications").insert({
      event_key: eventKey,
      title: notification.title,
      body: notification.body,
    });
    if (error) return json(res, 500, { error: "TEST_RECORD_FAILED" });
    const { data: claims, error: claimError } = await client.rpc("sigo_claim_admin_notification", { p_event_key: eventKey });
    if (claimError || !claims?.[0]) return json(res, 503, { error: "TEST_CLAIM_FAILED" });
    const claim = claims[0];
    try {
      const result = await sendToAdminSubscriptions(client, notification);
      await client.rpc("sigo_finish_admin_notification", { p_id: claim.id, p_claim_token: claim.claim_token, p_error: result.sent ? null : "NO_ACTIVE_DEVICE" });
      return json(res, result.sent ? 200 : 409, { ok: result.sent > 0, ...result, error: result.sent ? undefined : "NO_ACTIVE_DEVICE" });
    } catch {
      await client.rpc("sigo_finish_admin_notification", { p_id: claim.id, p_claim_token: claim.claim_token, p_error: "PUSH_SEND_FAILED" });
      return json(res, 503, { error: "PUSH_SEND_FAILED" });
    }
  }

  if (action === "new-client") {
    const companyId = String(req.body?.companyId || "");
    if (!/^[0-9a-f-]{36}$/i.test(companyId)) return json(res, 400, { error: "INVALID_COMPANY" });
    const { data: membership, error: membershipError } = await client.from("empresa_usuarios")
      .select("empresa_id").eq("empresa_id", companyId).eq("user_id", user.id).eq("rol", "owner").eq("activo", true).maybeSingle();
    if (membershipError) return json(res, 500, { error: "CLIENT_EVENT_FAILED" });
    if (!membership) return json(res, 403, { error: "COMPANY_OWNER_REQUIRED" });

    const eventKey = `cliente-nuevo:${companyId}`;
    const { data: claims, error } = await client.rpc("sigo_claim_admin_notification", { p_event_key: eventKey });
    if (error) return json(res, 503, { error: "NOTIFICATION_NOT_READY" });
    const row = claims?.[0];
    if (!row) return json(res, 200, { ok: true, duplicate: true });
    try {
      const result = await sendToAdminSubscriptions(client, { title: row.title, body: row.body, tag: `sigo-${row.id}`, data: { url: "/", notificationId: row.id } });
      await client.rpc("sigo_finish_admin_notification", { p_id: row.id, p_claim_token: row.claim_token, p_error: result.sent ? null : "NO_ACTIVE_DEVICE" });
      return json(res, result.sent ? 200 : 409, { ok: result.sent > 0, ...result, error: result.sent ? undefined : "NO_ACTIVE_DEVICE" });
    } catch {
      await client.rpc("sigo_finish_admin_notification", { p_id: row.id, p_claim_token: row.claim_token, p_error: "PUSH_SEND_FAILED" });
      return json(res, 503, { error: "PUSH_SEND_FAILED" });
    }
  }

  if (action === "dismiss") {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id) => typeof id === "string").slice(0, 100) : [];
    if (!ids.length) return json(res, 200, { ok: true });
    const { error } = await client.from("sigo_admin_notifications").update({ read_at: new Date().toISOString() }).in("id", ids).is("read_at", null);
    return error ? json(res, 500, { error: "MARK_READ_FAILED" }) : json(res, 200, { ok: true });
  }

  return json(res, 400, { error: "UNKNOWN_ACTION" });
}

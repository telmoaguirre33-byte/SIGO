import { json, sendToAdminSubscriptions, serviceClient } from "../../lib/admin-notifications.js";

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const authorization = req.headers.authorization || "";
  if (!secret || authorization !== `Bearer ${secret}`) return json(res, 401, { error: "UNAUTHORIZED" });
  if (req.method !== "GET") return json(res, 405, { error: "METHOD_NOT_ALLOWED" });

  try {
    const client = serviceClient();
    const generated = await client.rpc("sigo_generar_avisos_vencimiento_admin");
    if (generated.error) throw generated.error;
    const { data: pending, error } = await client.rpc("sigo_claim_pending_admin_notifications", { p_limit: 50 });
    if (error) throw error;

    let sent = 0;
    for (const row of pending || []) {
      const result = await sendToAdminSubscriptions(client, {
        title: row.title,
        body: row.body,
        tag: `sigo-${row.id}`,
        data: { url: "/", notificationId: row.id },
      });
      const completed = await client.rpc("sigo_finish_admin_notification", {
        p_id: row.id,
        p_claim_token: row.claim_token,
        p_error: result.sent ? null : "NO_ACTIVE_DEVICE",
      });
      if (completed.error) throw completed.error;
      if (result.sent) sent += 1;
    }
    return json(res, 200, { ok: true, pending: pending?.length || 0, sent });
  } catch {
    return json(res, 500, { error: "NOTIFICATION_CRON_FAILED" });
  }
}

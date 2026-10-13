import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function serviceClient() {
  if (!supabaseUrl || !serviceKey) throw new Error("NOTIFICATIONS_SERVER_CONFIG_MISSING");
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function authorizeUser(req) {
  const authorization = req.headers.authorization || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { error: "AUTH_REQUIRED", status: 401 };

  const client = serviceClient();
  const { data: authData, error: authError } = await client.auth.getUser(token);
  if (authError || !authData.user) return { error: "AUTH_INVALID", status: 401 };
  return { client, user: authData.user };
}

export async function authorizeSuperadmin(req) {
  const auth = await authorizeUser(req);
  if (auth.error) return auth;
  const { data: admin, error: adminError } = await auth.client
    .from("sigo_superadmins")
    .select("user_id")
    .eq("user_id", auth.user.id)
    .eq("activo", true)
    .maybeSingle();
  if (adminError) throw adminError;
  if (!admin) return { error: "ADMIN_REQUIRED", status: 403 };
  return auth;
}

export function configureWebPush() {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) throw new Error("WEB_PUSH_KEYS_MISSING");
  webpush.setVapidDetails(process.env.WEB_PUSH_VAPID_SUBJECT || "mailto:sigogestion4@gmail.com", publicKey, privateKey);
}

export async function sendToAdminSubscriptions(client, payload) {
  configureWebPush();
  const { data: admins, error: adminsError } = await client
    .from("sigo_superadmins").select("user_id").eq("activo", true);
  if (adminsError) throw adminsError;
  const adminIds = (admins || []).map((row) => row.user_id);
  if (!adminIds.length) return { sent: 0, failed: 0 };

  const { data: subscriptions, error: subsError } = await client
    .from("sigo_admin_push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth_secret")
    .in("user_id", adminIds)
    .is("revoked_at", null);
  if (subsError) throw subsError;

  let sent = 0;
  let failed = 0;
  for (const row of subscriptions || []) {
    try {
      await webpush.sendNotification({
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth_secret },
      }, JSON.stringify(payload), { TTL: 60 * 60 * 24, urgency: "normal" });
      sent += 1;
    } catch (error) {
      failed += 1;
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        await client.from("sigo_admin_push_subscriptions").update({ revoked_at: new Date().toISOString() }).eq("id", row.id);
      }
    }
  }
  return { sent, failed };
}

export function json(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(body);
}

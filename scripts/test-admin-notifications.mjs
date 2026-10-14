import assert from "node:assert/strict";
import webpush from "web-push";

const adminId = "11111111-1111-4111-8111-111111111111";
const memberId = "22222222-2222-4222-8222-222222222222";
const keys = webpush.generateVAPIDKeys();
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const headers = new Headers(init.headers || (typeof input === "string" ? undefined : input.headers));
  if (url.pathname === "/auth/v1/user") {
    const token = (headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const id = token === "admin-token" ? adminId : token === "member-token" ? memberId : null;
    return Response.json(id ? { id, email: "test@example.invalid" } : { message: "invalid token" }, { status: id ? 200 : 401 });
  }
  if (url.pathname === "/rest/v1/sigo_superadmins") {
    const authorized = url.searchParams.get("user_id") === `eq.${adminId}` && url.searchParams.get("activo") === "eq.true";
    return Response.json(authorized ? [{ user_id: adminId }] : []);
  }
  throw new Error(`Unexpected mock request: ${url.pathname}`);
};

process.env.SUPABASE_URL = "https://mock.supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.WEB_PUSH_VAPID_PUBLIC_KEY = keys.publicKey;
process.env.WEB_PUSH_VAPID_PRIVATE_KEY = keys.privateKey;

const { authorizeSuperadmin, configureWebPush } = await import("../lib/admin-notifications.js");
const request = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} });

assert.equal((await authorizeSuperadmin(request())).status, 401, "missing token must be rejected");
assert.equal((await authorizeSuperadmin(request("invalid-token"))).status, 401, "invalid token must be rejected");
assert.equal((await authorizeSuperadmin(request("member-token"))).status, 403, "authenticated non-admin must be rejected");

const authorized = await authorizeSuperadmin(request("admin-token"));
assert.equal(authorized.user.id, adminId, "active SIGO superadmin must be authorized");
configureWebPush();

console.log("ADMIN_NOTIFICATIONS_AUTH_OK: missing, invalid, regular-user, active-admin, and VAPID configuration cases passed");

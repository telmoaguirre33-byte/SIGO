self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data?.text() || "Tenés una notificación de SIGO." }; }
  const title = typeof payload.title === "string" ? payload.title : "SIGO Gestión";
  const options = {
    body: typeof payload.body === "string" ? payload.body : "Tenés una notificación nueva.",
    icon: "/sigo-icon-oficial-192.png",
    badge: "/sigo-icon-oficial-192.png",
    tag: typeof payload.tag === "string" ? payload.tag : "sigo-notification",
    renotify: false,
    data: payload.data && typeof payload.data === "object" ? payload.data : { url: "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        client.postMessage({ type: "SIGO_NOTIFICATION_OPEN", url: target });
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

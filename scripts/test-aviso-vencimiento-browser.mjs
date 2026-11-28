import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";

const componentesAislados = new Set([
  "./ClientesOperativos", "./ComprasOperativas", "./InformesOperativos",
  "./PortalCliente", "./UsuariosOperativos", "./AdminNotifications",
]);
const mocks = {
  "./SigoApp": 'export default function Operacion() { return <main className="app"><button onClick={() => window.operaciones++}>Operar</button></main>; }',
  "./adminPush": 'export async function cerrarSesionConPushRevocado() {} export async function notificarAltaEmpresaAdmin() {}',
  "./operationalReadiness": 'export async function validarReadinessSigoAdministracion() {}',
  "./supabase": `
    const estado = () => window.fixture;
    const empresa = () => ({ empresa_id: 'empresa-prueba', nombre: 'Empresa sintética', rol: 'owner', activa: estado().activa, created_at: '2026-10-01T00:00:00Z' });
    const actor = () => ({ id: 'usuario-prueba', created_at: '2026-10-01T00:00:00Z', user_metadata: { sigo_onboarding_mode: 'owner' } });
    const ok = data => ({data,error:null});
    export const supabase = {
      auth: {
        getUser: async () => ok({ user: actor() }),
        getSession: async () => ok({ session: estado().sesion ? { user: actor() } : null }),
        onAuthStateChange: () => ok({ subscription: { unsubscribe() {} } }),
        updateUser: async () => ok({ user: actor() }),
      },
      from(name) {
        if (name !== 'empresa_usuarios') throw new Error('Tabla no esperada');
        return {select() {return this},eq() {return this}, limit: async () => ok(estado().nueva ? [] : [empresa()])};
      },
      rpc(name, args) {
        switch (name) {
          case 'mis_empresas_sigo': return Promise.resolve(ok(estado().activa && !estado().nueva ? [empresa()] : []));
          case 'crear_empresa':
            window.altas++;
            estado().nueva = false;
            return Promise.resolve(ok(empresa().empresa_id));
          case 'es_superadmin_sigo': return Promise.resolve(ok(estado().superadmin));
          case 'sigo_aviso_vencimiento':
            if (args.p_empresa_id !== empresa().empresa_id) throw new Error('Empresa incorrecta');
            return {abortSignal: async () => estado().avisoFalla ? {data:null,error:{message:'offline'}} : ok(estado().vencida)};
          case 'matriz_resumen_sigo': return Promise.resolve(ok([{ empresas_total: 1 }]));
          case 'matriz_listar_empresas_sigo': return Promise.resolve(ok([empresa()]));
          case 'matriz_listar_mayorista_modulos_sigo': return Promise.resolve(ok([]));
          case 'matriz_actualizar_estado_empresa_sigo':
            if (!estado().superadmin || args.p_empresa_id !== empresa().empresa_id) throw new Error('Operación sin autorización');
            estado().activa = args.p_activa;
            window.cambios.push(args.p_activa);
            return Promise.resolve(ok(true));
          default: throw new Error('RPC no esperada: ' + name);
        }
      },
    };
  `,
};

const bundle = await build({
  stdin: { resolveDir: process.cwd(), sourcefile: "sigo-aviso-browser.tsx", loader: "tsx", contents: `
    import { createRoot } from "react-dom/client";
    import SigoAuthGate from "./src/SigoAuthGate";
    import SigoRoot from "./src/SigoRoot";
    createRoot(document.getElementById("root")).render(<SigoAuthGate><SigoRoot /></SigoAuthGate>);
  ` },
  bundle: true, write: false, format: "iife", jsx: "automatic",
  loader: { ".css": "empty" },
  define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "comercial-sintetico", setup(build) {
    build.onResolve({ filter: /^\.\// }, ({ path }) => mocks[path] || componentesAislados.has(path) ? { path, namespace: "mock" } : null);
    build.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({
      contents: mocks[path] ?? "export default function Aislado() { return null; }", loader: "tsx", resolveDir: process.cwd(),
    }));
  }}],
});

const css = await readFile("src/index.css", "utf8");
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  headless: true, args: ["--no-sandbox"],
});
const aviso = "Tu cuenta está vencida. Por favor, regularizá tu pago";
const escenario = { activa: true, vencida: true, sesion: true, nueva: false, superadmin: false, avisoFalla: false };

try {
  for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, hasTouch: viewport.width < 600, isMobile: viewport.width < 600 });
    const origin = "https://sigo-qa.invalid/";
    await page.route("**/*", route => route.request().url() === origin
      ? route.fulfill({contentType: "text/html", body: '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>'})
      : route.abort());
    page.on("dialog", dialog => dialog.accept());

    async function mostrar(cambios = {}) {
      await page.goto(origin);
      await page.addStyleTag({ content: css });
      await page.evaluate(fixture => Object.assign(window, { fixture, altas: 0, operaciones: 0, cambios: [] }), { ...escenario, ...cambios });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
    }

    const operar = page.getByRole("button", { name: "Operar", exact: true });
    await mostrar();
    const cartel = page.getByText(aviso, { exact: true });
    await cartel.waitFor();
    assert.equal(await cartel.evaluate(elemento => {
      const area = elemento.getBoundingClientRect();
      return elemento.contains(document.elementFromPoint(area.x + area.width / 2, area.y + area.height / 2));
    }), true);
    await operar.click();
    assert.equal(await page.evaluate(() => window.operaciones), 1);

    await mostrar({ vencida: false });
    await operar.click();
    assert.equal(await page.getByText(aviso).count(), 0);

    await mostrar({ nueva: true, vencida: false });
    await operar.click();
    assert.equal(await page.evaluate(() => window.altas), 1);

    await mostrar({ avisoFalla: true });
    await operar.click();
    assert.equal(await page.getByText(aviso).count(), 0);

    await mostrar({ activa: false });
    await page.getByRole("heading", { name: "Acceso a la empresa no disponible" }).waitFor();
    assert.equal(await operar.count(), 0);
    assert.equal(await page.evaluate(() => window.altas), 0);
    await page.evaluate(() => { window.fixture.activa = true; });
    await page.getByRole("button", { name: "Actualizar acceso" }).click();
    await page.getByText(aviso, { exact: true }).waitFor();
    await operar.click();

    await mostrar({ superadmin: true });
    await page.getByRole("button", { name: "Matriz", exact: true }).click();
    await page.getByRole("button", { name: "Suspender", exact: true }).click();
    await page.getByRole("button", { name: "Reactivar", exact: true }).click();
    await page.getByRole("button", { name: "Suspender", exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.cambios), [false, true]);

    await mostrar({ sesion: false });
    await page.getByLabel("Email").waitFor();
    assert.equal(await operar.count(), 0);

    console.log(`OK ${viewport.width}px: vencida, vigente, nueva, aviso sin conexión, suspendida, reactivada, Matriz y sin sesión`);
    await page.close();
  }
} finally {
  await browser.close();
}

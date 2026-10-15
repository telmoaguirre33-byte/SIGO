import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const empresaId = "00000000-0000-4000-8000-000000000001", ventaId = "00000000-0000-4000-8000-000000000099";
const field = page => page.getByRole("textbox", { name: "Código de barras, código interno o nombre del producto", exact: true });
const dialog = page => page.getByRole("dialog");

test.beforeEach(async ({ page, context }) => {
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort("blockedbyclient");
    if (url.pathname === "/api/arca/cae-v2") {
      const request = route.request().postDataJSON();
      expect(request.confirmacion).toBe("EMITIR_CAE_PRODUCCION");
      expect(request.ventaId).toBe(ventaId);
      const receipt = { id: "00000000-0000-4000-8000-000000000088", empresa_id: empresaId, venta_id: ventaId,
        resultado: "A", tipo_cbte: request.tipoCbte, punto_venta: request.puntoVenta, numero_cbte: 42, cae: "12345678901234", cae_vencimiento: "2026-10-25" };
      await page.evaluate(({ request, receipt }) => {
        window.minoristaTest.fiscalRequests.push(request);
        if (!window.minoristaTest.receipts.length) window.minoristaTest.receipts.push(window.minoristaTest.failCaeSave ? { ...receipt, cae: null, resultado: "reservado" } : receipt);
      }, { request, receipt });
      if (await page.evaluate(() => window.minoristaTest.failCaeSave)) return route.fulfill({ status: 502, json: { error: "ARCA_CAE_FAILED" } });
      return route.fulfill({ json: { ok: true, comprobante: receipt } });
    }
    if (url.pathname === "/api/arca/comprobante") {
      if (route.request().method() === "POST") {
        const blocked = await page.evaluate(() => {
          const state = window.minoristaTest;
          state.recoveryRequests = (state.recoveryRequests || 0) + 1;
          if (state.recoveryBlocked) return true;
          Object.assign(state.receipts[0], { cae: "12345678901234", cae_vencimiento: "2026-10-25", resultado: "A" });
          return false;
        });
        if (blocked) return route.fulfill({ status: 409, json: { error: "ARCA_FISCAL_RECONCILIATION_PENDING" } });
      }
      const data = await page.evaluate(() => ({ receipt: window.minoristaTest.receipts[0], total: window.minoristaTest.sales[0].total }));
      return route.fulfill({ json: { ok: true, comprobante: data.receipt, importes: { neto: data.total, iva: 0, exento: 0, noGravado: 0, tributos: 0 }, emisor: { cuit: "20123456789", nombre: "COMERCIO QA", ambiente: "produccion" },
        qr: { ver: 1, fecha: "2026-10-15", cuit: 20123456789, ptoVta: data.receipt.punto_venta, tipoCmp: data.receipt.tipo_cbte,
          nroCmp: 42, importe: data.total, moneda: "PES", ctz: 1, tipoDocRec: 99, nroDocRec: 0, tipoCodAut: "E", codAut: 12345678901234 } } });
    }
    return route.continue();
  });
  await page.goto("/tests/minorista/index.html?section=Ventas");
  await expect(field(page)).toBeFocused();
});

async function confirmSale(page, key = "F9") {
  await field(page).pressSequentially("7790413400018"); await field(page).press("Enter");
  await field(page).pressSequentially("7793198500065"); await field(page).press("Tab");
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page.keyboard.press(key);
  await expect.poll(() => page.evaluate(() => window.minoristaTest.confirmations.length)).toBe(1);
  await page.evaluate(() => window.minoristaTest.release());
  await expect(page.locator(".sigo-pos-cart tbody tr")).toHaveCount(0);
  await expect(page.getByText("Venta confirmada", { exact: true })).toBeVisible();
}
async function issue(page) {
  await page.keyboard.press("F11");
  await expect(dialog(page)).toHaveAccessibleName("Factura fiscal de la última venta");
  await expect(dialog(page)).toContainText("Total $ 200,00");
  const confirmation = page.waitForEvent("dialog");
  const click = dialog(page).getByRole("button", { name: "Autorizar factura de esta venta" }).click();
  const prompt = await confirmation; expect(prompt.message()).toContain("REAL"); await prompt.accept(); await click;
  await expect(dialog(page)).toContainText("12345678901234");
  await expect(dialog(page).getByRole("button", { name: "Descargar PDF" })).toBeEnabled();
}
async function downloadedPdf(page, button, label) {
  const download = page.waitForEvent("download"); await button.click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.pdf$/);
  fs.mkdirSync("test-results", { recursive: true });
  const dest = path.resolve(`test-results/browser-${label}.pdf`); await file.saveAs(dest);
  const pdf = fs.readFileSync(dest); expect(pdf.subarray(0, 8).toString()).toBe("%PDF-1.4");
  const text = spawnSync("pdftotext", ["-layout", dest, "-"], { encoding: "utf8" }); expect(text.status).toBe(0);
  for (const value of ["COMERCIO QA", "PINTURA TELA BLANCO", "COMPAS PIZZINI", "200,00"]) expect(text.stdout).toContain(value);
  return text.stdout;
}
async function noDuplicates(page, fiscalCount) {
  expect(await page.evaluate(() => window.minoristaTest.confirmations.length)).toBe(1);
  expect(await page.evaluate(() => window.minoristaTest.fiscalRequests.length)).toBe(fiscalCount);
  expect(await page.evaluate(() => window.minoristaTest.fiscalEvents.length)).toBe(0);
  await expect(page.getByRole("dialog", { name: "Facturación ARCA", exact: true })).toHaveCount(0);
  expect(page.url()).toContain("section=Ventas");
}

test("Venta → F9 → F11 → autorización fiscal → formatos e impresión dentro de Caja", async ({ page }) => {
  await confirmSale(page);
  await expect(page.locator('iframe[title="Comprobante para imprimir"]')).toHaveCount(0);
  await issue(page);
  for (const format of ["58", "80", "a4"]) {
    await dialog(page).getByLabel("Formato", { exact: true }).selectOption(format);
    await expect(dialog(page).getByRole("button", { name: "Imprimir comprobante" })).toBeEnabled();
    const text = await downloadedPdf(page, dialog(page).getByRole("button", { name: "Descargar PDF" }), `fiscal-${format}`);
    expect(text).toContain("Factura C"); expect(text).toContain("0001-00000042"); expect(text).toContain("2026-10-25"); expect(text).toContain("12345678901234");
  }
  await dialog(page).getByRole("button", { name: "Imprimir comprobante" }).click();
  await expect(page.locator('iframe[title="Comprobante para imprimir"]')).toHaveCount(1);
  await noDuplicates(page, 1);
});

test("Venta → F10 entrega ticket comercial; conserva referencia tras limpiar pantalla", async ({ page }) => {
  await confirmSale(page, "F10");
  await expect(page.locator('iframe[title="Comprobante para imprimir"]')).toHaveCount(1);
  await page.keyboard.press("F12");
  await expect(dialog(page)).toHaveAccessibleName("Reimprimir último comprobante");
  const text = await downloadedPdf(page, dialog(page).getByRole("button", { name: "Descargar PDF" }), "F10-commercial");
  expect(text).toContain("NO FISCAL"); await noDuplicates(page, 0);
});

test("Venta confirmada → WhatsApp descarga PDF correcto y facilita adjunto manual", async ({ page }) => {
  await confirmSale(page);
  await page.getByRole("button", { name: "WhatsApp", exact: true }).click();
  const text = await downloadedPdf(page, dialog(page).getByRole("button", { name: "Compartir PDF por WhatsApp" }), "whatsapp-commercial");
  expect(text).toContain("NO FISCAL");
  await expect(dialog(page)).toContainText("Adjuntar → Documento");
  await expect(dialog(page)).toContainText("confirmá el envío");
  await noDuplicates(page, 0);
});

test("WhatsApp compatible recibe un archivo PDF real con el total persistido, sin envío automático", async ({ page }) => {
  await confirmSale(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", { configurable: true, value: async data => {
      window.sharedReceipt = { text: data.text, name: data.files[0].name, type: data.files[0].type, bytes: [...new Uint8Array(await data.files[0].arrayBuffer())] };
    } });
  });
  await page.getByRole("button", { name: "WhatsApp", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Compartir PDF por WhatsApp" }).click();
  await expect(dialog(page)).toContainText("PDF preparado para compartir.");
  const shared = await page.evaluate(() => window.sharedReceipt);
  expect(shared.type).toBe("application/pdf"); expect(shared.text).toContain("200,00"); expect(shared.name).toMatch(/\.pdf$/);
  const filePath = path.resolve("test-results/browser-share-sheet.pdf"); fs.writeFileSync(filePath, Buffer.from(shared.bytes));
  const parsed = spawnSync("pdftotext", [filePath, "-"], { encoding: "utf8" }); expect(parsed.status).toBe(0); expect(parsed.stdout).toContain("200,00");
  await noDuplicates(page, 0);
});

test("Factura emitida → F12 reimprime original sin emitir ni abrir ARCA", async ({ page }) => {
  await confirmSale(page); await issue(page); await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0); await expect(field(page)).toBeFocused();
  await page.keyboard.press("F12"); await expect(dialog(page)).toContainText("12345678901234");
  await dialog(page).getByLabel("Formato", { exact: true }).selectOption("a4");
  const text = await downloadedPdf(page, dialog(page).getByRole("button", { name: "Descargar PDF" }), "reprint-fiscal");
  expect(text).toContain("0001-00000042"); await noDuplicates(page, 1);
});

test("Factura emitida → WhatsApp prepara PDF fiscal con importe y CAE correctos", async ({ page }) => {
  await confirmSale(page); await issue(page); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "WhatsApp", exact: true }).click();
  const text = await downloadedPdf(page, dialog(page).getByRole("button", { name: "Compartir PDF por WhatsApp" }), "whatsapp-fiscal");
  expect(text).toContain("12345678901234"); expect(text).toContain("2026-10-25"); await noDuplicates(page, 1);
});

test("Venta ya facturada → F11 recupera original: no otra autorización ni otra venta", async ({ page }) => {
  await confirmSale(page); await issue(page); await page.keyboard.press("Escape");
  await page.keyboard.press("F11"); await expect(dialog(page)).toContainText("12345678901234");
  await expect(dialog(page).getByRole("button", { name: "Autorizar factura de esta venta" })).toHaveCount(0);
  await noDuplicates(page, 1);
});

test("Circuito completo con teclado; cancelar confirmación fiscal no emite", async ({ page }) => {
  await confirmSale(page); await page.keyboard.press("F11");
  await expect(dialog(page).getByRole("button", { name: "Autorizar factura de esta venta" })).toBeEnabled();
  await page.keyboard.press("Tab");
  for (let i = 0; i < 8 && !(await dialog(page).getByRole("button", { name: "Autorizar factura de esta venta" }).evaluate(el => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  const prompt = page.waitForEvent("dialog"); const enter = page.keyboard.press("Enter"); await (await prompt).dismiss(); await enter;
  await noDuplicates(page, 0);
  const confirmed = page.waitForEvent("dialog"); const secondEnter = page.keyboard.press("Enter"); await (await confirmed).accept(); await secondEnter;
  await expect(dialog(page)).toContainText("12345678901234");
  await page.keyboard.press("Escape"); await page.keyboard.press("F12"); await expect(dialog(page)).toContainText("12345678901234");
  await noDuplicates(page, 1);
});

test("Importe incoherente o detalle vacío bloquea PDF; no usa el carrito actual", async ({ page }) => {
  await confirmSale(page);
  await page.evaluate(() => { window.minoristaTest.sales[0].total = 999; });
  await page.getByRole("button", { name: "WhatsApp", exact: true }).click();
  await expect(dialog(page).getByRole("alert")).toContainText("total persistido no coincide");
  await expect(dialog(page).getByRole("button", { name: "Descargar PDF" })).toHaveCount(0);
  await noDuplicates(page, 0);
});

test("Recupera comprobante desde ventas confirmadas sin requerir una venta nueva", async ({ page }) => {
  await confirmSale(page);
  await page.getByRole("button", { name: /Venta Nº 123/ }).click();
  await expect(dialog(page)).toContainText("Total $ 200,00");
  await noDuplicates(page, 0);
});

test("Autorización exitosa y CAE sin guardar: F11/F12/WhatsApp bloquean sustitutos y recuperan el original", async ({ page }) => {
  await confirmSale(page);
  await page.evaluate(() => { window.minoristaTest.failCaeSave = true; window.minoristaTest.recoveryBlocked = true; });
  await page.keyboard.press("F11");
  const confirmation = page.waitForEvent("dialog");
  const click = dialog(page).getByRole("button", { name: "Autorizar factura de esta venta" }).click();
  await (await confirmation).accept(); await click;
  async function blocked() {
    await expect(dialog(page).getByRole("alert")).toContainText("Estado fiscal pendiente de conciliación");
    for (const name of ["Descargar PDF", "Compartir PDF por WhatsApp", "Imprimir comprobante", "Autorizar factura de esta venta"])
      await expect(dialog(page).getByRole("button", { name, exact: true })).toHaveCount(0);
    await expect(dialog(page)).not.toContainText("Ticket comercial");
    await noDuplicates(page, 1);
  }
  await blocked();
  await dialog(page).getByRole("button", { name: "Recuperar comprobante original" }).click();
  await blocked();
  await page.keyboard.press("Escape"); await page.keyboard.press("F12"); await blocked();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "WhatsApp", exact: true }).click(); await blocked();
  await page.keyboard.press("Escape"); await page.keyboard.press("F11"); await blocked();
  await page.evaluate(() => { window.minoristaTest.recoveryBlocked = false; });
  await dialog(page).getByRole("button", { name: "Recuperar comprobante original" }).click();
  await expect(dialog(page)).toContainText("12345678901234");
  await expect(dialog(page).getByRole("alert")).toHaveCount(0);
  await page.keyboard.press("Escape"); await page.keyboard.press("F12");
  const fiscal = await downloadedPdf(page, dialog(page).getByRole("button", { name: "Descargar PDF" }), "reconciled-original");
  expect(fiscal).toContain("0001-00000042"); expect(fiscal).toContain("12345678901234"); expect(fiscal).not.toContain("NO FISCAL");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "WhatsApp", exact: true }).click();
  const shared = await downloadedPdf(page, dialog(page).getByRole("button", { name: "Compartir PDF por WhatsApp" }), "reconciled-whatsapp");
  expect(shared).toContain("12345678901234");
  await page.keyboard.press("Escape"); await page.keyboard.press("F11");
  await expect(dialog(page)).toContainText("12345678901234"); await noDuplicates(page, 1);
  expect(await page.evaluate(() => window.minoristaTest.receipts.length)).toBe(1);
  expect(await page.evaluate(() => window.minoristaTest.recoveryRequests)).toBe(2);
});

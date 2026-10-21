import { test, expect } from "@playwright/test";

const products = [
  { ean: "7790413400018", name: "PINTURA TELA BLANCO" },
  { ean: "7793198500065", name: "COMPAS PIZZINI" },
];
const input = (page) => page.getByRole("textbox", { name: "Código de barras, código interno o nombre del producto", exact: true });

test.beforeEach(async ({ page }) => {
  // Impide por construcción cualquier petición a Supabase, producción o servicios externos.
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    return u.hostname === "127.0.0.1" ? route.continue() : route.abort("blockedbyclient");
  });
});

async function open(page, section) {
  await page.goto(`/tests/minorista/index.html?section=${section}`);
  await expect(input(page)).toBeFocused();
  await expect(page.getByText("Cargando", { exact: false })).toHaveCount(0);
}

async function scan(page, ean, suffix = "Enter", pause = false) {
  const field = input(page);
  await field.focus();
  if (pause) {
    await field.pressSequentially(ean.slice(0, 7), { delay: 5 });
    await page.waitForTimeout(110);
    await field.pressSequentially(ean.slice(7), { delay: 5 });
  } else await field.pressSequentially(ean, { delay: 5 });
  await field.press(suffix);
  await expect(field).toHaveValue("");
  await expect(field).toBeFocused();
}

for (const section of ["Productos", "Stock", "Ventas"]) {
  for (const product of products) {
    test(`${section}: ${product.ean}, pausa, Enter/Tab y búsqueda manual`, async ({ page }) => {
      await open(page, section);
      await scan(page, product.ean, "Enter", true);
      const table = page.locator("tbody");
      await expect(table).toContainText(product.name);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await scan(page, product.ean, "Tab", true);
      await expect(table).toContainText(product.name);
      await input(page).fill(product.ean);
      await page.getByRole("button", { name: "Buscar", exact: true }).click();
      await expect(input(page)).toHaveValue("");
      await expect(input(page)).toBeFocused();
      await expect(table).toContainText(product.name);
      if (section === "Ventas") await expect(table.locator("tr").first().locator("td").nth(2)).toContainText("3");
      else {
        const codes = await page.evaluate(() => window.minoristaTest.calls.filter((c) => c.name === "buscar_producto_codigo_sigo").map((c) => c.p_codigo));
        expect(codes).toEqual([product.ean, product.ean, product.ean]);
      }
      await input(page).fill(product.name);
      if (section === "Ventas") await input(page).press("Enter");
      else await page.getByRole("button", { name: "Buscar", exact: true }).click();
      await expect(table).toContainText(product.name);
      expect(await page.evaluate(() => window.minoristaTest.confirmations.length)).toBe(0);
    });
  }

  test(`${section}: lecturas alternadas y repetidas sin concatenación`, async ({ page }) => {
    await open(page, section);
    for (const p of [products[0], products[1], products[1], products[0]]) await scan(page, p.ean, "Tab");
    await expect(page.locator("tbody")).toContainText(products[0].name);
    await expect(page.getByRole("alert")).toHaveCount(0);
    if (section === "Ventas") {
      for (const p of products) await expect(page.locator("tbody tr").filter({ hasText: p.name }).locator("td").nth(2)).toContainText("2");
    }
  });

  test(`${section}: preserva ceros e invisibles y acepta código interno`, async ({ page }) => {
    await open(page, section);
    await input(page).fill(" \u200b000012340009\ufeff ");
    await input(page).press("Tab");
    await expect(page.locator("tbody")).toContainText("CÓDIGO CON CEROS");
    await input(page).fill("QA-A001");
    await input(page).press("Enter");
    await expect(page.locator("tbody")).toContainText("CÓDIGO CON CEROS");
    await expect(input(page)).toHaveValue("");
  });

  test(`${section}: código alternativo por pistola y botón Buscar usa el mismo servicio`, async ({ page }) => {
    await open(page, section);
    await scan(page, "9912345678901", "Tab");
    await expect(page.locator("tbody")).toContainText(products[0].name);
    await input(page).fill("9912345678901");
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    await expect(input(page)).toHaveValue("");
    await expect(page.locator("tbody")).toContainText(products[0].name);
    const codes = await page.evaluate(() => window.minoristaTest.calls.filter((c) => c.name === "buscar_producto_codigo_sigo").map((c) => c.p_codigo));
    expect(codes).toEqual(["9912345678901", "9912345678901"]);
  });
}

test("Stock: respuesta tardía preserva prefijo y resultado, cola en orden", async ({ page }) => {
  await open(page, "Stock");
  await page.evaluate(() => { window.minoristaTest.delay = true; });
  await scan(page, products[0].ean);
  await input(page).pressSequentially(products[1].ean.slice(0, 8));
  await page.evaluate(() => window.minoristaTest.release());
  await expect(page.locator("tbody")).toContainText(products[0].name);
  await expect(input(page)).toHaveValue(products[1].ean.slice(0, 8));
  await input(page).pressSequentially(products[1].ean.slice(8));
  await input(page).press("Tab");
  await scan(page, products[1].ean);
  await page.evaluate(() => window.minoristaTest.release());
  await expect(page.locator("tbody")).toContainText(products[1].name);
  await expect.poll(() => page.evaluate(() => window.minoristaTest.calls.filter((c) => c.name === "buscar_producto_codigo_sigo").length)).toBe(3);
  await page.evaluate(() => window.minoristaTest.release());
  await expect(input(page)).toHaveValue(""); await expect(input(page)).toBeFocused();
});

test("Caja: F2, selección manual con flechas y Escape, F9 único y F11 sobre venta confirmada", async ({ page }) => {
  await open(page, "Ventas");
  await page.getByRole("button", { name: /NUEVA VENTA/ }).click();
  await page.keyboard.press("F2"); await expect(input(page)).toBeFocused();
  await page.keyboard.press("F11");
  await expect(page.getByText("Primero confirmá la venta para emitir la factura fiscal.")).toBeVisible();
  expect(await page.evaluate(() => window.minoristaTest.fiscalEvents.length)).toBe(0);
  await input(page).fill("QA");
  await input(page).press("ArrowDown");
  await expect(page.locator("[data-pos-suggestion][aria-selected=true]")).toContainText(products[1].name);
  await input(page).press("Escape");
  await input(page).fill(products[0].name); await input(page).press("Enter");
  await expect(page.locator("tbody")).toContainText(products[0].name);
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) window.dispatchEvent(new KeyboardEvent("keydown", { key: "F9", bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => window.minoristaTest.confirmations.length)).toBe(1);
  await page.evaluate(() => window.minoristaTest.release());
  await expect(page.getByText("Venta confirmada", { exact: true })).toBeVisible();
  await page.keyboard.press("F11");
  await expect(page.getByRole("dialog", { name: "Factura fiscal de la última venta" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Autorizar factura de esta venta" })).toBeVisible();
  expect(await page.evaluate(() => window.minoristaTest.fiscalEvents)).toEqual([]);
  await expect(page.getByRole("dialog", { name: "Facturación ARCA", exact: true })).toHaveCount(0);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/redondeoPrecios.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { calcularPrecioConMargen: calcular, redondearPrecioVenta: redondear } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
let checks = 0;
for (const [price, step, expected] of [[165,100,200],[1551.39,100,1600],[1555.71,100,1600],[2294.15,100,2300],[2000,100,2000],[1000,100,1000],[201,1,201],[201.01,1,202],[150,50,150],[150.01,50,200],[1000.01,500,1500],[0,100,null],[-1,100,null],[NaN,100,null],[Infinity,100,null],[165,0,165],[165,3,null],[165,-1,null]]) { assert.equal(redondear(price,step),expected); checks++; }
for (const [cost,margin,step,expected] of [[100,10,10,110],[100,30,100,200],[1193.38,30,100,1600],[1200,30,0,1560],[2000,30,100,2600],[1000,100,0,2000],[0,30,100,null],[100,-1,100,null],[100,NaN,100,null],[100,10001,100,null],[1.005,0,0,1.01],[0.1,10,0,0.11],[0.01,0,1,1]]) { assert.equal(calcular(cost,margin,step),expected); checks++; }
for (const step of [1,10,50,100,500]) {
  for (let cents=1; cents<500000; cents+=157) {
    const rounded=redondear(cents/100,step);
    assert.equal(rounded,Math.ceil(cents/(step*100))*step);
    assert.equal(redondear(rounded,step),rounded);
    checks += 2;
  }
}
const ui = fs.readFileSync(new URL('../src/ListaPreciosManager.tsx', import.meta.url), 'utf8');
assert.ok(ui.includes('Lista de precios de venta en modo consulta'));
assert.ok(ui.includes('if (!puedeEditar)'));
assert.ok(ui.includes('p_precios_esperados: objetivos.map'));
assert.ok(ui.includes('window.confirm(texto)'));
const sql = fs.readFileSync(new URL('../supabase/migrations/20260925212000_redondeo_precio_venta.sql', import.meta.url), 'utf8');
for (const guard of ['auth.uid()', "'products.write'", 'for update of p', 'PRICE_CHANGED_REFRESH', 'PRODUCT_SCOPE_CHANGED', 'p.empresa_id = p_empresa_id']) assert.ok(sql.includes(guard));
assert.ok(!sql.includes('set costo_actual'));
assert.ok(!sql.includes('set stock_actual'));
console.log(`PRICE_ROUNDING_OK: ${checks} numerical checks plus UI/tenant/concurrency guards`);

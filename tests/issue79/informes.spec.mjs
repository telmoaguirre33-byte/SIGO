import { test, expect } from '@playwright/test';
test('F12 Actualizar reloads every selected report range',async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort('blockedbyclient'));
 await page.goto('/tests/issue79/index.html?reports=1');
 await expect(page.getByRole('button',{name:'Actualizar',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>window.issue79.calls.filter(c=>c.op==='gte'&&c.table==='compras_sigo'&&c.version===1).length)).toBeGreaterThanOrEqual(2);
 await page.evaluate(()=>{window.issue79.version=2;});
 await page.getByRole('button',{name:'Actualizar',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.issue79.calls.filter(c=>c.op==='gte'&&c.table==='compras_sigo'&&c.version===2).length)).toBeGreaterThanOrEqual(2);
 await expect.poll(()=>page.evaluate(()=>window.issue79.calls.filter(c=>c.op==='gte'&&c.table==='ventas_sigo'&&c.version===2).length)).toBeGreaterThanOrEqual(4);
 await expect(page.getByRole('alert')).toHaveCount(0);
});

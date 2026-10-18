import { test, expect } from '@playwright/test';
test.beforeEach(async({page})=>{await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort('blockedbyclient'));});
test('F10 40 matches: accents, keyboard through last option, screen-reader relationship',async({page})=>{
 await page.goto('/tests/issue79/index.html?count=40');
 const input=page.getByRole('combobox',{name:'Código de barras, código interno o nombre del producto',exact:true});
 await input.fill('lapiz');await expect(page.getByRole('option')).toHaveCount(40);
 await expect(input).toHaveAttribute('aria-controls','sigo-pos-resultados');
 for(let i=0;i<39;i++)await input.press('ArrowDown');
 const last=page.getByRole('option').last();await expect(last).toHaveAttribute('aria-selected','true');
 await expect(input).toHaveAttribute('aria-activedescendant',await last.getAttribute('id'));
 await input.press('Enter');await expect(page.locator('tbody')).toContainText('Lápiz Útil 40');
});
test('F10 5,000 products: bounded DOM, End/Home and choose last without mouse',async({page})=>{
 await page.goto('/tests/issue79/index.html?count=5000');
 const input=page.getByRole('combobox',{name:'Código de barras, código interno o nombre del producto',exact:true});
 await input.fill('lapiz util');await expect(page.getByRole('status')).toContainText('5000 coincidencias');
 expect(await page.getByRole('option').count()).toBeLessThanOrEqual(40);
 await input.press('End');await expect(page.locator('[role=option][aria-selected=true]')).toContainText('Lápiz Útil 5000');
 await input.press('Home');await expect(page.locator('[role=option][aria-selected=true]')).toContainText('Lápiz Útil 1');
 await input.press('End');await input.press('Enter');await expect(page.locator('tbody')).toContainText('Lápiz Útil 5000');
});

import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({testDir:'.',testMatch:'*.spec.mjs',use:{baseURL:'http://127.0.0.1:4179',headless:true},reporter:[['list'],['json',{outputFile:'test-results/issue79-operacion.json'}]],webServer:{cwd:fileURLToPath(new URL('../..',import.meta.url)),command:'npx vite --config tests/issue79/vite.config.ts',url:'http://127.0.0.1:4179/tests/issue79/index.html',reuseExistingServer:false}});

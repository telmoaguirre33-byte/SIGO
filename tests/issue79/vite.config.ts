import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig({plugins:[{name:'issue79-isolated-data',enforce:'pre',resolveId(source){if(source==='./supabase')return path.resolve('tests/issue79/fixture.ts');}},react()],server:{host:'127.0.0.1',port:4179,strictPort:true}});

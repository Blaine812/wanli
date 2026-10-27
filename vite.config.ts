import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
// @ts-expect-error Local-only middleware is plain Node JavaScript.
import {reviewApi} from './local/server.mjs';
export default defineConfig({base:process.env.VITE_BASE_PATH||'/',plugins:[react(),reviewApi()],server:{host:'127.0.0.1',watch:{ignored:['**/outputs/**','**/public/deities/**']}},build:{sourcemap:false,rollupOptions:{input:{main:fileURLToPath(new URL('./index.html',import.meta.url)),admin:fileURLToPath(new URL('./admin.html',import.meta.url))}}}});

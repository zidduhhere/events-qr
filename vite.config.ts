import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { readFileSync } from 'node:fs'
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const port = process.env.PORT ?? env.PORT ?? '3001'
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('PORT must be an integer between 1 and 65535.')
  const proxy = { '/api': `http://127.0.0.1:${port}` }
  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0', port: 5173, strictPort: true,
      https: process.env.LOCAL_HTTPS === '1' ? { key: readFileSync('.certs/lan-key.pem'), cert: readFileSync('.certs/lan-cert.pem') } : undefined,
      fs: { deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.certs/**', '**/.git/**'] },
      proxy,
    },
    preview: { proxy },
  }
})

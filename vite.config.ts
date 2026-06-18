import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const agentApiProxyTarget = env.VITE_AGENT_API_PROXY_TARGET || 'http://127.0.0.1:8900'

  return {
    plugins: [react()],
    build: {
      // Отключаем source maps в production для защиты от реверс-инжиниринга
      sourcemap: false,
      // Минификация включена по умолчанию (esbuild)
    },
    server: {
      proxy: {
        // Bookmarks / agent-api: при пустом VITE_AGENT_API_BASE фронт бьёт в /api/v1/* (этот прокси в dev)
        '/api/v1': {
          target: agentApiProxyTarget,
          changeOrigin: true,
        },
        // Deep Search worker (local testing without Docker)
        '/api/deep-search': {
          target: 'http://localhost:8001',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/deep-search/, '')
        },
        // Blog Next.js API (local testing)
        '/api/blog': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/blog/, '/api')
        },
        // Supabase proxy (point to cloud or self-hosted)
        '/supabase': {
          target: 'https://swoop.autoro.tech',
          changeOrigin: true,
        }
      }
    }
  }
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [
        react(),
        // SPA fallback: serve admin.html for all non-asset requests
        {
            name: 'spa-fallback',
            configureServer(server) {
                server.middlewares.use((req, _res, next) => {
                    const url = req.url || '/'
                    // Rewrite to admin.html for any route that isn't a file/asset
                    if (
                        !url.includes('.') &&   // not a file (no extension)
                        !url.startsWith('/@') &&   // not vite internal
                        !url.startsWith('/api')      // not API proxy
                    ) {
                        req.url = '/admin.html'
                    }
                    next()
                })
            }
        }
    ],
    build: {
        sourcemap: false,
        rollupOptions: {
            input: './admin.html',
        },
    },
    server: {
        port: 5174,
        proxy: {
            '/api/deep-search': {
                target: 'http://localhost:8001',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/deep-search/, '')
            },
            '/supabase': {
                target: 'https://swoop.autoro.tech',
                changeOrigin: true,
            }
        }
    }
})

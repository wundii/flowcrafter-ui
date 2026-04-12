import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
    plugins: [tailwindcss()],
    server: {
        port: 5173,
        proxy: {
            '/api/fc': 'http://localhost:3000',
            '/api/fc-ping': 'http://localhost:3000',
            '/api/auth': 'http://localhost:3000',
            '/api/connection': 'http://localhost:3000',
            '/api/ai-config': 'http://localhost:3000',
            '/api/version': 'http://localhost:3000',
            '/api/dev-import': 'http://localhost:3000',
            '/api/analyze': {
                target: 'http://localhost:3000',
                configure: proxy => {
                    proxy.on('proxyRes', (proxyRes, _req, res) => {
                        // Disable buffering so NDJSON streams through immediately
                        res.writeHead(proxyRes.statusCode, proxyRes.headers)
                        proxyRes.pipe(res)
                    })
                },
                selfHandleResponse: true,
            },
        },
    },
})

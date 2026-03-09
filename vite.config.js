import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
    plugins: [tailwindcss()],
    server: {
        port: 5173,
        proxy: {
            '/api/auth': 'http://localhost:3000',
            '/api/connection': 'http://localhost:3000',
        },
    },
})

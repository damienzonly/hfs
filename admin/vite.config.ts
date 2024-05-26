import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
    build: {
        outDir: '../dist/admin',
        emptyOutDir: true,
        target: "es2015",
        rollupOptions: {
            plugins: [
            ],
            onwarn(warning, warn) {
                if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes(`"use client"`)) return
                warn(warning)
            },
        }
    },
    server: {
        port: 3006,
        host: '127.0.0.1',
        proxy: {
            '/~/': {
                target: 'http://localhost',
                proxyTimeout: 2000,
                changeOrigin: true,
                ws: true,
            }
        }
    }
})

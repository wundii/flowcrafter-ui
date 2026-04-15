import js from '@eslint/js'
import prettierConfig from 'eslint-config-prettier'

export default [
    js.configs.recommended,
    prettierConfig,
    {
        files: ['src/**/*.js', 'server.js'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            globals: {
                window: 'readonly',
                document: 'readonly',
                console: 'readonly',
                fetch: 'readonly',
                sessionStorage: 'readonly',
                localStorage: 'readonly',
                crypto: 'readonly',
                customElements: 'readonly',
                HTMLElement: 'readonly',
                requestAnimationFrame: 'readonly',
                URL: 'readonly',
                CustomEvent: 'readonly',
                Event: 'readonly',
                URLSearchParams: 'readonly',
                TextDecoder: 'readonly',
                Blob: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                navigator: 'readonly',
                getComputedStyle: 'readonly',
                IntersectionObserver: 'readonly',
                // Node globals (server.js)
                process: 'readonly',
                Buffer: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            'no-console': 'off',
            'prefer-const': 'error',
            'no-var': 'error',
            eqeqeq: ['error', 'always'],
            'no-duplicate-imports': 'error',
        },
    },
    {
        ignores: ['dist/**', 'node_modules/**'],
    },
]

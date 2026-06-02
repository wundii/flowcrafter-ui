const TOKEN_KEY = 'fc_token'

let _config = null // { configured, url, secret } — nur im Memory, nie persistiert

function token() {
    return localStorage.getItem(TOKEN_KEY) ?? ''
}

async function apiFetch(path, options = {}) {
    return fetch(path, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
            ...options.headers,
        },
    })
}

export const connection = {
    async load() {
        const res = await apiFetch('/api/connection')
        _config = await res.json()
        return _config
    },

    isConfigured() {
        return _config?.configured === true
    },

    getUrl() {
        return _config?.url ?? ''
    },

    getSecret() {
        return _config?.secret ?? ''
    },

    async save(url, secret) {
        const res = await apiFetch('/api/connection', {
            method: 'POST',
            body: JSON.stringify({ url: url.replace(/\/$/, ''), secret: secret || null }),
        })
        if (res.ok) {
            _config = { configured: true, url: url.replace(/\/$/, ''), secret: secret ?? '' }
        }
        return res.ok
    },

    async clear() {
        const res = await apiFetch('/api/connection', { method: 'DELETE' })
        if (res.ok) _config = { configured: false, url: '', secret: '' }
        return res.ok
    },

    async ping(url, secret) {
        try {
            const res = await apiFetch('/api/fc-ping', {
                method: 'POST',
                body: JSON.stringify({ url: url.replace(/\/$/, ''), secret: secret || null }),
            })
            return await res.json()
        } catch {
            return { error: 'unreachable' }
        }
    },
}

function uiToken() {
    return sessionStorage.getItem('fc_token') ?? ''
}

function fetchJson(path) {
    const headers = uiToken() ? { Authorization: `Bearer ${uiToken()}` } : {}
    return fetch(`/api/fc${path}`, { headers }).then(async res => {
        if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        return res.json()
    })
}

function postJson(path, body) {
    const headers = {
        'Content-Type': 'application/json',
        ...(uiToken() ? { Authorization: `Bearer ${uiToken()}` } : {}),
    }
    return fetch(`/api/fc${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    }).then(async res => {
        if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            throw new Error(data.error ?? `HTTP ${res.status}`)
        }
        return res.json()
    })
}

export const api = {
    /** @param {{ sort?: 'asc'|'desc', top?: number, skip?: number, type?: string, from?: string, to?: string }} [opts] */
    getFlows({ sort = 'desc', top = 1000, skip = 0, type, from, to } = {}) {
        const p = new URLSearchParams({ sort, top, skip })
        if (type) p.set('type', type)
        if (from) p.set('from', from)
        if (to) p.set('to', to)
        return fetchJson(`/api/flows?${p}`)
    },

    /** @param {string} hash */
    getFlow(hash) {
        return fetchJson(`/api/flows/detail?hash=${encodeURIComponent(hash)}`)
    },

    /** @param {string} runtimeHash */
    getFlowByRuntimeHash(runtimeHash) {
        return fetchJson(`/api/flows/detail?runtimeHash=${encodeURIComponent(runtimeHash)}`)
    },

    /** @param {{ subject: string, top?: number }} opts */
    searchFlows({ subject, top = 10 }) {
        const p = new URLSearchParams({ subject, top })
        return fetchJson(`/api/flows/search?${p}`)
    },

    /** @param {{ sort?: 'asc'|'desc', top?: number, skip?: number, flowHash?: string, from?: string, to?: string }} [opts] */
    getExceptions({ sort = 'desc', top = 1000, skip = 0, flowHash, from, to } = {}) {
        const p = new URLSearchParams({ sort, top, skip })
        if (flowHash) p.set('flowHash', flowHash)
        if (from) p.set('from', from)
        if (to) p.set('to', to)
        return fetchJson(`/api/exceptions?${p}`)
    },

    /**
     * @param {string} flowHash
     * @param {string} messageSource  fully-qualified class name
     * @param {object} message        plain object (will be sent as JSON)
     * @param {string[]} [includeStubs]  stub sources to include (empty = all)
     */
    runFlow(flowHash, messageSource, message, includeStubs = []) {
        return postJson('/api/flows/run', { flowHash, messageSource, message, includeStubs })
    },

    /** @param {{ sort?: 'asc'|'desc' }} [opts] */
    getQueues({ sort = 'desc' } = {}) {
        const p = new URLSearchParams({ sort })
        return fetchJson(`/api/queues?${p}`)
    },

    queueFlow(flowHash, messageSource, message, includeStubs = []) {
        return postJson('/api/queue', { flowHash, messageSource, message, includeStubs })
    },

    getQueueCount() {
        return fetchJson('/api/queue/count')
    },

    getInfo() {
        return fetchJson('/api/info')
    },

    /** @param {string} className */
    getStubSource(className) {
        const p = new URLSearchParams({ className })
        return fetchJson(`/api/schema/stub-source?${p}`)
    },

    /** @param {string} stubSource */
    getStubSources(stubSource) {
        console.log(stubSource)
        const p = new URLSearchParams({ stubSource })
        return fetchJson(`/api/schema/stub-sources?${p}`)
    },

    /** @param {string} stubHash */
    getStubSourceByHash(stubHash) {
        const p = new URLSearchParams({ stubHash })
        return fetchJson(`/api/schema/stub-source?${p}`)
    },

    /** @param {{ from?: string, to?: string, type?: string }} [opts] */
    getFlowStats({ from, to, type } = {}) {
        const p = new URLSearchParams()
        if (from) p.set('from', from)
        if (to) p.set('to', to)
        if (type) p.set('type', type)
        return fetchJson(`/api/flows/stats?${p}`)
    },

    /** @returns {Promise<Array>} mock schema data */
    getSchemas() {
        return fetchJson('/api/schemas')
    },

    /**
     * @param {string} flowHash
     * @param {string} [runtimeHash]
     * @param {(event: object) => void} [onProgress]
     */
    async analyzeFlow(flowHash, runtimeHash = null, onProgress = () => {}) {
        const token = sessionStorage.getItem('fc_token') ?? ''
        const res = await fetch('/api/analyze', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ flowHash, runtimeHash }),
        })

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let result = null

        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop()
            for (const line of lines) {
                if (!line.trim()) continue
                const event = JSON.parse(line)
                if (event.type === 'result') {
                    result = event
                } else if (event.type === 'error') {
                    const err = new Error(event.error)
                    err.detail = event.detail ?? null
                    throw err
                } else {
                    onProgress(event)
                }
            }
        }

        // Process remaining buffer
        if (buffer.trim()) {
            const event = JSON.parse(buffer)
            if (event.type === 'result') result = event
            else if (event.type === 'error') {
                const err = new Error(event.error)
                err.detail = event.detail ?? null
                throw err
            }
        }

        if (!result) throw new Error('Keine Antwort erhalten.')
        return result
    },

    getAiConfig() {
        const token = sessionStorage.getItem('fc_token') ?? ''
        return fetch('/api/ai-config', {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        }).then(res => res.json())
    },

    /** @param {string} apiKey @param {string} model */
    saveAiConfig(apiKey, model) {
        const token = sessionStorage.getItem('fc_token') ?? ''
        return fetch('/api/ai-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ apiKey, model }),
        }).then(res => res.json())
    },

    clearAiConfig() {
        const token = sessionStorage.getItem('fc_token') ?? ''
        return fetch('/api/ai-config', {
            method: 'DELETE',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        }).then(res => res.json())
    },
}

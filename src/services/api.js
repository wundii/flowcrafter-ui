function uiToken() {
    return localStorage.getItem('fc_token') ?? ''
}

function fetchJson(path) {
    const headers = uiToken() ? { Authorization: `Bearer ${uiToken()}` } : {}
    return fetch(`/api/fc${path}`, { headers }).then(async res => {
        if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            const err = new Error(body.error ?? `HTTP ${res.status}`)
            err.status = res.status
            err.file = body.file ?? null
            err.line = body.line ?? null
            err.trace = body.trace ?? null
            err.fileContext = body.fileContext ?? null
            throw err
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
            const err = new Error(data.error ?? `HTTP ${res.status}`)
            err.status = res.status
            err.file = data.file ?? null
            err.line = data.line ?? null
            err.trace = data.trace ?? null
            err.fileContext = data.fileContext ?? null
            throw err
        }
        return res.json()
    })
}

export const api = {
    /** @param {{ sort?: 'asc'|'desc', top?: number, skip?: number, type?: string, from?: string, to?: string, status?: string }} [opts] */
    getFlows({ sort = 'desc', top = 1000, skip = 0, type, from, to, status } = {}) {
        const p = new URLSearchParams({ sort, top, skip })
        if (type) p.set('type', type)
        if (from) p.set('from', from)
        if (to) p.set('to', to)
        if (status) p.set('status', status)
        return fetchJson(`/api/flow/flow-list?${p}`)
    },

    /** @param {string} hash */
    getFlow(hash) {
        return fetchJson(`/api/flow/flow-details?hash=${encodeURIComponent(hash)}`)
    },

    /** @param {string} runtimeHash */
    getFlowByRuntimeHash(runtimeHash) {
        return fetchJson(`/api/flow/flow-details?runtimeHash=${encodeURIComponent(runtimeHash)}`)
    },

    /** @param {{ subject: string, top?: number }} opts */
    searchFlows({ subject, top = 10 }) {
        const p = new URLSearchParams({ subject, top })
        return fetchJson(`/api/flow/flow-search?${p}`)
    },

    /** @param {{ from?: string, to?: string }} [opts] */
    getExceptionStats({ from, to } = {}) {
        const p = new URLSearchParams()
        if (from) p.set('from', from)
        if (to) p.set('to', to)
        return fetchJson(`/api/flow/exceptions-stats?${p}`)
    },

    /** @param {{ sort?: 'asc'|'desc', top?: number, skip?: number, from?: string, to?: string, status?: string }} [opts] */
    getExceptions({ sort = 'desc', top = 1000, skip = 0, from, to, status } = {}) {
        const p = new URLSearchParams({ sort, top, skip })
        if (from) p.set('from', from)
        if (to) p.set('to', to)
        if (status) p.set('status', status)
        return fetchJson(`/api/flow/exception-list?${p}`)
    },

    /**
     * @param {string} flowHash
     * @param {string} messageSource  fully-qualified class name
     * @param {object} message        plain object (will be sent as JSON)
     * @param {string[]} [includeSteps]  step sources to include (empty = all)
     */
    runFlow(flowHash, messageSource, message, includeSteps = []) {
        return postJson('/api/flow/flow-run', { flowHash, messageSource, message, includeSteps })
    },

    /** @param {{ sort?: 'asc'|'desc' }} [opts] */
    getQueues({ sort = 'desc' } = {}) {
        const p = new URLSearchParams({ sort })
        return fetchJson(`/api/queue/queue-list?${p}`)
    },

    queueFlow(flowHash, messageSource, message, includeSteps = []) {
        return postJson('/api/queue/enqueue', { flowHash, messageSource, message, includeSteps })
    },

    getQueueCount() {
        return fetchJson('/api/queue/queue-count')
    },

    getInfo() {
        return fetchJson('/api/info')
    },

    getUiVersion() {
        const headers = uiToken() ? { Authorization: `Bearer ${uiToken()}` } : {}
        return fetch('/api/version', { headers }).then(res => res.json())
    },

    /** @param {string} className */
    getStepSource(className) {
        const p = new URLSearchParams({ className })
        return fetchJson(`/api/flow/step-source?${p}`)
    },

    /** @param {string} stepSource */
    getStepSources(stepSource) {
        console.log(stepSource)
        const p = new URLSearchParams({ stepSource })
        return fetchJson(`/api/flow/step-source-list?${p}`)
    },

    /** @param {string} stepHash */
    getStepSourceByHash(stepHash) {
        const p = new URLSearchParams({ stepHash })
        return fetchJson(`/api/flow/step-source?${p}`)
    },

    /** @param {string} className */
    getProjectionHandlerSource(className) {
        const p = new URLSearchParams({ className })
        return fetchJson(`/api/flow/projection-handler-source?${p}`)
    },

    /** @param {{ from?: string, to?: string, type?: string }} [opts] */
    getFlowStats({ from, to, type } = {}) {
        const p = new URLSearchParams()
        if (from) p.set('from', from)
        if (to) p.set('to', to)
        if (type) p.set('type', type)
        return fetchJson(`/api/flow/flow-stats?${p}`)
    },

    /** @param {{ from?: string, to?: string }} [opts] */
    getFlowTypes({ from, to } = {}) {
        const p = new URLSearchParams()
        if (from) p.set('from', from)
        if (to) p.set('to', to)
        return fetchJson(`/api/flow/flow-type-stats?${p}`)
    },

    getProjections() {
        return fetchJson('/api/flow/flow-projection-list')
    },

    getDevFlows() {
        return fetchJson('/api/dev/flow-list')
    },

    /** @param {string} className */
    getDevFlow(className) {
        const p = new URLSearchParams({ className })
        return fetchJson(`/api/dev/flow-source?${p}`)
    },

    /**
     * @param {string} className
     * @param {string} messageSource
     * @param {object} message
     */
    runDevFlow(className, messageSource, message) {
        return postJson('/api/dev/flow-run', { className, messageSource, message })
    },

    getSchedules() {
        return fetchJson('/api/schedule/schedule-list')
    },

    /** @param {string} className */
    getScheduleSource(className) {
        const p = new URLSearchParams({ className })
        return fetchJson(`/api/schedule/schedule-source?${p}`)
    },

    /** @param {string} className */
    runSchedule(className) {
        return postJson('/api/schedule/flow-run', { className })
    },

    /** @returns {Promise<Array>} mock schema data */
    getSchemas() {
        return fetchJson('/api/flow/schema-list')
    },

    /**
     * @param {string} flowHash
     * @param {string} [runtimeHash]
     * @param {(event: object) => void} [onProgress]
     */
    async analyzeFlow(flowHash, runtimeHash = null, onProgress = () => {}, signal = null) {
        const token = localStorage.getItem('fc_token') ?? ''
        const res = await fetch('/api/analyze', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ flowHash, runtimeHash }),
            ...(signal ? { signal } : {}),
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
        const token = localStorage.getItem('fc_token') ?? ''
        return fetch('/api/ai-config', {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        }).then(res => res.json())
    },

    /**
     * @param {string} provider
     * @param {string} apiKey
     * @param {string} model
     * @param {string} [ollamaUrl]
     */
    saveAiConfig(provider, apiKey, model, ollamaUrl) {
        const token = localStorage.getItem('fc_token') ?? ''
        return fetch('/api/ai-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ provider, apiKey, model, ollamaUrl }),
        }).then(res => res.json())
    },

    clearAiConfig() {
        const token = localStorage.getItem('fc_token') ?? ''
        return fetch('/api/ai-config', {
            method: 'DELETE',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        }).then(res => res.json())
    },

    getDevImport() {
        const token = localStorage.getItem('fc_token') ?? ''
        return fetch('/api/dev-import', {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        }).then(res => res.json())
    },

    getDevImportCheck() {
        const token = localStorage.getItem('fc_token') ?? ''
        return fetch('/api/dev-import/check', {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        }).then(res => res.json())
    },

    clearDevImport() {
        const token = localStorage.getItem('fc_token') ?? ''
        return fetch('/api/dev-import', {
            method: 'DELETE',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        }).then(res => res.json())
    },

    /** @param {object} snapshot */
    saveDevImport(snapshot) {
        const token = localStorage.getItem('fc_token') ?? ''
        return fetch('/api/dev-import', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(snapshot),
        }).then(async res => {
            const data = await res.json()
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
            return data
        })
    },
}

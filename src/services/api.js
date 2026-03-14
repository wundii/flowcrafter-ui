import { connection } from './connection.js'

function fetchJson(path) {
    const secret = connection.getSecret()
    const headers = secret ? { Authorization: `Bearer ${secret}` } : {}
    return fetch(`${connection.getUrl()}${path}`, { headers }).then(async res => {
        if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        return res.json()
    })
}

function postJson(path, body) {
    const secret = connection.getSecret()
    const headers = {
        'Content-Type': 'application/json',
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    }
    return fetch(`${connection.getUrl()}${path}`, {
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
     */
    runFlow(flowHash, messageSource, message) {
        return postJson('/api/flows/run', { flowHash, messageSource, message })
    },

    /** @param {{ sort?: 'asc'|'desc' }} [opts] */
    getQueues({ sort = 'desc' } = {}) {
        const p = new URLSearchParams({ sort })
        return fetchJson(`/api/queues?${p}`)
    },

    queueFlow(flowHash, messageSource, message) {
        return postJson('/api/queue', { flowHash, messageSource, message })
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

    /** @returns {Promise<Array>} mock schema data */
    getSchemas() {
        return fetchJson('/api/schemas')
    },
}

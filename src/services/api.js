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
    /** @param {{ sort?: 'asc'|'desc', top?: number, skip?: number, source?: string }} [opts] */
    getFlows({ sort = 'desc', top = 1000, skip = 0, source } = {}) {
        const p = new URLSearchParams({ sort, top, skip })
        if (source) p.set('source', source)
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

    /** @param {{ sort?: 'asc'|'desc', top?: number, skip?: number, flowHash?: string }} [opts] */
    getExceptions({ sort = 'desc', top = 1000, skip = 0, flowHash } = {}) {
        const p = new URLSearchParams({ sort, top, skip })
        if (flowHash) p.set('flowHash', flowHash)
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
}

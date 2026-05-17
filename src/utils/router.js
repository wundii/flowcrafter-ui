const VALID_TABS = new Set(['overview', 'schemas', 'flows', 'exceptions', 'schedules', 'queues', 'dev-tool'])
const HASH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseHash(hash) {
    const raw = (hash || '').replace(/^#\/?/, '')
    const parts = raw.split('/').filter(Boolean)
    const result = { tab: 'overview', prefix: null, flowHash: null, runtimeHash: null }

    if (parts.length === 0) return result

    const tab = parts[0]
    if (!VALID_TABS.has(tab)) return result
    result.tab = tab

    if (tab === 'flows' && parts.length >= 2) {
        if (parts[1] === 'type' && parts[2]) {
            result.prefix = decodeURIComponent(parts[2])
        } else if (parts[1] === 'flow-detail' && parts[2] && HASH_RE.test(parts[2])) {
            result.flowHash = parts[2]
            if (parts[3] === 'run' && parts[4] && HASH_RE.test(parts[4])) {
                result.runtimeHash = parts[4]
            }
        }
    }
    return result
}

function buildHash(state) {
    const { tab = 'overview', prefix = null, flowHash = null, runtimeHash = null } = state
    if (tab === 'flows') {
        if (flowHash && runtimeHash) return `#/flows/flow-detail/${flowHash}/run/${runtimeHash}`
        if (flowHash) return `#/flows/flow-detail/${flowHash}`
        if (prefix) return `#/flows/type/${encodeURIComponent(prefix)}`
        return '#/flows'
    }
    if (!tab || tab === 'overview') return '#/overview'
    return `#/${tab}`
}

export const router = {
    parse() {
        return parseHash(window.location.hash)
    },

    navigate(state, { replace = false } = {}) {
        const nextHash = buildHash(state)
        if (nextHash === window.location.hash) return
        if (replace) {
            const url = window.location.pathname + window.location.search + nextHash
            window.history.replaceState(null, '', url)
        } else {
            window.location.hash = nextHash
        }
    },

    subscribe(fn) {
        const handler = () => fn(parseHash(window.location.hash))
        window.addEventListener('hashchange', handler)
        return () => window.removeEventListener('hashchange', handler)
    },
}

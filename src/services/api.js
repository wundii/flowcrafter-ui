const BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/$/, '')

async function fetchJson(path) {
  const res = await fetch(`${BASE_URL}${path}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export const api = {
  /** @param {{ sort?: 'asc'|'desc', top?: number, source?: string }} [opts] */
  getFlows({ sort = 'desc', top = 1000, source } = {}) {
    const p = new URLSearchParams({ sort, top })
    if (source) p.set('source', source)
    return fetchJson(`/api/flows?${p}`)
  },

  /** @param {string} hash */
  getFlow(hash) {
    return fetchJson(`/api/flows/detail?hash=${encodeURIComponent(hash)}`)
  },

  /** @param {{ sort?: 'asc'|'desc', top?: number, flowHash?: string }} [opts] */
  getExceptions({ sort = 'desc', top = 1000, flowHash } = {}) {
    const p = new URLSearchParams({ sort, top })
    if (flowHash) p.set('flowHash', flowHash)
    return fetchJson(`/api/exceptions?${p}`)
  },
}

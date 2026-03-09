import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'

function shortClass(fqn) {
    return fqn?.split('\\').pop() ?? fqn
}

export class FcSchemaList extends BaseElement {
    static properties = {
        schemas: { state: true },
        loading: { state: true },
        error: { state: true },
    }

    constructor() {
        super()
        this.schemas = []
        this.loading = true
        this.error = null
    }

    connectedCallback() {
        super.connectedCallback()
        this._load()
    }

    async _load() {
        this.loading = true
        this.error = null
        try {
            const [flows, exceptions] = await Promise.all([api.getFlows({ sort: 'desc', top: 1000 }), api.getExceptions({ top: 1000 })])

            // Hashes of flows that have at least one exception
            const failedHashes = new Set(exceptions.map(e => e.flowHash))

            // Group by flowSource
            const map = new Map()
            for (const flow of flows) {
                const src = flow.flowSource
                if (!map.has(src)) {
                    map.set(src, {
                        flowSource: src,
                        flowType: flow.flowType,
                        total: 0,
                        failed: 0,
                        lastTime: null,
                    })
                }
                const s = map.get(src)
                s.total++
                if (failedHashes.has(flow.flowHash)) s.failed++
                if (!s.lastTime || flow.time > s.lastTime) s.lastTime = flow.time
            }

            // Compute successRate
            for (const s of map.values()) {
                s.successRate = s.total > 0 ? Math.round(((s.total - s.failed) / s.total) * 100) : 100
            }

            this.schemas = [...map.values()].sort((a, b) => b.lastTime?.localeCompare(a.lastTime ?? '') ?? 0)
        } catch (err) {
            this.error = err.message
        } finally {
            this.loading = false
        }
    }

    _onSelect(schema) {
        this.dispatchEvent(
            new CustomEvent('schema-selected', {
                detail: { source: schema.flowSource },
                bubbles: true,
                composed: true,
            })
        )
    }

    render() {
        if (this.loading)
            return html`
                <div class="flex justify-center py-16">
                    <span class="loading loading-spinner loading-lg"></span>
                </div>
            `

        if (this.error)
            return html`
                <div class="alert alert-error">
                    <span>Fehler beim Laden: ${this.error}</span>
                    <button class="btn btn-sm btn-ghost ml-2" @click=${this._load}>↻ Retry</button>
                </div>
            `

        if (this.schemas.length === 0) return html` <div class="alert alert-info"><span>Keine Schemas gefunden.</span></div> `

        return html`
            <!-- Toolbar -->
            <div class="flex items-center justify-between mb-4">
                <span class="text-sm text-base-content/60">
                    <span class="font-semibold">${this.schemas.length}</span>
                    Schema${this.schemas.length !== 1 ? 's' : ''}
                </span>
                <button class="btn btn-sm btn-ghost" @click=${this._load}>↻ Reload</button>
            </div>

            <!-- Schema grid -->
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                ${this.schemas.map(schema => {
                    const hasFailed = schema.failed > 0
                    const rateColor = schema.successRate === 100 ? 'text-success' : schema.successRate >= 80 ? 'text-warning' : 'text-error'

                    return html`
                        <div
                            class="rounded-box border bg-base-200 cursor-pointer
                     hover:border-base-content/20 transition-colors flex flex-col
                     ${hasFailed ? 'border-error/25' : 'border-base-300'}"
                            @click=${() => this._onSelect(schema)}
                        >
                            <!-- Card header -->
                            <div class="px-4 pt-4 pb-3 border-b border-base-300">
                                <div class="font-bold text-sm leading-tight mb-0.5 truncate" title="${shortClass(schema.flowSource)}">${shortClass(schema.flowSource)}</div>
                                <div class="font-mono text-xs text-base-content/35 truncate mb-2" title="${schema.flowSource}">
                                    ${schema.flowSource}
                                </div>
                                <span class="badge badge-outline badge-xs font-mono" title="${schema.flowType}">${schema.flowType}</span>
                            </div>

                            <!-- Stats row -->
                            <div class="grid grid-cols-3 divide-x divide-base-300 text-center py-3 flex-1">
                                <div class="px-2">
                                    <div class="text-2xl font-bold text-base-content/80">${schema.total}</div>
                                    <div class="text-xs text-base-content/40 mt-0.5">Runs</div>
                                </div>
                                <div class="px-2">
                                    <div class="text-2xl font-bold ${hasFailed ? 'text-error' : 'text-base-content/20'}">
                                        ${schema.failed}
                                    </div>
                                    <div class="text-xs text-base-content/40 mt-0.5">Fehler</div>
                                </div>
                                <div class="px-2">
                                    <div class="text-2xl font-bold ${rateColor}">${schema.successRate}%</div>
                                    <div class="text-xs text-base-content/40 mt-0.5">OK-Rate</div>
                                </div>
                            </div>

                            <!-- Footer -->
                            <div class="px-4 py-2.5 border-t border-base-300 flex items-center justify-end">
                                <span class="text-xs text-primary/60 font-medium">Flows →</span>
                            </div>
                        </div>
                    `
                })}
            </div>
        `
    }
}

customElements.define('fc-schema-list', FcSchemaList)

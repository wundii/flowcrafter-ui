import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'

function formatDate(iso) {
    if (!iso) return '–'
    const d = new Date(iso)
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('de-DE')
}

export class FcTypeList extends BaseElement {
    static properties = {
        _sortAsc: { state: true },
        error: { state: true },
        loading: { state: true },
        schemas: { state: true },
    }

    constructor() {
        super()
        this._sortAsc = true
        this.error = null
        this.loading = true
        this.schemas = []
    }

    connectedCallback() {
        super.connectedCallback()
        this._load()
    }

    async _load() {
        this.loading = true
        this.error = null
        try {
            const from = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
            const to = new Date().toISOString()

            this.schemas = await api.getFlowTypes({ from, to })
        } catch (err) {
            this.error = err.message
        } finally {
            this.loading = false
        }
    }

    _sortedSchemas() {
        const dir = this._sortAsc ? 1 : -1
        return [...this.schemas].sort((a, b) => dir * a.prefix.localeCompare(b.prefix))
    }

    _onSelect(schema) {
        this.dispatchEvent(
            new CustomEvent('schema-selected', {
                detail: { prefix: schema.prefix },
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

        if (this.schemas.length === 0) return html` <div class="alert alert-info"><span>Keine Types gefunden.</span></div> `

        return html`
            <!-- Toolbar -->
            <div class="flex items-center justify-between mb-4">
                <span class="text-sm text-base-content/60">
                    <span class="font-semibold">${this.schemas.length}</span>
                    Type${this.schemas.length !== 1 ? 's' : ''}
                    <span class="text-base-content/40 ml-1">— Runs der letzten 14 Tage</span>
                </span>
                <div class="flex items-center gap-1">
                    <button
                        class="btn btn-sm btn-ghost border border-base-content/30 hover:border-base-content/50"
                        title=${this._sortAsc ? 'A → Z' : 'Z → A'}
                        @click=${() => {
                            this._sortAsc = !this._sortAsc
                        }}
                    >
                        <svg
                            class="w-3.5 h-3.5 transition-transform ${this._sortAsc ? '' : 'rotate-180'}"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            viewBox="0 0 24 24"
                        >
                            <path stroke-linecap="round" stroke-linejoin="round" d="M3 4h13M3 8h9M3 12h5m4 0l4-4m0 0l4 4m-4-4v12" />
                        </svg>
                    </button>
                    <button
                        class="btn btn-sm btn-ghost border border-base-content/30 hover:border-base-content/50"
                        title="Neu laden"
                        @click=${this._load}
                    >
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                        </svg>
                    </button>
                </div>
            </div>

            <!-- Type grid -->
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                ${this._sortedSchemas().map(schema => {
                    const hasFailed = schema.successRate !== null && schema.successRate < 95
                    const hasRuns = schema.total > 0
                    const rateColor =
                        schema.successRate === null
                            ? 'text-base-content/30'
                            : schema.successRate === 100
                              ? 'text-success'
                              : schema.successRate >= 95
                                ? 'text-success/60'
                                : schema.successRate >= 85
                                  ? 'text-warning'
                                  : schema.successRate >= 70
                                    ? 'text-warning/70'
                                    : schema.successRate >= 50
                                      ? 'text-error/60'
                                      : schema.successRate >= 30
                                        ? 'text-error/80'
                                        : 'text-error'

                    return html`
                        <div
                            class="rounded-box border bg-base-200 cursor-pointer
                     hover:border-base-content/20 transition-colors flex flex-col
                     ${hasFailed ? 'border-error/25' : 'border-base-300'}"
                            @click=${() => this._onSelect(schema)}
                        >
                            <!-- Card header -->
                            <div class="px-4 pt-4 pb-3 border-b border-base-300">
                                <div class="font-bold text-sm leading-tight truncate" title="${schema.prefix}">${schema.prefix}</div>
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
                                    <div class="text-2xl font-bold ${rateColor}">${hasRuns ? html`${schema.successRate}%` : html`—`}</div>
                                    <div class="text-xs text-base-content/40 mt-0.5">OK-Rate</div>
                                </div>
                            </div>

                            <!-- Footer -->
                            <div class="px-4 py-2.5 border-t border-base-300 flex flex-col gap-1">
                                <div class="flex items-center justify-between">
                                    <span class="text-[10px] text-base-content/40">Letzter Lauf</span>
                                    <span class="text-xs text-base-content/50 font-mono">${formatDate(schema.lastTime)}</span>
                                </div>
                            </div>
                        </div>
                    `
                })}
            </div>
        `
    }
}

customElements.define('fc-type-list', FcTypeList)

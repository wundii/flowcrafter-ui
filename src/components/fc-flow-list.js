import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'

const PAGE_SIZE = 10

function formatTzOffset(date) {
    const off = -date.getTimezoneOffset()
    const sign = off >= 0 ? '+' : '-'
    const h = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')
    const m = String(Math.abs(off) % 60).padStart(2, '0')
    return sign + h + ':' + m
}

function shortClass(fqn) {
    return fqn?.split('\\').pop() ?? fqn
}

function formatDate(iso) {
    return new Date(iso).toLocaleString('de-DE', {
        dateStyle: 'short',
        timeStyle: 'medium',
    })
}

export class FcFlowList extends BaseElement {
    static properties = {
        type: { type: String },
        page: { type: Number },
        flows: { state: true },
        loading: { state: true },
        error: { state: true },
        _page: { state: true },
        _hasMore: { state: true },
        _total: { state: true },
        _dateFrom: { state: true },
        _dateTo: { state: true },
    }

    constructor() {
        super()
        this.type = null
        this.page = 0
        this.flows = []
        this.loading = true
        this.error = null
        this._page = 0
        this._hasMore = false
        this._total = null
        this._dateFrom = ''
        this._dateTo = ''
    }

    connectedCallback() {
        super.connectedCallback()
        this._page = this.page ?? 0
        this._load()
    }

    updated(changed) {
        if (changed.has('type') && changed.get('type') !== undefined) {
            this._page = 0
            this._emitPageChange()
            this._load()
        }
    }

    _emitPageChange() {
        this.dispatchEvent(new CustomEvent('page-changed', { detail: { page: this._page }, bubbles: true, composed: true }))
    }

    async _load() {
        this.loading = true
        this.error = null
        try {
            const opts = { type: this.type ?? undefined, top: PAGE_SIZE, skip: this._page * PAGE_SIZE }
            if (this._dateFrom) {
                const d = new Date(this._dateFrom + 'T00:00:00')
                opts.from =
                    d.getFullYear() +
                    '-' +
                    String(d.getMonth() + 1).padStart(2, '0') +
                    '-' +
                    String(d.getDate()).padStart(2, '0') +
                    'T00:00:00' +
                    formatTzOffset(d)
            }
            if (this._dateTo) {
                const d = new Date(this._dateTo + 'T23:59:59')
                opts.to =
                    d.getFullYear() +
                    '-' +
                    String(d.getMonth() + 1).padStart(2, '0') +
                    '-' +
                    String(d.getDate()).padStart(2, '0') +
                    'T23:59:59' +
                    formatTzOffset(d)
            }
            const res = await api.getFlows(opts)
            this.flows = res.items ?? []
            this._hasMore = res.hasMore ?? false
            this._total = res.total ?? null
        } catch (err) {
            this.error = err.message
        } finally {
            this.loading = false
            this.dispatchEvent(new CustomEvent('list-refreshed', { bubbles: true, composed: true }))
        }
    }

    _onSelect(flow) {
        this.dispatchEvent(
            new CustomEvent('flow-selected', {
                detail: { hash: flow.flowHash },
                bubbles: true,
                composed: true,
            })
        )
    }

    _onBack() {
        this.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true }))
    }

    _onPrev() {
        this._page = Math.max(0, this._page - 1)
        this._emitPageChange()
        this._load()
    }

    _onNext() {
        this._page += 1
        this._emitPageChange()
        this._load()
    }

    _applyDateFilter() {
        this._page = 0
        this._emitPageChange()
        this._load()
    }

    _clearDateFilter() {
        this._dateFrom = ''
        this._dateTo = ''
        this._page = 0
        this._emitPageChange()
        this._load()
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

        if (this.flows.length === 0 && this._page === 0)
            return html` <div class="alert alert-info"><span>Keine Flows gefunden.</span></div> `

        const from = this._page * PAGE_SIZE + 1
        const to = this._page * PAGE_SIZE + this.flows.length

        return html`
            <!-- Toolbar -->
            <div class="flex flex-col lg:flex-row lg:items-center gap-2 mb-4">
                <!-- Zeile 1 mobil / Links desktop: Zurück -->
                <div class="flex items-center justify-between lg:justify-start gap-2">
                    <button
                        class="btn btn-sm btn-ghost border border-base-content/30 hover:border-base-content/50 flex-shrink-0"
                        @click=${this._onBack}
                    >
                        ← Zurück zur Type-Übersicht
                    </button>
                    <!-- Datenanzeige + Reload: mobil rechts, desktop hidden -->
                    <div class="flex items-center gap-2 lg:hidden flex-shrink-0">
                        <span class="text-sm text-base-content/60">
                            ${from}–${to} ${this._total !== null ? html`<span class="text-base-content/40">von ${this._total}</span>` : ''}
                        </span>
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

                <!-- Mitte: Datumsfilter -->
                <div class="flex items-center lg:justify-center lg:flex-1 flex-nowrap">
                    <div class="join">
                        <input
                            type="date"
                            class="input input-sm input-bordered join-item w-auto text-xs ${this._dateFrom ? '' : 'text-base-content/40'}"
                            .value=${this._dateFrom}
                            @change=${e => {
                                this._dateFrom = e.target.value
                            }}
                        />
                        <input
                            type="date"
                            class="input input-sm input-bordered join-item w-auto text-xs ${this._dateTo ? '' : 'text-base-content/40'}"
                            .value=${this._dateTo}
                            @change=${e => {
                                this._dateTo = e.target.value
                            }}
                        />
                        <button
                            class="btn btn-sm btn-ghost border border-base-content/30 hover:border-base-content/50 join-item"
                            @click=${this._applyDateFilter}
                            ?disabled=${!this._dateFrom && !this._dateTo}
                        >
                            ↵
                        </button>
                    </div>
                    ${this._dateFrom || this._dateTo
                        ? html`
                              <button
                                  class="btn btn-sm btn-ghost text-base-content/50 hover:text-base-content ml-1"
                                  @click=${this._clearDateFilter}
                              >
                                  ✕
                              </button>
                          `
                        : ''}
                </div>

                <!-- Rechts: Datenanzeige + Reload (nur desktop) -->
                <div class="hidden lg:flex items-center gap-3 flex-shrink-0">
                    <span class="text-sm text-base-content/60">
                        ${from}–${to} ${this._total !== null ? html`<span class="text-base-content/40">von ${this._total}</span>` : ''}
                    </span>
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

            <!-- Flow cards -->
            <div class="flex flex-col gap-2">
                ${this.flows.map(flow => {
                    const hasFailed = flow.exceptionCount > 0
                    return html`
                        <div
                            class="rounded-box border bg-base-200 overflow-hidden cursor-pointer
                     hover:border-base-content/20 transition-colors
                     ${hasFailed ? 'border-error/25' : 'border-base-300'}"
                            @click=${() => this._onSelect(flow)}
                        >
                            <div class="px-4 py-3 flex flex-col gap-1.5">
                                <!-- Row 1: Source + Status -->
                                <div class="flex items-center justify-between gap-2">
                                    <div class="flex items-center gap-2 min-w-0">
                                        ${hasFailed
                                            ? html`<span class="badge badge-error badge-sm leading-none">Failed</span>`
                                            : html`<span class="badge badge-success badge-sm leading-none">OK</span>`}
                                        <span class="font-semibold text-sm text-base-content truncate">
                                            ${shortClass(flow.flowSource)}
                                        </span>
                                    </div>
                                    <span class="text-xs text-base-content/50 flex-shrink-0">${formatDate(flow.time)}</span>
                                </div>
                                <!-- Row 2: Hash -->
                                <div class="font-mono text-xs text-base-content/40 truncate">${flow.flowHash}</div>
                                <!-- Row 3: Subject + Type -->
                                <div class="flex items-baseline justify-between gap-2">
                                    <span class="text-sm text-base-content/50 truncate"> ${flow.flowSubject || ''} </span>
                                    <span class="badge badge-outline badge-xs text-base-content/50 flex-shrink-0">${flow.flowType}</span>
                                </div>
                            </div>
                        </div>
                    `
                })}
            </div>

            <!-- Pagination -->
            <div class="flex items-center justify-center gap-2 mt-4">
                <button class="btn btn-sm btn-ghost border border-base-content/30" ?disabled=${this._page === 0} @click=${this._onPrev}>
                    ← Zurück
                </button>
                <span class="text-sm text-base-content/50">Seite ${this._page + 1}</span>
                <button class="btn btn-sm btn-ghost border border-base-content/30" ?disabled=${!this._hasMore} @click=${this._onNext}>
                    Weiter →
                </button>
            </div>
        `
    }
}

customElements.define('fc-flow-list', FcFlowList)

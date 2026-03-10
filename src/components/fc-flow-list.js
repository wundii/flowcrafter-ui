import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'

const PAGE_SIZE = 10

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
        source: { type: String },
        flows: { state: true },
        loading: { state: true },
        error: { state: true },
        _page: { state: true },
        _hasMore: { state: true },
        _total: { state: true },
    }

    constructor() {
        super()
        this.source = null
        this.flows = []
        this.loading = true
        this.error = null
        this._page = 0
        this._hasMore = false
        this._total = null
    }

    connectedCallback() {
        super.connectedCallback()
        this._load()
    }

    updated(changed) {
        if (changed.has('source')) {
            this._page = 0
            this._load()
        }
    }

    async _load() {
        this.loading = true
        this.error = null
        try {
            const res = await api.getFlows({ source: this.source ?? undefined, top: PAGE_SIZE, skip: this._page * PAGE_SIZE })
            this.flows = res.items ?? []
            this._hasMore = res.hasMore ?? false
            this._total = res.total ?? null
        } catch (err) {
            this.error = err.message
        } finally {
            this.loading = false
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
        this._load()
    }

    _onNext() {
        this._page += 1
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
            <div class="flex items-center justify-between mb-4">
                <button class="btn btn-sm btn-ghost border border-base-content/30 hover:border-base-content/50" @click=${this._onBack}>
                    ← Zurück zur Schema-Übersicht
                </button>
                <div class="flex items-center gap-3">
                    <span class="text-sm text-base-content/60">
                        ${from}–${to} ${this._total !== null ? html`<span class="text-base-content/40">von ${this._total}</span>` : ''}
                    </span>
                    <button class="btn btn-sm btn-ghost" @click=${this._load}>↻ Reload</button>
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
                            <div class="grid grid-cols-[1fr_auto] gap-2 px-4 py-3">
                                <!-- Left: name + subtitle + meta -->
                                <div class="min-w-0">
                                    <div class="font-semibold text-sm text-base-content leading-tight mb-0.5">
                                        ${shortClass(flow.flowSource)}
                                    </div>
                                    <div class="text-sm text-base-content/50 leading-snug break-words mb-2">
                                        ${flow.flowSubject ||
                                        html`<span class="font-mono" style="font-size:11px;">${flow.flowHash.slice(0, 20)}…</span>`}
                                    </div>
                                    <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-base-content/50">
                                        <span class="badge badge-outline badge-xs text-base-content/50">${flow.flowType}</span>
                                        <span>${formatDate(flow.time)}</span>
                                    </div>
                                </div>

                                <!-- Right: status -->
                                <div class="flex flex-col items-end justify-between gap-2 flex-shrink-0">
                                    ${hasFailed
                                        ? html`<span class="badge badge-error badge-sm leading-none">Error</span>`
                                        : html`<span class="badge badge-success badge-sm leading-none">OK</span>`}
                                    <span class="text-xs text-primary/60">Details →</span>
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

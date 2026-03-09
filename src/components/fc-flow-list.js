import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'

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
        source: { type: String }, // filter by flowSource (FQN)
        flows: { state: true },
        loading: { state: true },
        error: { state: true },
    }

    constructor() {
        super()
        this.source = null
        this.flows = []
        this.loading = true
        this.error = null
    }

    connectedCallback() {
        super.connectedCallback()
        this._load()
    }

    updated(changed) {
        if (changed.has('source')) this._load()
    }

    async _load() {
        this.loading = true
        this.error = null
        try {
            this.flows = await api.getFlows({ source: this.source ?? undefined })
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
                    <button class="btn btn-sm ml-2" @click=${this._load}>Retry</button>
                </div>
            `

        if (this.flows.length === 0) return html` <div class="alert alert-info"><span>Keine Flows gefunden.</span></div> `

        return html`
            <!-- Toolbar -->
            <div class="flex items-center justify-between mb-4">
                <button class="btn btn-sm btn-ghost border border-base-content/30 hover:border-base-content/50" @click=${this._onBack}>
                    ← Zurück zur Schema-Übersicht
                </button>
                <div class="flex items-center gap-3">
                    <span class="text-sm text-base-content/60">
                        <span class="font-semibold">${this.flows.length}</span>
                        Flow${this.flows.length !== 1 ? 's' : ''}
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
                                    <!-- Headline: flow source name -->
                                    <div class="font-semibold text-sm text-base-content leading-tight mb-0.5">
                                        ${shortClass(flow.flowSource)}
                                    </div>

                                    <!-- Subtitle: subject or hash -->
                                    <div class="text-sm text-base-content/50 leading-snug break-words mb-2">
                                        ${flow.flowSubject ||
                                        html`<span class="font-mono" style="font-size:11px;">${flow.flowHash.slice(0, 20)}…</span>`}
                                    </div>

                                    <!-- Meta row -->
                                    <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-base-content/50">
                                        <span class="badge badge-outline badge-xs">${flow.flowType}</span>
                                        <span>${formatDate(flow.time)}</span>
                                    </div>
                                </div>

                                <!-- Right: status -->
                                <div class="flex flex-col items-end justify-between gap-2 flex-shrink-0">
                                    ${hasFailed
                                        ? html`<span class="badge badge-error badge-sm">Error</span>`
                                        : html`<span class="badge badge-success badge-sm">OK</span>`}
                                    <span class="text-xs text-primary/60">Details →</span>
                                </div>
                            </div>
                        </div>
                    `
                })}
            </div>
        `
    }
}

customElements.define('fc-flow-list', FcFlowList)

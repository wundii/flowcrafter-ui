import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'
import { buildRuns } from '../services/runs.js'
import './fc-flow-graph.js'

function shortClass(fqn) {
    return fqn?.split('\\').pop() ?? fqn
}

function formatDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'medium' })
}

export class FcFlowDetail extends BaseElement {
    static properties = {
        hash: { type: String },
        initialRuntimeHash: { type: String },
        flow: { state: true },
        loading: { state: true },
        error: { state: true },
        runs: { state: true },
        selectedRunId: { state: true },
        _hoveredRunId: { state: true },
    }

    constructor() {
        super()
        this.hash = ''
        this.initialRuntimeHash = null
        this.flow = null
        this.loading = true
        this.error = null
        this.runs = []
        this.selectedRunId = null
        this._hoveredRunId = null
    }

    updated(changed) {
        if (changed.has('hash') && this.hash) this._load()
    }

    async _load() {
        this.loading = true
        this.error = null
        this.flow = null
        this.runs = []
        this.selectedRunId = null
        try {
            this.flow = await api.getFlow(this.hash)
            this.runs = buildRuns(this.flow)
            // If opened via runtimeHash search, pre-select that run; otherwise default to most recent
            const preselect = this.initialRuntimeHash && this.runs.find(r => r.runId === this.initialRuntimeHash)
            this.selectedRunId = preselect ? this.initialRuntimeHash : (this.runs.at(-1)?.runId ?? null)
            this.dispatchEvent(
                new CustomEvent('flow-loaded', {
                    detail: { source: this.flow.flowSource },
                    bubbles: true,
                    composed: true,
                })
            )
        } catch (err) {
            this.error = err.message
        } finally {
            this.loading = false
        }
    }

    _onBack() {
        this.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true }))
    }

    get _selectedRun() {
        return this.runs.find(r => r.runId === this.selectedRunId) ?? null
    }

    render() {
        return html`
            <div>
                <button class="btn btn-sm btn-ghost border border-base-content/30 hover:border-base-content/50 mb-4" @click=${this._onBack}>
                    ← Zurück zur Flow-Liste
                </button>

                ${this.loading
                    ? html`<div class="flex justify-center py-16">
                          <span class="loading loading-spinner loading-lg"></span>
                      </div>`
                    : this.error
                      ? html`<div class="alert alert-error"><span>${this.error}</span></div>`
                      : this._renderDetail()}
            </div>
        `
    }

    _renderDetail() {
        const f = this.flow
        const run = this._selectedRun
        const hasExceptions = run ? run.exceptions.length > 0 : f.flowExceptions?.length > 0
        const graphRun = this.runs.find(r => r.runId === (this._hoveredRunId ?? this.selectedRunId)) ?? null

        return html`
            <!-- Meta -->
            <div class="card bg-base-200 mb-4">
                <div class="card-body py-3 px-4">
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <div>
                            <div class="text-base-content/50 text-xs mb-1">Typ</div>
                            <span class="badge badge-outline badge-sm">${f.flowType}</span>
                        </div>
                        <div>
                            <div class="text-base-content/50 text-xs mb-1">Source</div>
                            <span class="font-mono text-xs">${shortClass(f.flowSource)}</span>
                        </div>
                        <div>
                            <div class="text-base-content/50 text-xs mb-1">Erstellt</div>
                            <span class="text-xs">${formatDate(f.time)}</span>
                        </div>
                        <div>
                            <div class="text-base-content/50 text-xs mb-1">Status</div>
                            ${hasExceptions
                                ? html`<span class="badge badge-error badge-sm">Failed</span>`
                                : html`<span class="badge badge-success badge-sm">OK</span>`}
                        </div>
                    </div>
                    <div class="mt-1 flex items-center gap-1">
                        <span class="text-xs font-mono text-base-content/40 truncate">${f.flowHash}</span>
                        <button
                            class="btn btn-ghost btn-xs px-1 text-base-content/30 hover:text-base-content/70"
                            title="Hash kopieren"
                            @click=${() => navigator.clipboard.writeText(f.flowHash)}
                        >
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            <!-- Runs Panel -->
            ${this._renderRunsPanel()}

            <!-- Flow Graph -->
            <h3 class="font-semibold mb-2 text-sm uppercase tracking-wide text-base-content/50">
                Flow Graph
                <span class="normal-case font-normal ml-1 text-base-content/30"
                    >— Stub anklicken für Details · Message-Input anklicken zum Editieren</span
                >
            </h3>
            <fc-flow-graph
                .flow=${f}
                .runMessages=${graphRun?.messages ?? null}
                .runExceptions=${graphRun?.exceptions ?? null}
                class="block mb-6"
            ></fc-flow-graph>
        `
    }

    _renderRunsPanel() {
        if (this.runs.length === 0) return ''

        return html`
            <div class="mb-4">
                <div class="flex items-center gap-2 mb-2">
                    <h3 class="font-semibold text-sm uppercase tracking-wide text-base-content/50">Runs</h3>
                    <span class="badge badge-ghost badge-xs">${this.runs.length}</span>
                </div>

                <div class="flex gap-2 overflow-x-auto pb-1">
                    ${this.runs.map(run => {
                        const selected = run.runId === this.selectedRunId
                        return html`
                            <div
                                class="flex-shrink-0 rounded-box border px-3 py-2 text-left cursor-pointer transition-all
                       ${selected ? 'border-primary bg-primary/10' : 'border-base-300 bg-base-200 hover:border-base-content/30'}"
                                @click=${() => { this.selectedRunId = run.runId }}
                                @mouseenter=${() => { this._hoveredRunId = run.runId }}
                                @mouseleave=${() => { this._hoveredRunId = null }}
                            >
                                <div class="flex items-center gap-2 mb-1">
                                    <span class="font-semibold text-xs ${selected ? 'text-primary' : 'text-base-content/70'}">
                                        ${run.label}
                                    </span>
                                    <span class="badge badge-xs ${run.status === 'error' ? 'badge-error' : 'badge-success'}">
                                        ${run.status === 'error' ? 'Error' : 'OK'}
                                    </span>
                                </div>
                                <div class="flex items-center gap-1">
                                    <span class="text-xs text-base-content/40 font-mono">${formatDate(run.time)}</span>
                                    <button
                                        class="btn btn-ghost btn-xs px-1 text-base-content/30 hover:text-base-content/70"
                                        title="Runtime-Hash kopieren"
                                        @click=${e => { e.stopPropagation(); navigator.clipboard.writeText(run.runId) }}
                                    >
                                        <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        `
                    })}
                </div>
            </div>
        `
    }
}

customElements.define('fc-flow-detail', FcFlowDetail)

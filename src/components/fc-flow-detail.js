import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'
import { buildRuns } from '../services/runs.js'
import './fc-flow-graph.js'
import './fc-json-editor.js'

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
        _toast: { state: true },
        _refreshCountdown: { state: true },
        _rawModal: { state: true },
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
        this._toast = null
        this._toastTimer = null
        this._refreshTimer = null
        this._refreshCountdown = null
        this._countdownInterval = null
        this._rawModal = false
    }

    updated(changed) {
        if (changed.has('hash') && this.hash) this._load()
        if (changed.has('selectedRunId') && this.selectedRunId) {
            this.updateComplete.then(() => this._scrollToSelected())
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback()
        clearTimeout(this._toastTimer)
        clearTimeout(this._refreshTimer)
        clearInterval(this._countdownInterval)
    }

    async _load(preserveSelection = false) {
        this.loading = true
        this.error = null
        this.flow = null
        this.runs = []
        if (!preserveSelection) this.selectedRunId = null
        try {
            this.flow = await api.getFlow(this.hash)
            this.runs = buildRuns(this.flow)
            if (!preserveSelection) {
                const preselect = this.initialRuntimeHash && this.runs.find(r => r.runId === this.initialRuntimeHash)
                this.selectedRunId = preselect ? this.initialRuntimeHash : (this.runs.at(-1)?.runId ?? null)
            } else {
                // keep selection if still valid, otherwise select latest
                if (!this.runs.find(r => r.runId === this.selectedRunId)) {
                    this.selectedRunId = this.runs.at(-1)?.runId ?? null
                }
            }
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

    _scrollToSelected() {
        this.querySelector(`[data-run-id="${this.selectedRunId}"]`)
            ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    }

    _onBack() {
        this.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true }))
    }

    _onRunComplete(e) {
        const msg = e.detail?.queued
            ? 'Flow wurde in die Queue eingereiht'
            : 'Flow wurde direkt ausgeführt'
        this._showToast(msg, 'success')
        if (e.detail?.queued) {
            clearTimeout(this._refreshTimer)
            clearInterval(this._countdownInterval)
            const delay = 5
            this._refreshCountdown = delay
            this._countdownInterval = setInterval(() => {
                this._refreshCountdown -= 1
                if (this._refreshCountdown <= 0) {
                    clearInterval(this._countdownInterval)
                    this._refreshCountdown = null
                }
            }, 1000)
            this._refreshTimer = setTimeout(() => {
                clearInterval(this._countdownInterval)
                this._refreshCountdown = null
                this._load(false)
            }, delay * 1000)
        } else {
            this._loadAndSelect(e.detail?.runtimeHash ?? null)
        }
    }

    async _loadAndSelect(runtimeHash) {
        await this._load(true)
        if (runtimeHash) {
            const match = this.runs.find(r => r.runId === runtimeHash)
            if (match) this.selectedRunId = runtimeHash
        } else {
            this.selectedRunId = this.runs.at(-1)?.runId ?? null
        }
    }

    _showToast(message, type = 'success') {
        clearTimeout(this._toastTimer)
        this._toast = { message, type }
        this._toastTimer = setTimeout(() => { this._toast = null }, 3500)
    }

    get _selectedRun() {
        return this.runs.find(r => r.runId === this.selectedRunId) ?? null
    }

    render() {
        return html`
            <div @run-complete=${this._onRunComplete}>
                <!-- Toast notification -->
                ${this._toast ? html`
                    <div class="toast toast-top toast-end z-50">
                        <div class="alert ${this._toast.type === 'success' ? 'alert-success' : 'alert-error'} shadow-lg text-sm py-2 px-4">
                            <span>${this._toast.message}</span>
                        </div>
                    </div>
                ` : ''}

                <!-- Refresh countdown -->
                ${this._refreshCountdown !== null ? html`
                    <div class="toast toast-top toast-end z-50" style="margin-top:${this._toast ? '3.5rem' : '0'}">
                        <div class="alert bg-slate-700/90 border border-slate-500/50 shadow-lg text-sm py-2 px-4 flex items-center gap-2">
                            <span class="loading loading-spinner loading-xs text-slate-300"></span>
                            <span class="text-slate-200">Refresh in ${this._refreshCountdown}s…</span>
                        </div>
                    </div>
                ` : ''}

                <div class="flex items-center gap-2 mb-4">
                    <button class="btn btn-sm btn-ghost border border-base-content/30 hover:border-base-content/50" @click=${this._onBack}>
                        ← Zurück zur Flow-Liste
                    </button>
                    <button class="btn btn-sm btn-ghost border border-base-content/30 hover:border-base-content/50" @click=${async () => { await this._load(true); this._scrollToSelected() }} title="Neu laden">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                    ${this.flow ? html`
                        <button
                            class="btn btn-sm btn-ghost border border-base-content/30 hover:border-base-content/50"
                            title="Raw JSON anzeigen"
                            @click=${() => {
                                this._rawModal = true
                                this.updateComplete.then(() => this.querySelector('#fc-raw-modal')?.showModal())
                            }}
                        >
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4-4 4M7 8l-4 4 4 4M14 4l-4 16" />
                            </svg>
                        </button>
                    ` : ''}
                </div>

                <!-- Raw JSON Modal -->
                <dialog id="fc-raw-modal" class="modal" @close=${() => { this._rawModal = false }}>
                    ${this._rawModal && this.flow ? html`
                        <div class="modal-box w-[95vw] max-w-[95vw] h-[90vh] max-h-[90vh] p-0 flex flex-col overflow-hidden">
                            <!-- Header -->
                            <div class="flex items-center justify-between px-5 pt-4 pb-3 border-b border-base-300 flex-shrink-0">
                                <div>
                                    <h3 class="font-bold text-base leading-tight">Raw JSON</h3>
                                    <span class="font-mono text-xs text-base-content/50">${this.flow.flowHash}</span>
                                </div>
                                <div class="flex items-center gap-2">
                                    <button
                                        class="btn btn-ghost btn-sm"
                                        title="JSON kopieren"
                                        @click=${() => navigator.clipboard.writeText(JSON.stringify(this.flow, null, 2))}
                                    >
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                                        </svg>
                                    </button>
                                    <button class="btn btn-ghost btn-sm btn-square" @click=${() => this.querySelector('#fc-raw-modal')?.close()}>✕</button>
                                </div>
                            </div>

                            <!-- Editor -->
                            <div class="flex-1 overflow-hidden relative">
                                <fc-json-editor
                                    .value=${JSON.stringify(this.flow, null, 2)}
                                    .readonly=${true}
                                    .search=${true}
                                    style="display:block; height:100%; overflow:hidden;"
                                ></fc-json-editor>
                            </div>

                            <!-- Footer -->
                            <div class="flex justify-end px-4 py-3 border-t border-base-300 flex-shrink-0">
                                <button class="btn btn-sm" @click=${() => this.querySelector('#fc-raw-modal')?.close()}>Schließen</button>
                            </div>
                        </div>

                        <form method="dialog" class="modal-backdrop">
                            <button>close</button>
                        </form>
                    ` : ''}
                </dialog>

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
            <div class="card bg-base-200 border border-base-300 mb-4">
                <div class="card-body py-3 px-4">
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <div>
                            <div class="text-base-content/50 text-xs mb-1">Typ</div>
                            <span class="badge badge-outline badge-xs text-base-content/50">${f.flowType}</span>
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
                                ? html`<span class="badge badge-error badge-sm leading-none">Failed</span>`
                                : html`<span class="badge badge-success badge-sm leading-none">OK</span>`}
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
                    >— Stub anklicken für Details</span
                >
            </h3>
            <fc-flow-graph
                .flow=${f}
                .runId=${this.selectedRunId}
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
                                data-run-id="${run.runId}"
                                class="flex-shrink-0 rounded-box border px-3 py-2 text-left cursor-pointer transition-all
                       ${selected ? 'border-primary bg-primary/10' : 'border-base-300 bg-base-200 hover:border-base-content/30'}"
                                @click=${() => {
                                    this.selectedRunId = run.runId
                                    this.querySelector('fc-flow-graph').selectedStub = null
                                }}
                                @mouseenter=${() => { this._hoveredRunId = run.runId }}
                                @mouseleave=${() => { this._hoveredRunId = null }}
                            >
                                <div class="flex items-center gap-2 mb-1">
                                    <span class="font-semibold text-xs ${selected ? 'text-primary' : 'text-base-content/70'}">
                                        ${run.label}
                                    </span>
                                    <span class="badge badge-xs leading-none ${run.status === 'error' ? 'badge-error' : 'badge-success'}">
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

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
        _analysisModal: { state: true },
        _analysis: { state: true },
        _analysisLoading: { state: true },
        _analysisError: { state: true },
        _analysisSteps: { state: true },
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
        this._analysisModal = false
        this._analysis = null
        this._analysisLoading = false
        this._analysisError = null
        this._analysisSteps = []
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
                    detail: { source: this.flow.flowSource, flowType: this.flow.flowType },
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
        this.querySelector(`[data-run-id="${this.selectedRunId}"]`)?.scrollIntoView({
            block: 'nearest',
            inline: 'nearest',
            behavior: 'smooth',
        })
    }

    _onBack() {
        this.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true }))
    }

    async _onAnalyze() {
        this._analysis = null
        this._analysisError = null
        this._analysisSteps = []
        this._analysisLoading = true
        this._analysisModal = true
        this.updateComplete.then(() => this.querySelector('#fc-analysis-modal')?.showModal())
        try {
            const result = await api.analyzeFlow(this.hash, this.selectedRunId, event => {
                this._analysisSteps = [...this._analysisSteps, event]
            })
            this._analysis = result.analysis
        } catch (err) {
            this._analysisError = { message: err.message, detail: err.detail ?? null }
        } finally {
            this._analysisLoading = false
        }
    }

    _closeAnalysisModal() {
        this.querySelector('#fc-analysis-modal')?.close()
        this._analysisModal = false
    }

    _onRunComplete(e) {
        const msg = e.detail?.queued ? 'Flow wurde in die Queue eingereiht' : 'Flow wurde direkt ausgeführt'
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
        this._toastTimer = setTimeout(() => {
            this._toast = null
        }, 3500)
    }

    get _selectedRun() {
        return this.runs.find(r => r.runId === this.selectedRunId) ?? null
    }

    render() {
        return html`
            <div @run-complete=${this._onRunComplete}>
                <!-- Toast notification -->
                ${this._toast
                    ? html`
                          <div class="toast toast-top toast-end z-50">
                              <div
                                  class="alert ${this._toast.type === 'success'
                                      ? 'alert-success'
                                      : 'alert-error'} shadow-lg text-sm py-2 px-4"
                              >
                                  <span>${this._toast.message}</span>
                              </div>
                          </div>
                      `
                    : ''}

                <!-- Refresh countdown -->
                ${this._refreshCountdown !== null
                    ? html`
                          <div class="toast toast-top toast-end z-50" style="margin-top:${this._toast ? '3.5rem' : '0'}">
                              <div
                                  class="alert bg-slate-700/90 border border-slate-500/50 shadow-lg text-sm py-2 px-4 flex items-center gap-2"
                              >
                                  <span class="loading loading-spinner loading-xs text-slate-300"></span>
                                  <span class="text-slate-200">Refresh in ${this._refreshCountdown}s…</span>
                              </div>
                          </div>
                      `
                    : ''}

                <div class="flex items-center gap-2 mb-4">
                    <button class="btn btn-sm btn-ghost border border-base-content/30 hover:border-base-content/50" @click=${this._onBack}>
                        ← Zurück zur Flow-Liste
                    </button>
                    <div class="ml-auto flex items-center gap-2">
                        ${this.flow
                            ? html`
                                  <button
                                      class="btn btn-sm btn-ghost border border-base-content/30 hover:border-base-content/50"
                                      title="AI-Analyse starten"
                                      ?disabled=${this._analysisLoading}
                                      @click=${this._onAnalyze}
                                  >
                                      ${this._analysisLoading
                                          ? html`<span class="loading loading-spinner loading-xs"></span>`
                                          : html`<svg
                                                class="w-3.5 h-3.5"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="2"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z"
                                                />
                                            </svg>`}
                                  </button>
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
                              `
                            : ''}
                        <button
                            class="btn btn-sm btn-ghost border border-base-content/30 hover:border-base-content/50"
                            title="Neu laden"
                            @click=${async () => {
                                await this._load(true)
                                this._scrollToSelected()
                            }}
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

                <!-- Raw JSON Modal -->
                <dialog
                    id="fc-raw-modal"
                    class="modal"
                    @close=${() => {
                        this._rawModal = false
                    }}
                >
                    ${this._rawModal && this.flow
                        ? html`
                              <div class="modal-box w-[95vw] max-w-[95vw] h-[90vh] max-h-[90vh] p-0 flex flex-col overflow-hidden">
                                  <!-- Header -->
                                  <div
                                      class="bg-gradient-to-br from-primary/10 via-secondary/5 to-transparent px-5 pt-4 pb-3 flex-shrink-0"
                                  >
                                      <div class="flex items-center justify-between">
                                          <div class="flex items-center gap-3">
                                              <div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                                                  <svg
                                                      class="w-5 h-5 text-primary"
                                                      fill="none"
                                                      stroke="currentColor"
                                                      stroke-width="2"
                                                      viewBox="0 0 24 24"
                                                  >
                                                      <path
                                                          stroke-linecap="round"
                                                          stroke-linejoin="round"
                                                          d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
                                                      />
                                                  </svg>
                                              </div>
                                              <div>
                                                  <h3 class="font-bold text-base leading-tight">Raw JSON</h3>
                                                  <span class="font-mono text-xs text-base-content/50">${this.flow.flowHash}</span>
                                              </div>
                                          </div>
                                          <div class="flex items-center gap-2">
                                              <button
                                                  class="btn btn-ghost btn-sm"
                                                  title="JSON kopieren"
                                                  @click=${() => navigator.clipboard.writeText(JSON.stringify(this.flow, null, 2))}
                                              >
                                                  <svg
                                                      class="w-4 h-4"
                                                      fill="none"
                                                      stroke="currentColor"
                                                      stroke-width="2"
                                                      viewBox="0 0 24 24"
                                                  >
                                                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                                                  </svg>
                                              </button>
                                              <button
                                                  class="btn btn-ghost btn-sm btn-square btn-circle"
                                                  @click=${() => this.querySelector('#fc-raw-modal')?.close()}
                                              >
                                                  ✕
                                              </button>
                                          </div>
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
                              </div>

                              <form method="dialog" class="modal-backdrop backdrop-blur-sm">
                                  <button>close</button>
                              </form>
                          `
                        : ''}
                </dialog>

                <!-- Analysis Modal -->
                ${this._renderAnalysisModal()}
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
                            <div class="flex items-center gap-1 flex-wrap">
                                ${hasExceptions
                                    ? html`<span class="badge badge-error badge-sm leading-none">Failed</span>`
                                    : html`<span class="badge badge-success badge-sm leading-none">OK</span>`}
                                ${f.isExecutable === false
                                    ? html`<span class="badge badge-sm border-slate-500/50 bg-slate-600/40 text-slate-300 leading-none"
                                          >Nicht ausführbar</span
                                      >`
                                    : ''}
                            </div>
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
                <span class="normal-case font-normal ml-1 text-base-content/30">— Stub anklicken für Details</span>
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

    _renderAnalysisModal() {
        const severityLabel = s => ({ high: 'Hoch', medium: 'Mittel', low: 'Niedrig' })[s] ?? s
        const categoryLabel = c => ({ error: 'Fehler', warning: 'Warnung', performance: 'Performance', info: 'Info' })[c] ?? c
        const categoryIcon = c =>
            ({
                error: html`<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z M12 15.75h.007v.008H12v-.008z"
                    />
                </svg>`,
                warning: html`<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z M12 15.75h.007v.008H12v-.008z"
                    />
                </svg>`,
                performance: html`<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>`,
                info: html`<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
                    />
                </svg>`,
            })[c] ?? ''
        const severityColor = s => ({ high: 'text-error', medium: 'text-warning', low: 'text-base-content/50' })[s] ?? ''
        const categoryColor = c =>
            ({
                error: 'border-error/40 bg-error/5',
                warning: 'border-warning/40 bg-warning/5',
                performance: 'border-info/40 bg-info/5',
                info: 'border-base-content/20 bg-base-content/3',
            })[c] ?? ''
        const categoryAccent = c =>
            ({ error: 'text-error', warning: 'text-warning', performance: 'text-info', info: 'text-base-content/60' })[c] ?? ''

        return html`
            <dialog
                id="fc-analysis-modal"
                class="modal"
                @close=${() => {
                    this._analysisModal = false
                }}
            >
                ${this._analysisModal
                    ? html`
                          <div class="modal-box w-[700px] max-w-[90vw] max-h-[85vh] p-0 flex flex-col overflow-hidden">
                              <!-- Header -->
                              <div class="bg-gradient-to-br from-primary/10 via-secondary/5 to-transparent px-5 pt-4 pb-3 flex-shrink-0">
                                  <div class="flex items-center justify-between">
                                      <div class="flex items-center gap-3">
                                          <div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                                              <svg class="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="currentColor">
                                                  <path
                                                      d="M9 4.5a.75.75 0 01.721.544l.813 2.846a3.75 3.75 0 002.576 2.576l2.846.813a.75.75 0 010 1.442l-2.846.813a3.75 3.75 0 00-2.576 2.576l-.813 2.846a.75.75 0 01-1.442 0l-.813-2.846a3.75 3.75 0 00-2.576-2.576l-2.846-.813a.75.75 0 010-1.442l2.846-.813A3.75 3.75 0 007.466 7.89l.813-2.846A.75.75 0 019 4.5zM18 1.5a.75.75 0 01.728.568l.258 1.036c.236.94.97 1.674 1.91 1.91l1.036.258a.75.75 0 010 1.456l-1.036.258c-.94.236-1.674.97-1.91 1.91l-.258 1.036a.75.75 0 01-1.456 0l-.258-1.036a2.625 2.625 0 00-1.91-1.91l-1.036-.258a.75.75 0 010-1.456l1.036-.258a2.625 2.625 0 001.91-1.91l.258-1.036A.75.75 0 0118 1.5zM16.5 15a.75.75 0 01.712.513l.394 1.183c.15.447.5.799.948.948l1.183.395a.75.75 0 010 1.422l-1.183.395c-.447.15-.799.5-.948.948l-.395 1.183a.75.75 0 01-1.422 0l-.395-1.183a1.5 1.5 0 00-.948-.948l-1.183-.395a.75.75 0 010-1.422l1.183-.395c.447-.15.799-.5.948-.948l.395-1.183A.75.75 0 0116.5 15z"
                                                  />
                                              </svg>
                                          </div>
                                          <div>
                                              <h3 class="font-bold text-base leading-tight">AI-Analyse</h3>
                                              <span class="text-xs text-base-content/50"
                                                  >${this.flow ? shortClass(this.flow.flowSource) : ''}</span
                                              >
                                          </div>
                                      </div>
                                      <button class="btn btn-ghost btn-sm btn-square btn-circle" @click=${this._closeAnalysisModal}>
                                          ✕
                                      </button>
                                  </div>
                              </div>

                              <!-- Content -->
                              <div class="flex-1 overflow-y-auto px-5 py-4">
                                  ${this._analysisLoading
                                      ? html`
                                            <div class="flex flex-col items-center justify-center py-12 gap-4">
                                                <span class="loading loading-spinner loading-lg text-primary"></span>
                                                <div class="flex flex-col items-center gap-1.5">
                                                    ${this._analysisSteps.map(
                                                        (step, i) => html`
                                                            <div
                                                                class="flex items-center gap-2 text-xs ${i ===
                                                                this._analysisSteps.length - 1
                                                                    ? 'text-base-content/60'
                                                                    : 'text-base-content/30'}"
                                                            >
                                                                ${step.type === 'tool_use'
                                                                    ? html`<svg
                                                                          class="w-3 h-3"
                                                                          fill="none"
                                                                          stroke="currentColor"
                                                                          stroke-width="2"
                                                                          viewBox="0 0 24 24"
                                                                      >
                                                                          <path
                                                                              stroke-linecap="round"
                                                                              stroke-linejoin="round"
                                                                              d="M17 8l4 4-4 4M7 8l-4 4 4 4M14 4l-4 16"
                                                                          />
                                                                      </svg>`
                                                                    : html`<svg
                                                                          class="w-3 h-3"
                                                                          fill="none"
                                                                          stroke="currentColor"
                                                                          stroke-width="2"
                                                                          viewBox="0 0 24 24"
                                                                      >
                                                                          <path
                                                                              stroke-linecap="round"
                                                                              stroke-linejoin="round"
                                                                              d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                                                          />
                                                                      </svg>`}
                                                                <span>${step.message}</span>
                                                            </div>
                                                        `
                                                    )}
                                                </div>
                                            </div>
                                        `
                                      : this._analysisError
                                        ? html`
                                              <div class="rounded-lg border border-error/30 bg-error/5 p-4">
                                                  <div class="flex items-center gap-2 mb-2">
                                                      <svg
                                                          class="w-4 h-4 text-error flex-shrink-0"
                                                          fill="none"
                                                          stroke="currentColor"
                                                          stroke-width="2"
                                                          viewBox="0 0 24 24"
                                                      >
                                                          <path
                                                              stroke-linecap="round"
                                                              stroke-linejoin="round"
                                                              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                                                          />
                                                      </svg>
                                                      <span class="text-sm font-medium text-error">Analyse fehlgeschlagen</span>
                                                  </div>
                                                  <p class="text-sm text-base-content/70 ml-6">${this._analysisError.message}</p>
                                                  ${this._analysisError.detail
                                                      ? html`<pre
                                                            class="mt-3 ml-6 p-3 rounded bg-base-300 text-xs font-mono text-base-content/60 overflow-x-auto whitespace-pre-wrap"
                                                        >
${JSON.stringify(this._analysisError.detail, null, 2)}</pre
                                                        >`
                                                      : ''}
                                              </div>
                                          `
                                        : this._analysis
                                          ? html`
                                                <!-- Summary -->
                                                <div class="rounded-lg bg-base-200 border border-base-300 p-4 mb-5">
                                                    <div class="text-xs font-semibold uppercase tracking-wider text-base-content/40 mb-1.5">
                                                        Zusammenfassung
                                                    </div>
                                                    <p class="text-sm text-base-content/80 leading-relaxed">${this._analysis.summary}</p>
                                                </div>

                                                <!-- Findings -->
                                                ${this._analysis.findings.length === 0
                                                    ? html`
                                                          <div class="flex items-center gap-2 text-success py-4">
                                                              <svg
                                                                  class="w-5 h-5"
                                                                  fill="none"
                                                                  stroke="currentColor"
                                                                  stroke-width="2"
                                                                  viewBox="0 0 24 24"
                                                              >
                                                                  <path
                                                                      stroke-linecap="round"
                                                                      stroke-linejoin="round"
                                                                      d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                                                  />
                                                              </svg>
                                                              <span class="text-sm font-medium">Keine Auffälligkeiten gefunden</span>
                                                          </div>
                                                      `
                                                    : html`
                                                          <div class="flex flex-col gap-3">
                                                              ${this._analysis.findings.map(
                                                                  f => html`
                                                                      <div class="rounded-lg border p-4 ${categoryColor(f.category)}">
                                                                          <div class="flex items-start gap-3">
                                                                              <div
                                                                                  class="flex-shrink-0 mt-0.5 ${categoryAccent(f.category)}"
                                                                              >
                                                                                  ${categoryIcon(f.category)}
                                                                              </div>
                                                                              <div class="flex-1 min-w-0">
                                                                                  <div class="flex items-center gap-2 flex-wrap mb-1.5">
                                                                                      <span class="text-sm font-semibold text-base-content"
                                                                                          >${f.title}</span
                                                                                      >
                                                                                      <span
                                                                                          class="text-xs px-1.5 py-0.5 rounded-full bg-base-content/8 ${severityColor(
                                                                                              f.severity
                                                                                          )}"
                                                                                          >${severityLabel(f.severity)}</span
                                                                                      >
                                                                                      <span
                                                                                          class="text-xs px-1.5 py-0.5 rounded-full bg-base-content/8 text-base-content/50"
                                                                                          >${categoryLabel(f.category)}</span
                                                                                      >
                                                                                  </div>
                                                                                  <p class="text-sm text-base-content/60 leading-relaxed">
                                                                                      ${f.description}
                                                                                  </p>
                                                                                  ${f.affectedStub
                                                                                      ? html`<div
                                                                                            class="mt-2 inline-flex items-center gap-1.5 text-xs font-mono text-base-content/40 bg-base-content/5 rounded px-2 py-1"
                                                                                        >
                                                                                            <svg
                                                                                                class="w-3 h-3"
                                                                                                fill="none"
                                                                                                stroke="currentColor"
                                                                                                stroke-width="2"
                                                                                                viewBox="0 0 24 24"
                                                                                            >
                                                                                                <path
                                                                                                    stroke-linecap="round"
                                                                                                    stroke-linejoin="round"
                                                                                                    d="M17 8l4 4-4 4M7 8l-4 4 4 4M14 4l-4 16"
                                                                                                />
                                                                                            </svg>
                                                                                            ${shortClass(f.affectedStub)}
                                                                                        </div>`
                                                                                      : ''}
                                                                              </div>
                                                                          </div>
                                                                      </div>
                                                                  `
                                                              )}
                                                          </div>
                                                      `}
                                            `
                                          : ''}
                              </div>
                          </div>

                          <form method="dialog" class="modal-backdrop backdrop-blur-sm">
                              <button>close</button>
                          </form>
                      `
                    : ''}
            </dialog>
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
                                @mouseenter=${() => {
                                    this._hoveredRunId = run.runId
                                }}
                                @mouseleave=${() => {
                                    this._hoveredRunId = null
                                }}
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
                                        @click=${e => {
                                            e.stopPropagation()
                                            navigator.clipboard.writeText(run.runId)
                                        }}
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

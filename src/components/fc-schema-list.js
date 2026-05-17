import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'
import { timeEl } from '../utils/time.js'
import './fc-flow-graph.js'
import './fc-source-viewer.js'
import './fc-empty-state.js'
import './fc-tooltip.js'

function shortName(fqcn) {
    return fqcn.split('\\').pop()
}

function namespacePart(fqcn) {
    const parts = fqcn.split('\\')
    if (parts.length <= 1) return ''
    return parts.slice(0, -1).join('\\') + '\\'
}

const ENUM_BADGE = { init: 'badge-info', step: 'badge-success' }

export class FcSchemaList extends BaseElement {
    static properties = {
        _filter: { state: true },
        _flows: { state: true },
        _graphFlow: { state: true },
        _graphFlowLabel: { state: true },

        _hoveredStep: { state: true },
        _popupX: { state: true },
        _popupY: { state: true },
        _selectedStep: { state: true },
        _selectedVersionIdx: { state: true },
        _sortAsc: { state: true },
        _stepSourceCurrent: { state: true },
        _stepSourceError: { state: true },
        _stepSourceFallback: { state: true },
        _stepVersions: { state: true },
    }

    constructor() {
        super()
        this._filter = ''
        this._flows = []
        this._graphFlow = null
        this._graphFlowLabel = null
        this._hoveredStep = null
        this._popupX = 0
        this._popupY = 0
        this._selectedStep = null
        this._selectedVersionIdx = null
        this._sortAsc = true
        this._stepSourceCurrent = true
        this._stepSourceError = null
        this._stepSourceFallback = null
        this._stepUsageMap = new Map()
        this._stepVersions = []
    }

    async connectedCallback() {
        super.connectedCallback()
        this._load()
    }

    async _load() {
        const schemas = await api.getSchemas()
        this._processSchemas(schemas)
    }

    _processSchemas(schemas) {
        const stepUsage = new Map()

        // Collect steps per schema
        const raw = schemas.map(schema => {
            const steps = schema.steps.map(s => ({
                source: s.source,
                messageEnum: s.messageEnum,
                messages: s.messages ?? [],
                returnTypes: s.returnTypes ?? [],
                retries: s.retries ?? 0,
                delay: s.delay ?? 200,
            }))
            for (const s of steps) {
                if (!stepUsage.has(s.source)) stepUsage.set(s.source, new Set())
                stepUsage.get(s.source).add(schema.type)
            }
            return { type: schema.type, steps }
        })

        this._flows = raw.map(entry => ({ label: entry.type, steps: entry.steps }))
        this._stepUsageMap = stepUsage
    }

    _sortedFlows() {
        const dir = this._sortAsc ? 1 : -1
        return [...this._flows].sort((a, b) => dir * a.label.localeCompare(b.label))
    }

    _filteredFlows() {
        const sorted = this._sortedFlows()
        const q = this._filter.toLowerCase()
        if (!q) return sorted

        return sorted.filter(f => f.label.toLowerCase().includes(q) || f.steps.some(s => shortName(s.source).toLowerCase().includes(q)))
    }

    _onStepClick(e, step) {
        e.stopPropagation()
        this._filter = shortName(step.source)
    }

    async _openSourceModal(step) {
        this._hoveredStep = null
        this._selectedStep = step
        this._selectedVersionIdx = null
        this._stepSourceCurrent = true
        this._stepSourceError = null
        this._stepSourceFallback = null
        this._stepVersions = []
        try {
            console.log(step.source)
            const versions = await api.getStepSources(step.source)
            if (versions.length > 0) {
                this._stepVersions = versions
                const currentIdx = versions.findIndex(v => v.current === true)
                this._selectedVersionIdx = currentIdx !== -1 ? currentIdx : 0
            } else {
                const data = await api.getStepSource(step.source)
                this._stepSourceFallback = data.source ?? ''
                this._stepSourceCurrent = data.current !== false
            }
            await this.updateComplete
            this.renderRoot.querySelector('#step-source-modal')?.showModal()
        } catch (err) {
            if (err.message.includes('404')) {
                this._stepSourceError = `${step.source} ist nicht mehr verfügbar.`
            } else {
                this._stepSourceError = err.message
            }
            await this.updateComplete
            this.renderRoot.querySelector('#step-source-modal')?.showModal()
        }
    }

    get _selectedVersion() {
        if (this._selectedVersionIdx === null || this._selectedVersionIdx === undefined || !this._stepVersions.length) return null
        return this._stepVersions[this._selectedVersionIdx] ?? null
    }

    _closeSourceModal() {
        this.renderRoot.querySelector('#step-source-modal')?.close()
    }

    _openGraphModal(flow) {
        this._graphFlowLabel = flow.label
        this._graphFlow = {
            flowSchema: { steps: flow.steps },
            flowMessages: [],
            flowExceptions: [],
        }
        this.updateComplete.then(() => {
            this.renderRoot.querySelector('#flow-graph-modal')?.showModal()
        })
    }

    _closeGraphModal() {
        this.renderRoot.querySelector('#flow-graph-modal')?.close()
        this._graphFlow = null
        this._graphFlowLabel = null
    }

    _onStepEnter(e, step) {
        clearTimeout(this._hoverTimer)
        this._hoveredStep = step
        this._popupX = e.clientX
        this._popupY = e.clientY
    }

    _onStepLeave() {
        this._hoverTimer = setTimeout(() => (this._hoveredStep = null), 150)
    }

    _onPopupEnter() {
        clearTimeout(this._hoverTimer)
    }

    _renderStepBadge(step) {
        const name = shortName(step.source)
        const css = ENUM_BADGE[step.messageEnum] ?? 'badge-ghost'
        const usage = this._stepUsageMap.get(step.source)
        const shared = usage && usage.size > 1
        const hasRetry = step.retries > 0

        return html`
            <button
                class="badge badge-sm ${css} ${shared ? 'badge-outline' : ''} cursor-pointer hover:brightness-125 transition-all gap-0.5"
                title=${shared ? `Wird in ${usage.size} Flows verwendet` : ''}
                @mouseenter=${e => this._onStepEnter(e, step)}
                @mouseleave=${() => this._onStepLeave()}
                @click=${e => this._onStepClick(e, step)}
            >
                ${name}
                ${hasRetry
                    ? html`<svg
                          class="w-2.5 h-2.5 opacity-60 shrink-0"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2.5"
                      >
                          <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                          />
                      </svg>`
                    : ''}
                ${shared
                    ? html`<svg
                          class="w-2.5 h-2.5 opacity-60 shrink-0"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2.5"
                      >
                          <circle cx="18" cy="5" r="3" />
                          <circle cx="6" cy="12" r="3" />
                          <circle cx="18" cy="19" r="3" />
                          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                      </svg>`
                    : ''}
            </button>
        `
    }

    _renderPopup() {
        if (!this._hoveredStep) return ''
        const step = this._hoveredStep
        const name = shortName(step.source)
        const usage = this._stepUsageMap.get(step.source)
        const shared = usage && usage.size > 1

        return html`
            <div
                class="fixed z-[9999] w-72 rounded-box border border-base-300 bg-base-100 shadow-lg p-4"
                style="left:${this._popupX}px; top:${this._popupY + 12}px;"
                @mouseenter=${() => this._onPopupEnter()}
                @mouseleave=${() => this._onStepLeave()}
            >
                <div class="bg-base-200 -mx-4 -mt-4 px-4 py-3 rounded-t-box flex items-center justify-between">
                    <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider">${name}</span>
                </div>
                ${step.messages.length || step.returnTypes.length
                    ? html`<div class="bg-base-100 -mx-4 px-4 py-3 flex flex-col gap-2.5">
                          ${step.messages.length
                              ? html`<div>
                                    <span class="text-xs text-base-content/50">Input Messages</span>
                                    <div class="flex flex-col gap-1 mt-1">
                                        ${step.messages.map(
                                            m => html`<span class="font-mono text-xs text-base-content/60 break-all">${shortName(m)}</span>`
                                        )}
                                    </div>
                                </div>`
                              : ''}
                          ${step.returnTypes.length
                              ? html`<div>
                                    <span class="text-xs text-base-content/50">Output Messages</span>
                                    <div class="flex flex-col gap-1 mt-1">
                                        ${step.returnTypes.map(
                                            r => html`<span class="font-mono text-xs text-base-content/60 break-all">${shortName(r)}</span>`
                                        )}
                                    </div>
                                </div>`
                              : ''}
                      </div>`
                    : ''}
                ${step.retries > 0
                    ? html`<div class="bg-base-100 -mx-4 px-4 pt-2.5 pb-1.5 border-t border-base-300 flex items-baseline justify-between gap-3">
                          <span class="text-xs text-base-content/50 shrink-0">Retry</span>
                          <span class="text-xs text-right text-base-content/60 font-mono">${step.retries}× / ${step.delay}ms</span>
                      </div>`
                    : ''}
                ${shared
                    ? html`<div class="bg-base-100 -mx-4 px-4 py-1.5 rounded-b-box flex items-baseline justify-between gap-3">
                          <span class="text-xs text-base-content/50 shrink-0">Shared by</span>
                          <span class="text-xs text-right text-base-content/60">${usage.size} flows</span>
                      </div>`
                    : ''}
            </div>
        `
    }

    render() {
        const filtered = this._filteredFlows()

        return html`
            <div>
                <div class="flex items-center gap-2 mb-4">
                    <div class="join">
                        <input
                            type="text"
                            class="input input-sm join-item w-56 font-mono text-xs"
                            placeholder="Filter..."
                            .value=${this._filter}
                            @input=${e => (this._filter = e.target.value)}
                        />
                        ${this._filter
                            ? html`<button class="btn btn-sm btn-ghost join-item" @click=${() => (this._filter = '')}>
                                  <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                                      <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                              </button>`
                            : ''}
                    </div>
                    <div class="ml-auto flex items-center gap-2">
                        <span class="text-xs text-base-content/40 tabular-nums whitespace-nowrap"
                            >${filtered.length} / ${this._flows.length}</span
                        >
                        <div class="flex items-center gap-1">
                            <fc-tooltip
                                position="bottom"
                                text=${this._sortAsc ? 'A → Z' : 'Z → A'}
                                .content=${html`
                                    <button
                                        class="btn btn-sm btn-ghost btn-circle border border-base-content/20 hover:border-base-content/40"
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
                                            <path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                d="M3 4h13M3 8h9M3 12h5m4 0l4-4m0 0l4 4m-4-4v12"
                                            />
                                        </svg>
                                    </button>
                                `}
                            ></fc-tooltip>
                            <fc-tooltip
                                position="bottom"
                                text="Neu laden"
                                .content=${html`
                                    <button
                                        class="btn btn-sm btn-ghost btn-circle border border-base-content/20 hover:border-base-content/40"
                                        @click=${() => this._load()}
                                    >
                                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                            <path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                            />
                                        </svg>
                                    </button>
                                `}
                            ></fc-tooltip>
                        </div>
                    </div>
                </div>

                ${this._stepSourceError && !this.renderRoot.querySelector('#step-source-modal[open]')
                    ? html`
                          <div class="alert alert-error alert-sm mb-3">
                              <span class="text-sm">${this._stepSourceError}</span>
                              <button
                                  class="btn btn-sm btn-ghost"
                                  @click=${() => {
                                      this._stepSourceError = null
                                  }}
                              >
                                  ✕
                              </button>
                          </div>
                      `
                    : ''}

                <div class="flex flex-col gap-2">
                    ${filtered.length === 0
                        ? html`<fc-empty-state
                              message=${this._filter ? 'Keine Flows für diesen Filter.' : 'Keine Flows vorhanden.'}
                          ></fc-empty-state>`
                        : filtered.map(f => {
                              const initSteps = f.steps.filter(s => s.messageEnum === 'init')
                              const otherSteps = f.steps.filter(s => s.messageEnum !== 'init')
                              const hasBoth = initSteps.length > 0 && otherSteps.length > 0
                              return html`
                                  <div
                                      class="group flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-4 py-3 rounded-box border border-base-300 bg-base-200 hover:bg-base-100 hover:border-base-content/25 transition-all cursor-pointer"
                                      @click=${() => this._openGraphModal(f)}
                                  >
                                      <div class="font-mono shrink-0 sm:w-1/3 min-w-0 overflow-hidden" title=${f.label}>
                                          ${namespacePart(f.label)
                                              ? html`<div class="text-[10px] text-base-content/35 leading-tight truncate">
                                                    ${namespacePart(f.label)}
                                                </div>`
                                              : ''}
                                          <div class="text-xs text-base-content/85 font-semibold leading-tight truncate">
                                              ${shortName(f.label)}
                                          </div>
                                      </div>
                                      <div class="flex flex-wrap items-center gap-1 flex-1 min-w-0">
                                          ${initSteps.map(s => this._renderStepBadge(s))}
                                          ${hasBoth
                                              ? html`<span class="w-px h-3.5 bg-base-content/20 self-center mx-0.5 rounded-full"></span>`
                                              : ''}
                                          ${otherSteps.map(s => this._renderStepBadge(s))}
                                      </div>
                                      <svg
                                          class="w-3.5 h-3.5 text-base-content/25 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity hidden sm:block"
                                          fill="none"
                                          stroke="currentColor"
                                          stroke-width="2"
                                          viewBox="0 0 24 24"
                                      >
                                          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                                      </svg>
                                  </div>
                              `
                          })}
                </div>

                <dialog id="step-source-modal" class="modal">
                    <div class="modal-box w-[95vw] max-w-[95vw] h-[90vh] max-h-[90vh] p-0 flex flex-col overflow-hidden">
                        <div class="bg-gradient-to-br from-primary/10 via-secondary/5 to-transparent px-5 pt-4 pb-3 flex-shrink-0">
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
                                        <h3 class="font-bold text-base leading-tight font-mono truncate">
                                            ${this._selectedStep?.source ?? ''}
                                        </h3>
                                        ${this._stepSourceFallback !== null && this._stepSourceCurrent === false
                                            ? html`<span
                                                  class="badge badge-outline border-base-content/40 text-base-content/60 badge-sm mt-1"
                                                  >archiviert</span
                                              >`
                                            : ''}
                                    </div>
                                </div>
                                <div class="flex items-center gap-1">
                                    ${(this._selectedVersion?.source ?? this._stepSourceFallback) !== null
                                        ? html`<fc-tooltip
                                              text="Quellcode kopieren"
                                              .content=${html`
                                                  <button
                                                      class="btn btn-sm btn-ghost btn-square btn-circle text-base-content/30 hover:text-base-content/70"
                                                      @click=${() =>
                                                          navigator.clipboard.writeText(
                                                              this._selectedVersion?.source ?? this._stepSourceFallback ?? ''
                                                          )}
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
                                              `}
                                          ></fc-tooltip>`
                                        : ''}
                                    <button class="btn btn-sm btn-ghost btn-square btn-circle" @click=${() => this._closeSourceModal()}>
                                        ✕
                                    </button>
                                </div>
                            </div>
                        </div>

                        ${this._stepVersions.length > 0
                            ? html`
                                  <div class="px-4 py-3 border-b border-base-300">
                                      <div class="flex gap-2 overflow-x-auto pb-1">
                                          ${this._stepVersions.map((v, i) => {
                                              const selected = i === this._selectedVersionIdx
                                              return html`
                                                  <div
                                                      class="flex-shrink-0 rounded-box border px-3 py-2 text-left cursor-pointer transition-all
                                                          ${selected
                                                          ? 'border-primary bg-primary/10'
                                                          : 'border-base-300 bg-base-200 hover:border-base-content/30'}"
                                                      @click=${() => {
                                                          this._selectedVersionIdx = i
                                                      }}
                                                  >
                                                      <div class="flex items-center gap-2 mb-1">
                                                          <span
                                                              class="font-semibold text-xs ${selected
                                                                  ? 'text-primary'
                                                                  : 'text-base-content/70'}"
                                                          >
                                                              #${i + 1}
                                                          </span>
                                                          ${v.current
                                                              ? html`<span class="badge badge-xs badge-success leading-none">aktuell</span>`
                                                              : html`<span
                                                                    class="badge badge-xs badge-outline border-base-content/40 text-base-content/60 leading-none"
                                                                    >archiviert</span
                                                                >`}
                                                      </div>
                                                      <div class="text-xs text-base-content/40 font-mono">
                                                          ${v.time ? timeEl(v.time) : '—'}
                                                      </div>
                                                  </div>
                                              `
                                          })}
                                      </div>
                                  </div>
                              `
                            : ''}
                        ${this._stepSourceFallback !== null
                            ? html`<div class="px-4 py-2 border-b border-base-300 text-xs text-base-content/50">
                                  Keine Versionierung verfügbar
                              </div>`
                            : ''}

                        <div class="flex-1 overflow-hidden">
                            ${this._selectedVersion !== null && this._selectedVersion?.source !== undefined
                                ? html`<fc-source-viewer class="block h-full" .value=${this._selectedVersion.source}></fc-source-viewer>`
                                : this._stepSourceFallback !== null
                                  ? html`<fc-source-viewer class="block h-full" .value=${this._stepSourceFallback}></fc-source-viewer>`
                                  : this._stepSourceError
                                    ? html`<div class="p-4 text-error text-sm">${this._stepSourceError}</div>`
                                    : html`<div class="p-4 text-base-content/40 text-sm">Loading...</div>`}
                        </div>
                    </div>
                    <form method="dialog" class="modal-backdrop backdrop-blur-sm">
                        <button>close</button>
                    </form>
                </dialog>

                <dialog id="flow-graph-modal" class="modal">
                    <div class="modal-box w-[95vw] max-w-[95vw] h-[90vh] max-h-[90vh] p-0 flex flex-col overflow-hidden">
                        <div class="bg-gradient-to-br from-primary/10 via-secondary/5 to-transparent px-5 pt-4 pb-3 flex-shrink-0">
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
                                                d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
                                            />
                                        </svg>
                                    </div>
                                    <div>
                                        <h3 class="font-bold text-base leading-tight">Flow Graph</h3>
                                        ${this._graphFlowLabel
                                            ? html`<div class="font-mono mt-0.5">
                                                  ${namespacePart(this._graphFlowLabel)
                                                      ? html`<span class="text-[10px] text-base-content/35"
                                                            >${namespacePart(this._graphFlowLabel)}</span
                                                        >`
                                                      : ''}
                                                  <span class="text-xs text-base-content/55">${shortName(this._graphFlowLabel)}</span>
                                              </div>`
                                            : ''}
                                    </div>
                                </div>
                                <button class="btn btn-sm btn-ghost btn-square btn-circle" @click=${() => this._closeGraphModal()}>
                                    ✕
                                </button>
                            </div>
                        </div>
                        <div class="flex-1 overflow-auto p-4">
                            ${this._graphFlow
                                ? html`<fc-flow-graph
                                      .flow=${this._graphFlow}
                                      readonly
                                      @source-requested=${e => this._openSourceModal({ source: e.detail.source })}
                                  ></fc-flow-graph>`
                                : ''}
                        </div>
                    </div>
                    <form method="dialog" class="modal-backdrop backdrop-blur-sm">
                        <button>close</button>
                    </form>
                </dialog>

                ${this._renderPopup()}
            </div>
        `
    }
}

customElements.define('fc-schema-list', FcSchemaList)

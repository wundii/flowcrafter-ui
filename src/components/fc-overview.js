import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'
import './fc-source-viewer.js'
import './fc-flow-graph.js'

function shortName(fqcn) {
    return fqcn.split('\\').pop()
}

function formatDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'medium' })
}

const ENUM_BADGE = { init: 'badge-info', stub: 'badge-success' }

export class FcOverview extends BaseElement {
    static properties = {
        _filter: { state: true },
        _flows: { state: true },
        _selectedStub: { state: true },
        _stubVersions: { state: true },
        _selectedVersionIdx: { state: true },
        _stubSourceFallback: { state: true },
        _stubSourceCurrent: { state: true },
        _stubSourceError: { state: true },
        _sortAsc: { state: true },
        _hoveredStub: { state: true },
        _popupX: { state: true },
        _popupY: { state: true },
        _graphFlow: { state: true },
    }

    constructor() {
        super()
        this._filter = ''
        this._flows = []
        this._stubUsageMap = new Map()
        this._selectedStub = null
        this._stubVersions = []
        this._selectedVersionIdx = null
        this._stubSourceFallback = null
        this._stubSourceCurrent = true
        this._stubSourceError = null
        this._sortAsc = true
        this._hoveredStub = null
        this._popupX = 0
        this._popupY = 0
        this._graphFlow = null
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
        const stubUsage = new Map()

        // Collect stubs per schema
        const raw = schemas.map(schema => {
            const stubs = schema.stubs.map(s => ({
                source: s.source,
                messageEnum: s.messageEnum,
                messages: s.messages ?? [],
                returnTypes: s.returnTypes ?? [],
            }))
            for (const s of stubs) {
                if (!stubUsage.has(s.source)) stubUsage.set(s.source, new Set())
                stubUsage.get(s.source).add(schema.type)
            }
            return { type: schema.type, stubs }
        })

        this._flows = raw.map(entry => ({ label: entry.type, stubs: entry.stubs }))
        this._stubUsageMap = stubUsage
    }

    _sortedFlows() {
        const dir = this._sortAsc ? 1 : -1
        return [...this._flows].sort((a, b) => dir * a.label.localeCompare(b.label))
    }

    _filteredFlows() {
        const sorted = this._sortedFlows()
        const q = this._filter.toLowerCase()
        if (!q) return sorted

        return sorted.filter(f => f.label.toLowerCase().includes(q) || f.stubs.some(s => shortName(s.source).toLowerCase().includes(q)))
    }

    _onStubClick(e, stub) {
        e.stopPropagation()
        this._filter = shortName(stub.source)
    }

    async _openSourceModal(stub) {
        this._selectedStub = stub
        this._hoveredStub = null
        this._stubVersions = []
        this._selectedVersionIdx = null
        this._stubSourceFallback = null
        this._stubSourceCurrent = true
        this._stubSourceError = null
        try {
            console.log(stub.source)
            const versions = await api.getStubSources(stub.source)
            if (versions.length > 0) {
                this._stubVersions = versions
                const currentIdx = versions.findIndex(v => v.current === true)
                this._selectedVersionIdx = currentIdx !== -1 ? currentIdx : 0
            } else {
                const data = await api.getStubSource(stub.source)
                this._stubSourceFallback = data.source ?? ''
                this._stubSourceCurrent = data.current !== false
            }
            await this.updateComplete
            this.renderRoot.querySelector('#stub-source-modal')?.showModal()
        } catch (err) {
            if (err.message.includes('404')) {
                this._stubSourceError = `${stub.source} ist nicht mehr verfügbar.`
            } else {
                this._stubSourceError = err.message
            }
            await this.updateComplete
            this.renderRoot.querySelector('#stub-source-modal')?.showModal()
        }
    }

    get _selectedVersion() {
        if (this._selectedVersionIdx === null || this._selectedVersionIdx === undefined || !this._stubVersions.length) return null
        return this._stubVersions[this._selectedVersionIdx] ?? null
    }

    _closeSourceModal() {
        this.renderRoot.querySelector('#stub-source-modal')?.close()
    }

    _openGraphModal(flow) {
        this._graphFlow = {
            flowSchema: { stubs: flow.stubs },
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
    }

    _onStubEnter(e, stub) {
        clearTimeout(this._hoverTimer)
        this._hoveredStub = stub
        this._popupX = e.clientX
        this._popupY = e.clientY
    }

    _onStubLeave() {
        this._hoverTimer = setTimeout(() => (this._hoveredStub = null), 150)
    }

    _onPopupEnter() {
        clearTimeout(this._hoverTimer)
    }

    _renderStubBadge(stub) {
        const name = shortName(stub.source)
        const css = ENUM_BADGE[stub.messageEnum] ?? 'badge-ghost'
        const usage = this._stubUsageMap.get(stub.source)
        const shared = usage && usage.size > 1

        return html`
            <button
                class="badge badge-sm ${css} ${shared ? 'badge-outline' : ''} cursor-pointer hover:brightness-125 transition-all"
                @mouseenter=${e => this._onStubEnter(e, stub)}
                @mouseleave=${() => this._onStubLeave()}
                @click=${e => this._onStubClick(e, stub)}
            >
                ${name}
            </button>
        `
    }

    _renderPopup() {
        if (!this._hoveredStub) return ''
        const stub = this._hoveredStub
        const name = shortName(stub.source)
        const usage = this._stubUsageMap.get(stub.source)
        const shared = usage && usage.size > 1

        return html`
            <div
                class="fixed z-[9999] w-72 rounded-box border border-base-300 bg-base-100 shadow-lg p-4"
                style="left:${this._popupX}px; top:${this._popupY + 12}px;"
                @mouseenter=${() => this._onPopupEnter()}
                @mouseleave=${() => this._onStubLeave()}
            >
                <div class="bg-base-200 -mx-4 -mt-4 px-4 py-3 rounded-t-box flex items-center justify-between">
                    <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider">${name}</span>
                </div>
                ${stub.messages.length || stub.returnTypes.length
                    ? html`<div class="bg-base-100 -mx-4 px-4 py-3 flex flex-col gap-2.5">
                          ${stub.messages.length
                              ? html`<div>
                                    <span class="text-xs text-base-content/50">Input Messages</span>
                                    <div class="flex flex-col gap-1 mt-1">
                                        ${stub.messages.map(
                                            m => html`<span class="font-mono text-xs text-base-content/60 break-all">${shortName(m)}</span>`
                                        )}
                                    </div>
                                </div>`
                              : ''}
                          ${stub.returnTypes.length
                              ? html`<div>
                                    <span class="text-xs text-base-content/50">Output Messages</span>
                                    <div class="flex flex-col gap-1 mt-1">
                                        ${stub.returnTypes.map(
                                            r => html`<span class="font-mono text-xs text-base-content/60 break-all">${shortName(r)}</span>`
                                        )}
                                    </div>
                                </div>`
                              : ''}
                      </div>`
                    : ''}
                ${shared
                    ? html`<div class="bg-base-100 -mx-4 px-4 py-3 rounded-b-box flex items-baseline justify-between gap-3">
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
                <div class="flex items-center gap-2 mb-3">
                    <input
                        type="text"
                        class="input input-sm w-64 font-mono text-xs"
                        placeholder="Filter..."
                        .value=${this._filter}
                        @input=${e => (this._filter = e.target.value)}
                    />
                    ${this._filter ? html` <button class="btn btn-sm btn-ghost" @click=${() => (this._filter = '')}>clear</button> ` : ''}
                    <div class="ml-auto flex items-center gap-1">
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

                ${this._stubSourceError && !this.renderRoot.querySelector('#stub-source-modal[open]')
                    ? html`
                          <div class="alert alert-error alert-sm mb-3">
                              <span class="text-sm">${this._stubSourceError}</span>
                              <button
                                  class="btn btn-sm btn-ghost"
                                  @click=${() => {
                                      this._stubSourceError = null
                                  }}
                              >
                                  ✕
                              </button>
                          </div>
                      `
                    : ''}

                <div class="flex flex-col gap-2">
                    ${filtered.length === 0
                        ? html`<div class="text-center text-base-content/40 py-8">No flows match the current filters.</div>`
                        : filtered.map(
                              f => html`
                                  <div
                                      class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 px-4 py-3 rounded-box border border-base-300 bg-base-200 hover:border-base-content/20 transition-colors cursor-pointer"
                                      @click=${() => this._openGraphModal(f)}
                                  >
                                      <span class="font-mono text-xs text-base-content/80 shrink-0 sm:w-1/3 truncate" title=${f.label}
                                          >${f.label}</span
                                      >
                                      <div class="flex flex-wrap gap-1">${f.stubs.map(s => this._renderStubBadge(s))}</div>
                                  </div>
                              `
                          )}
                </div>

                <div class="text-xs text-base-content/40 mt-2">${filtered.length} / ${this._flows.length} flows</div>

                <dialog id="stub-source-modal" class="modal">
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
                                            ${this._selectedStub?.source ?? ''}
                                        </h3>
                                        ${this._stubSourceFallback !== null && this._stubSourceCurrent === false
                                            ? html`<span
                                                  class="badge badge-outline border-base-content/40 text-base-content/60 badge-sm mt-1"
                                                  >archiviert</span
                                              >`
                                            : ''}
                                    </div>
                                </div>
                                <div class="flex items-center gap-1">
                                    ${(this._selectedVersion?.source ?? this._stubSourceFallback) !== null
                                        ? html`<button
                                              class="btn btn-sm btn-ghost btn-square btn-circle text-base-content/30 hover:text-base-content/70"
                                              title="Quellcode kopieren"
                                              @click=${() =>
                                                  navigator.clipboard.writeText(
                                                      this._selectedVersion?.source ?? this._stubSourceFallback ?? ''
                                                  )}
                                          >
                                              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                                              </svg>
                                          </button>`
                                        : ''}
                                    <button class="btn btn-sm btn-ghost btn-square btn-circle" @click=${() => this._closeSourceModal()}>
                                        ✕
                                    </button>
                                </div>
                            </div>
                        </div>

                        ${this._stubVersions.length > 0
                            ? html`
                                  <div class="px-4 py-3 border-b border-base-300">
                                      <div class="flex gap-2 overflow-x-auto pb-1">
                                          ${this._stubVersions.map((v, i) => {
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
                                                      <div class="text-xs text-base-content/40 font-mono">${formatDate(v.time)}</div>
                                                  </div>
                                              `
                                          })}
                                      </div>
                                  </div>
                              `
                            : ''}
                        ${this._stubSourceFallback !== null
                            ? html`<div class="px-4 py-2 border-b border-base-300 text-xs text-base-content/50">
                                  Keine Versionierung verfügbar
                              </div>`
                            : ''}

                        <div class="flex-1 overflow-hidden">
                            ${this._selectedVersion !== null && this._selectedVersion?.source !== undefined
                                ? html`<fc-source-viewer class="block h-full" .value=${this._selectedVersion.source}></fc-source-viewer>`
                                : this._stubSourceFallback !== null
                                  ? html`<fc-source-viewer class="block h-full" .value=${this._stubSourceFallback}></fc-source-viewer>`
                                  : this._stubSourceError
                                    ? html`<div class="p-4 text-error text-sm">${this._stubSourceError}</div>`
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
                                    <h3 class="font-bold text-base leading-tight">Flow Graph</h3>
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

customElements.define('fc-overview', FcOverview)

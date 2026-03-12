import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'
import './fc-source-viewer.js'

function shortName(fqcn) {
    return fqcn.split('\\').pop()
}

function flowDisplayName(flowType) {
    return flowType.replace(/\.v\d+$/, '')
}

function stubSignature(stubs) {
    return stubs.map(s => `${s.source}:${s.messageEnum}`).join('|')
}

const ENUM_BADGE = { init: 'badge-info', stub: 'badge-success' }

export class FcOverview extends BaseElement {
    static properties = {
        _filter: { state: true },
        _flows: { state: true },
        _selectedStub: { state: true },
        _stubSource: { state: true },
        _stubSourceError: { state: true },
        _sortAsc: { state: true },
    }

    constructor() {
        super()
        this._filter = ''
        this._flows = []
        this._stubUsageMap = new Map()
        this._selectedStub = null
        this._stubSource = null
        this._stubSourceError = null
        this._sortAsc = true
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
            const stubs = schema.stubs.map(s => ({ source: s.source, messageEnum: s.messageEnum }))
            for (const s of stubs) {
                if (!stubUsage.has(s.source)) stubUsage.set(s.source, new Set())
                stubUsage.get(s.source).add(schema.type)
            }
            return { type: schema.type, stubs }
        })

        // Group by displayName — only merge if stubs are identical
        const byName = new Map()
        for (const entry of raw) {
            const name = flowDisplayName(entry.type)
            if (!byName.has(name)) byName.set(name, [])
            byName.get(name).push(entry)
        }

        const flows = []
        for (const [name, entries] of byName) {
            if (entries.length === 1) {
                flows.push({ label: name, stubs: entries[0].stubs })
            } else {
                // Check if all entries share the same stub signature
                const sigs = new Set(entries.map(e => stubSignature(e.stubs)))
                if (sigs.size === 1) {
                    // Identical stubs → one row without version
                    flows.push({ label: name, stubs: entries[0].stubs })
                } else {
                    // Different stubs → separate rows with full type
                    for (const e of entries) {
                        flows.push({ label: e.type, stubs: e.stubs })
                    }
                }
            }
        }

        this._flows = flows
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
        this._filter = shortName(stub.source)
        this._selectedStub = stub
    }

    async _openSourceModal() {
        this._stubSource = null
        this._stubSourceError = null
        try {
            const data = await api.getStubSource(this._selectedStub.source)
            this._stubSource = data.source ?? ''
            this.renderRoot.querySelector('#stub-source-modal')?.showModal()
        } catch (err) {
            if (err.message.includes('404')) {
                this._stubSourceError = `${this._selectedStub.source} ist nicht mehr verfügbar.`
            } else {
                this._stubSourceError = err.message
                this.renderRoot.querySelector('#stub-source-modal')?.showModal()
            }
        }
    }

    _closeSourceModal() {
        this.renderRoot.querySelector('#stub-source-modal')?.close()
    }

    _renderStubBadge(stub) {
        const name = shortName(stub.source)
        const css = ENUM_BADGE[stub.messageEnum] ?? 'badge-ghost'
        const usage = this._stubUsageMap.get(stub.source)
        const shared = usage && usage.size > 1

        return html`
            <button
                class="badge badge-sm ${css} ${shared ? 'badge-outline' : ''} cursor-pointer hover:brightness-125 transition-all"
                title="${shared ? `Shared by ${usage.size} flows` : stub.source}"
                @click=${e => this._onStubClick(e, stub)}
            >
                ${name}
            </button>
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
                    ${this._filter
                        ? html`
                              <button
                                  class="btn btn-sm btn-ghost"
                                  @click=${() => {
                                      this._filter = ''
                                      this._selectedStub = null
                                  }}
                              >
                                  clear
                              </button>
                              ${this._selectedStub
                                  ? html`
                                        <button
                                            class="btn btn-sm btn-outline btn-info"
                                            title=${this._selectedStub.source}
                                            @click=${() => this._openSourceModal()}
                                        >
                                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                                <path
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                                                />
                                            </svg>
                                            Source
                                        </button>
                                    `
                                  : ''}
                          `
                        : ''}
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

                <div class="overflow-x-auto border border-base-300 rounded-lg">
                    <table class="table table-sm">
                        <thead>
                            <tr>
                                <th class="w-1/3">flowType</th>
                                <th>Stubs</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filtered.length === 0
                                ? html`<tr>
                                      <td colspan="2" class="text-center text-base-content/40 py-8">No flows match the current filters.</td>
                                  </tr>`
                                : filtered.map(
                                      f => html`
                                          <tr class="hover:bg-base-200 transition-colors">
                                              <td class="font-mono text-xs">${f.label}</td>
                                              <td class="flex flex-wrap gap-1">${f.stubs.map(s => this._renderStubBadge(s))}</td>
                                          </tr>
                                      `
                                  )}
                        </tbody>
                    </table>
                </div>

                <div class="text-xs text-base-content/40 mt-2">${filtered.length} / ${this._flows.length} flows</div>

                <dialog id="stub-source-modal" class="modal">
                    <div class="modal-box w-[95vw] max-w-[95vw] h-[90vh] max-h-[90vh] p-0 flex flex-col overflow-hidden">
                        <div class="flex items-center justify-between px-4 py-3 border-b border-base-300">
                            <span class="font-mono text-sm truncate">${this._selectedStub?.source ?? ''}</span>
                            <button class="btn btn-sm btn-ghost" @click=${() => this._closeSourceModal()}>✕</button>
                        </div>
                        <div class="flex-1 overflow-hidden">
                            ${this._stubSource !== null
                                ? html`<fc-source-viewer class="block h-full" .value=${this._stubSource}></fc-source-viewer>`
                                : this._stubSourceError
                                  ? html`<div class="p-4 text-error text-sm">${this._stubSourceError}</div>`
                                  : html`<div class="p-4 text-base-content/40 text-sm">Loading...</div>`}
                        </div>
                    </div>
                    <form method="dialog" class="modal-backdrop backdrop-blur-sm">
                        <button>close</button>
                    </form>
                </dialog>
            </div>
        `
    }
}

customElements.define('fc-overview', FcOverview)

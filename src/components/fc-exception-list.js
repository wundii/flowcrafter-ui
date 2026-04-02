import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'

const PAGE_SIZE = 20
const LOAD_MORE_COOLDOWN = 500

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

export class FcExceptionList extends BaseElement {
    static properties = {
        _dateFrom: { state: true },
        _dateTo: { state: true },
        _hasMore: { state: true },
        _items: { state: true },
        _loadingMore: { state: true },
        _offset: { state: true },
        _total: { state: true },
        error: { state: true },
        expanded: { state: true },
        loading: { state: true },
    }

    constructor() {
        super()
        this._dateFrom = ''
        this._dateTo = ''
        this._hasMore = false
        this._items = []
        this._lastLoadMore = 0
        this._loadingMore = false
        this._observer = null
        this._offset = 0
        this._total = null
        this.error = null
        this.expanded = new Set()
        this.loading = true
    }

    connectedCallback() {
        super.connectedCallback()
        this._load()
    }

    disconnectedCallback() {
        super.disconnectedCallback()
        this._observer?.disconnect()
        this._observer = null
    }

    updated() {
        this._setupObserver()
    }

    _setupObserver() {
        const sentinel = this.querySelector('#exception-scroll-sentinel')
        if (!sentinel) {
            this._observer?.disconnect()
            this._observer = null
            return
        }
        if (this._observedSentinel === sentinel) return
        this._observer?.disconnect()
        this._observer = new IntersectionObserver(
            entries => {
                if (entries[0].isIntersecting && this._hasMore && !this._loadingMore) {
                    this._loadMore()
                }
            },
            { rootMargin: '200px' }
        )
        this._observer.observe(sentinel)
        this._observedSentinel = sentinel
    }

    _buildDateOpts(opts) {
        if (this._dateFrom) {
            const d = new Date(this._dateFrom + 'T00:00:00')
            opts.from =
                d.getFullYear() +
                '-' +
                String(d.getMonth() + 1).padStart(2, '0') +
                '-' +
                String(d.getDate()).padStart(2, '0') +
                'T00:00:00.000' +
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
                'T23:59:59.999' +
                formatTzOffset(d)
        }
    }

    async _load() {
        this.loading = true
        this.error = null
        this._items = []
        this._offset = 0
        try {
            const opts = { sort: 'desc', top: PAGE_SIZE, skip: 0 }
            this._buildDateOpts(opts)
            const res = await api.getExceptions(opts)
            this._items = res.items ?? []
            this._offset = this._items.length
            this._hasMore = res.hasMore ?? false
            this._total = res.total ?? null
        } catch (err) {
            this.error = err.message
        } finally {
            this.loading = false
            this.dispatchEvent(new CustomEvent('list-refreshed', { bubbles: true, composed: true }))
        }
    }

    async _loadMore() {
        if (!this._hasMore || this._loadingMore) return
        if (Date.now() - this._lastLoadMore < LOAD_MORE_COOLDOWN) return
        this._loadingMore = true
        try {
            const opts = { sort: 'desc', top: PAGE_SIZE, skip: this._offset }
            this._buildDateOpts(opts)
            const res = await api.getExceptions(opts)
            const newItems = res.items ?? []
            this._items = [...this._items, ...newItems]
            this._offset += newItems.length
            this._hasMore = res.hasMore ?? false
            this._total = res.total ?? null
        } catch (err) {
            this.error = err.message
        } finally {
            this._lastLoadMore = Date.now()
            this._loadingMore = false
        }
    }

    _toggleRow(id) {
        const next = new Set(this.expanded)
        next.has(id) ? next.delete(id) : next.add(id)
        this.expanded = next
    }

    _navigateToFlow(hash) {
        this.dispatchEvent(
            new CustomEvent('flow-selected', {
                detail: { hash },
                bubbles: true,
                composed: true,
            })
        )
    }

    _applyDateFilter() {
        this._load()
    }

    _clearDateFilter() {
        this._dateFrom = ''
        this._dateTo = ''
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

        if (this._items.length === 0 && !this._dateFrom && !this._dateTo)
            return html` <div class="alert alert-success"><span>Keine Exceptions gefunden.</span></div> `

        const isEmpty = this._items.length === 0

        return html`
            <!-- Toolbar -->
            <div class="flex flex-col lg:flex-row lg:items-center gap-2 mb-4">
                <!-- Links: Datumsfilter -->
                <div class="flex items-center flex-nowrap">
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

                <!-- Rechts: Datenanzeige + Reload -->
                <div class="flex items-center gap-3 flex-shrink-0 ml-auto">
                    ${isEmpty
                        ? ''
                        : html`<span class="text-sm text-base-content/60">
                              ${this._items.length}
                              ${this._total !== null ? html`<span class="text-base-content/40">von ${this._total}</span>` : ''}
                          </span>`}
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

            ${isEmpty
                ? html`<div class="alert alert-success"><span>Keine Exceptions für den gewählten Zeitraum gefunden.</span></div>`
                : html`
                      <!-- Exception cards -->
                      <div class="flex flex-col gap-2">
                          ${this._items.map((ex, idx) => {
                              const id = ex.id ?? idx
                              const open = this.expanded.has(id)
                              const hasTrace = !!ex.traceString

                              return html`
                                  <div class="rounded-box border border-error/25 bg-base-200 overflow-hidden">
                                      <div class="px-4 py-3 flex flex-col gap-1.5">
                                          <!-- Row 1: Stub + Time -->
                                          <div class="flex items-center justify-between gap-2">
                                              <span class="font-semibold text-sm text-base-content truncate" title="${ex.stubSource}">
                                                  ${shortClass(ex.stubSource)}
                                              </span>
                                              <span class="text-xs text-base-content/50 flex-shrink-0">${formatDate(ex.time)}</span>
                                          </div>
                                          <!-- Row 2: Error message -->
                                          <div class="text-sm text-error leading-snug break-words">${ex.message}</div>
                                          <!-- Row 3: File + FlowHash + Trace toggle -->
                                          <div class="flex items-center justify-between gap-2">
                                              <div class="flex items-baseline gap-3 min-w-0 text-xs text-base-content/50">
                                                  ${ex.file
                                                      ? html`
                                                            <span class="font-mono truncate" style="font-size:11px;" title="${ex.file}">
                                                                ${ex.file.split('/').slice(-2).join('/')}:${ex.line}
                                                            </span>
                                                        `
                                                      : ''}
                                                  <button
                                                      class="font-mono text-primary/70 hover:text-primary flex-shrink-0"
                                                      style="font-size:11px;"
                                                      title="Flow ${ex.flowHash} öffnen"
                                                      @click=${e => {
                                                          e.stopPropagation()
                                                          this._navigateToFlow(ex.flowHash)
                                                      }}
                                                  >
                                                      ⤢ ${ex.flowHash}
                                                  </button>
                                              </div>
                                              ${hasTrace
                                                  ? html`
                                                        <button
                                                            class="btn btn-xs btn-ghost text-base-content/40 flex-shrink-0"
                                                            @click=${() => this._toggleRow(id)}
                                                        >
                                                            ${open ? '▲ Trace' : '▼ Trace'}
                                                        </button>
                                                    `
                                                  : ''}
                                          </div>
                                      </div>

                                      ${open && hasTrace
                                          ? html`
                                                <div class="border-t border-base-300 px-4 py-3 bg-base-300/50">
                                                    <pre
                                                        class="text-xs font-mono text-base-content/60 whitespace-pre-wrap overflow-auto max-h-64 leading-relaxed"
                                                    >
${ex.traceString}</pre
                                                    >
                                                </div>
                                            `
                                          : ''}
                                  </div>
                              `
                          })}
                      </div>

                      ${this._loadingMore
                          ? html`<div class="flex justify-center py-4">
                                <span class="loading loading-spinner loading-md"></span>
                            </div>`
                          : ''}
                      <div id="exception-scroll-sentinel" style="height:1px"></div>
                  `}
        `
    }
}

customElements.define('fc-exception-list', FcExceptionList)

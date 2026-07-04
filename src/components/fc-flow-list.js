import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'
import { renderApiError } from '../utils/error.js'
import { skeletonFlowList } from '../utils/skeleton.js'
import { timeEl } from '../utils/time.js'
import './fc-empty-state.js'
import './fc-tooltip.js'

const PAGE_SIZE = 20
const LOAD_MORE_COOLDOWN = 500
const CANCEL_AFTER_MS = 5000

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

export class FcFlowList extends BaseElement {
    static properties = {
        _dateFrom: { state: true },
        _dateTo: { state: true },
        _hasMore: { state: true },
        _items: { state: true },
        _loadingMore: { state: true },
        _loadMoreCancelable: { state: true },
        _loadMorePaused: { state: true },
        _offset: { state: true },
        _statusFilter: { state: true },
        _total: { state: true },
        cachedState: { type: Object },
        dateFrom: { type: String },
        dateTo: { type: String },
        error: { state: true },
        loading: { state: true },
        type: { type: String },
    }

    constructor() {
        super()
        this._dateFrom = ''
        this._dateTo = ''
        this._cancelableTimer = null
        this._hasMore = false
        this._items = []
        this._filteredCountAtLastStop = 0
        this._lastLoadMore = 0
        this._loadingMore = false
        this._loadMoreAbort = null
        this._loadMoreCancelable = false
        this._loadMorePaused = false
        this._loadStreakStart = 0
        this._observer = null
        this._offset = 0
        this._restored = false
        this._statusFilter = 'all'
        this._total = null
        this.cachedState = null
        this.dateFrom = null
        this.dateTo = null
        this.error = null
        this.loading = true
        this.type = null
    }

    connectedCallback() {
        super.connectedCallback()
        if (this.cachedState?.items?.length) {
            this._dateFrom = this.cachedState.dateFrom ?? ''
            this._dateTo = this.cachedState.dateTo ?? ''
            this._hasMore = this.cachedState.hasMore
            this._items = this.cachedState.items
            this._offset = this.cachedState.offset
            this._restored = true
            this._statusFilter = this.cachedState.statusFilter ?? 'all'
            this._total = this.cachedState.total
            this.loading = false
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback()
        this._observer?.disconnect()
        this._observer = null
        this._loadMoreAbort?.abort()
        this._endLoadStreak()
    }

    get _filteredItems() {
        const byLastRun = [...this._items].sort((a, b) => {
            const ta = a.lastTerm || a.flowTime || ''
            const tb = b.lastTerm || b.flowTime || ''
            return tb.localeCompare(ta)
        })
        return this._statusFilter === 'all'
            ? byLastRun
            : this._statusFilter === 'ok'
              ? byLastRun.filter(f => f.status === 'OK')
              : byLastRun.filter(
                    f =>
                        f.status === 'FAILED' || f.status === 'WARNING' || f.status === 'IN_PROGRESS' || f.status === 'IN_PROGRESS_EXCEEDED'
                )
    }

    updated(changed) {
        let shouldLoad = false
        if (changed.has('dateFrom') || changed.has('dateTo')) {
            this._dateFrom = this.dateFrom ?? ''
            this._dateTo = this.dateTo ?? ''
            shouldLoad = true
        }
        if (changed.has('type')) {
            if (changed.get('type') !== undefined) {
                this._items = []
                this._offset = 0
            }
            if (!this._restored) {
                shouldLoad = true
            }
        }
        if (shouldLoad) this._load()
        if (this._restored) {
            this._restored = false
            this.dispatchEvent(new CustomEvent('list-refreshed', { bubbles: true, composed: true }))
            requestAnimationFrame(() => {
                window.scrollTo(0, this.cachedState?.scrollY ?? 0)
            })
        }
        this._setupObserver()
        if (!this.loading && !this._loadingMore && !this._loadMorePaused && this._hasMore && this._statusFilter !== 'all') {
            const newFiltered = this._filteredItems.length - this._filteredCountAtLastStop
            if (newFiltered < PAGE_SIZE) {
                setTimeout(() => this._loadMore(), LOAD_MORE_COOLDOWN + 100)
            }
        }
    }

    _setupObserver() {
        const sentinel = this.querySelector('#flow-scroll-sentinel')
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
                    if (this._statusFilter !== 'all') {
                        this._filteredCountAtLastStop = this._filteredItems.length
                    }
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
        this._filteredCountAtLastStop = 0
        this._items = []
        this._offset = 0
        this._loadMoreAbort?.abort()
        this._loadMorePaused = false
        this._endLoadStreak()
        try {
            const opts = { type: this.type ?? undefined, top: PAGE_SIZE, skip: 0 }
            this._buildDateOpts(opts)
            const res = await api.getFlows(opts)
            this._items = res.items ?? []
            this._offset = this._items.length
            this._hasMore = res.hasMore ?? false
            this._total = res.total ?? null
        } catch (err) {
            this.error = err
        } finally {
            this.loading = false
            this.dispatchEvent(new CustomEvent('list-refreshed', { bubbles: true, composed: true }))
        }
    }

    async _loadMore() {
        if (!this._hasMore || this._loadingMore || this._loadMorePaused) return
        if (Date.now() - this._lastLoadMore < LOAD_MORE_COOLDOWN) return
        this._loadingMore = true
        this._startLoadStreak()
        this._loadMoreAbort = new AbortController()
        try {
            const opts = { type: this.type ?? undefined, top: PAGE_SIZE, skip: this._offset }
            this._buildDateOpts(opts)
            const res = await api.getFlows(opts, this._loadMoreAbort.signal)
            const newItems = res.items ?? []
            this._items = [...this._items, ...newItems]
            this._offset += newItems.length
            this._hasMore = res.hasMore ?? false
            this._total = res.total ?? null
        } catch (err) {
            if (err.name !== 'AbortError') this.error = err
        } finally {
            this._lastLoadMore = Date.now()
            this._loadingMore = false
            this._loadMoreAbort = null
            if (!this._hasMore || this._loadMorePaused || this.error) this._endLoadStreak()
            if (!this._loadMorePaused) this._checkSentinelVisible()
        }
    }

    // Eine "Lade-Serie" umfasst auch die automatisch verketteten Nachlade-Requests;
    // dauert sie länger als CANCEL_AFTER_MS, wird der Abbrechen-Button eingeblendet
    _startLoadStreak() {
        if (this._loadStreakStart !== 0 && Date.now() - this._lastLoadMore <= 2000) return
        this._loadStreakStart = Date.now()
        this._loadMoreCancelable = false
        clearTimeout(this._cancelableTimer)
        this._cancelableTimer = setTimeout(() => {
            this._loadMoreCancelable = true
        }, CANCEL_AFTER_MS)
    }

    _endLoadStreak() {
        clearTimeout(this._cancelableTimer)
        this._cancelableTimer = null
        this._loadStreakStart = 0
        this._loadMoreCancelable = false
    }

    _cancelLoadMore() {
        this._loadMorePaused = true
        this._loadMoreAbort?.abort()
        this._endLoadStreak()
    }

    _resumeLoadMore() {
        this._loadMorePaused = false
        this._lastLoadMore = 0
        this._loadMore()
    }

    _checkSentinelVisible() {
        if (!this._hasMore) return
        const sentinel = this.querySelector('#flow-scroll-sentinel')
        if (!sentinel) return
        const rect = sentinel.getBoundingClientRect()
        if (rect.top < window.innerHeight + 200) {
            if (this._statusFilter !== 'all') {
                this._filteredCountAtLastStop = this._filteredItems.length
            }
            setTimeout(() => this._loadMore(), LOAD_MORE_COOLDOWN)
        }
    }

    _emitStateCache() {
        this.dispatchEvent(
            new CustomEvent('list-state-changed', {
                detail: {
                    items: this._items,
                    offset: this._offset,
                    hasMore: this._hasMore,
                    total: this._total,
                    scrollY: window.scrollY,
                    dateFrom: this._dateFrom,
                    dateTo: this._dateTo,
                    statusFilter: this._statusFilter,
                },
                bubbles: true,
                composed: true,
            })
        )
    }

    _onSelect(flow) {
        this._emitStateCache()
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

    _applyDateFilter() {
        this._load()
    }

    _renderLoadMoreSpinner(padClass) {
        return html`
            <div class="flex flex-col items-center gap-2 ${padClass}">
                <span class="loading loading-spinner loading-md"></span>
                ${
                    this._loadMoreCancelable
                        ? html`
                              <button class="btn btn-xs btn-ghost text-base-content/50 hover:text-error" @click=${this._cancelLoadMore}>
                                  Laden abbrechen
                              </button>
                          `
                        : ''
                }
            </div>
        `
    }

    _renderLoadMoreResume(padClass) {
        return html`
            <div class="flex flex-col items-center gap-2 ${padClass}">
                <span class="text-xs text-base-content/50">Laden abgebrochen</span>
                <button
                    class="btn btn-sm btn-ghost border border-base-content/30 hover:border-base-content/50"
                    @click=${this._resumeLoadMore}
                >
                    Weiter laden
                </button>
            </div>
        `
    }

    _clearDateFilter() {
        this._dateFrom = ''
        this._dateTo = ''
        this._load()
    }

    render() {
        if (this.loading) return skeletonFlowList()

        if (this.error) return renderApiError(this.error, { compact: true, retry: this._load })

        const noData = this._items.length === 0 && !this._dateFrom && !this._dateTo
        const filtered = this._filteredItems
        const isEmpty = noData || filtered.length === 0

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
                        ${
                            isEmpty
                                ? ''
                                : html`<span class="text-sm text-base-content/60">
                                      ${
                                          this._statusFilter !== 'all'
                                              ? html`${filtered.length}<span class="text-base-content/40">/${this._items.length}</span>`
                                              : this._items.length
                                      }
                                      ${this._total !== null ? html`<span class="text-base-content/40">von ${this._total}</span>` : ''}
                                  </span>`
                        }
                        <fc-tooltip
                            text="Neu laden"
                            .content=${html`
                                <button
                                    class="btn btn-sm btn-ghost btn-circle border border-base-content/30 hover:border-base-content/50"
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

                <!-- Mitte: Statusfilter + Datumsfilter -->
                <div class="flex items-center lg:justify-center lg:flex-1 flex-nowrap gap-2">
                    <div class="flex items-center gap-1">
                        <button
                            class="btn btn-xs btn-ghost ${
                                this._statusFilter === 'all'
                                    ? 'btn-active border border-base-content/30'
                                    : 'text-base-content/40 hover:text-base-content'
                            }"
                            @click=${() => {
                                this._statusFilter = 'all'
                            }}
                        >
                            Alle
                        </button>
                        <button
                            class="btn btn-xs btn-ghost ${
                                this._statusFilter === 'ok'
                                    ? 'btn-active border border-success/40 text-success'
                                    : 'text-base-content/40 hover:text-success'
                            }"
                            @click=${() => {
                                this._statusFilter = 'ok'
                            }}
                        >
                            OK
                        </button>
                        <button
                            class="btn btn-xs btn-ghost ${
                                this._statusFilter === 'failed'
                                    ? 'btn-active border border-error/40 text-error'
                                    : 'text-base-content/40 hover:text-error'
                            }"
                            @click=${() => {
                                this._statusFilter = 'failed'
                            }}
                        >
                            Failed
                        </button>
                    </div>
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
                    ${
                        this._dateFrom || this._dateTo
                            ? html`
                                  <button
                                      class="btn btn-sm btn-ghost text-base-content/50 hover:text-base-content ml-1"
                                      @click=${this._clearDateFilter}
                                  >
                                      ✕
                                  </button>
                              `
                            : ''
                    }
                </div>

                <!-- Rechts: Datenanzeige + Reload (nur desktop) -->
                <div class="hidden lg:flex items-center gap-3 flex-shrink-0">
                    ${
                        isEmpty
                            ? ''
                            : html`<span class="text-sm text-base-content/60">
                                  ${
                                      this._statusFilter !== 'all'
                                          ? html`${filtered.length}<span class="text-base-content/40">/${this._items.length}</span>`
                                          : this._items.length
                                  }
                                  ${this._total !== null ? html`<span class="text-base-content/40">von ${this._total}</span>` : ''}
                              </span>`
                    }
                    <fc-tooltip
                        text="Neu laden"
                        .content=${html`
                            <button
                                class="btn btn-sm btn-ghost btn-circle border border-base-content/30 hover:border-base-content/50"
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

            ${
                isEmpty
                    ? this._hasMore
                        ? this._loadMorePaused
                            ? this._renderLoadMoreResume('py-8')
                            : this._renderLoadMoreSpinner('py-8')
                        : html`<fc-empty-state
                              message=${noData ? 'Keine Flows gefunden.' : 'Keine Flows für den gewählten Zeitraum gefunden.'}
                          ></fc-empty-state>`
                    : html`
                          <!-- Flow cards -->
                          <div class="flex flex-col gap-2">
                              ${filtered.map(flow => {
                                  const hasFailed = flow.status === 'FAILED' || flow.status === 'WARNING'
                                  return html`
                                      <div
                                          class="rounded-box border bg-base-200 overflow-hidden cursor-pointer
                     hover:border-base-content/20 transition-colors
                     ${hasFailed ? 'border-error/25' : 'border-base-300'}"
                                          @click=${() => this._onSelect(flow)}
                                      >
                                          <div class="px-4 py-3 flex flex-col gap-1.5">
                                              <!-- Row 1: Source + Status + Dates -->
                                              <div class="flex items-start justify-between gap-2">
                                                  <div class="flex items-center gap-2 min-w-0">
                                                      ${
                                                          {
                                                              FAILED: html`<span class="badge badge-error badge-sm leading-none"
                                                                  >Failed</span
                                                              >`,
                                                              WARNING: html`<span class="badge badge-warning badge-sm leading-none"
                                                                  >Warning</span
                                                              >`,
                                                              IN_PROGRESS: html`<span class="badge badge-info badge-sm leading-none"
                                                                  >Running</span
                                                              >`,
                                                              IN_PROGRESS_EXCEEDED: html`<span
                                                                  class="badge badge-warning badge-sm leading-none"
                                                                  >Exceeded</span
                                                              >`,
                                                              OK: html`<span class="badge badge-success badge-sm leading-none">OK</span>`,
                                                          }[flow.status] ??
                                                          html`<span class="badge badge-neutral badge-sm leading-none"
                                                              >${flow.status}</span
                                                          >`
                                                      }
                                                      <span class="font-semibold text-sm text-base-content truncate">
                                                          ${shortClass(flow.flowSource)}
                                                      </span>
                                                  </div>
                                                  <div class="flex flex-col items-end gap-0.5 flex-shrink-0">
                                                      ${
                                                          flow.lastTerm
                                                              ? html`<span class="text-xs text-base-content/50"
                                                                    >Letzter Lauf: ${timeEl(flow.lastTerm)}</span
                                                                >`
                                                              : ''
                                                      }
                                                      <span class="text-xs text-base-content/50">Erstellt: ${timeEl(flow.flowTime)}</span>
                                                  </div>
                                              </div>
                                              <!-- Row 2: Hash -->
                                              <div class="font-mono text-xs text-base-content/40 truncate">${flow.flowHash}</div>
                                              <!-- Row 3: Subject + Type -->
                                              <div class="flex items-baseline justify-between gap-2">
                                                  <span class="text-sm text-base-content/50 truncate"> ${flow.flowSubject || ''} </span>
                                                  <span class="badge badge-outline badge-xs text-base-content/50 flex-shrink-0"
                                                      >${flow.flowType}</span
                                                  >
                                              </div>
                                          </div>
                                      </div>
                                  `
                              })}
                          </div>

                          ${
                              this._loadingMore
                                  ? this._renderLoadMoreSpinner('py-4')
                                  : this._loadMorePaused && this._hasMore
                                    ? this._renderLoadMoreResume('py-4')
                                    : ''
                          }
                          <div id="flow-scroll-sentinel" style="height:1px"></div>
                      `
            }
        `
    }
}

customElements.define('fc-flow-list', FcFlowList)

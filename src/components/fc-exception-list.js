import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'

const PAGE_SIZE = 10

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
        exceptions: { state: true },
        loading: { state: true },
        error: { state: true },
        expanded: { state: true },
        _page: { state: true },
        _hasMore: { state: true },
        _total: { state: true },
        _dateFrom: { state: true },
        _dateTo: { state: true },
    }

    constructor() {
        super()
        this.exceptions = []
        this.loading = true
        this.error = null
        this.expanded = new Set()
        this._page = 0
        this._hasMore = false
        this._total = null
        this._dateFrom = ''
        this._dateTo = ''
    }

    connectedCallback() {
        super.connectedCallback()
        this._load()
    }

    async _load() {
        this.loading = true
        this.error = null
        try {
            const opts = { sort: 'desc', top: PAGE_SIZE, skip: this._page * PAGE_SIZE }
            if (this._dateFrom) {
                const d = new Date(this._dateFrom + 'T00:00:00')
                opts.from =
                    d.getFullYear() +
                    '-' +
                    String(d.getMonth() + 1).padStart(2, '0') +
                    '-' +
                    String(d.getDate()).padStart(2, '0') +
                    'T00:00:00' +
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
                    'T23:59:59' +
                    formatTzOffset(d)
            }
            const res = await api.getExceptions(opts)
            this.exceptions = res.items ?? []
            this._hasMore = res.hasMore ?? false
            this._total = res.total ?? null
        } catch (err) {
            this.error = err.message
        } finally {
            this.loading = false
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

    _onPrev() {
        this._page = Math.max(0, this._page - 1)
        this._load()
    }

    _onNext() {
        this._page += 1
        this._load()
    }

    _applyDateFilter() {
        this._page = 0
        this._load()
    }

    _clearDateFilter() {
        this._dateFrom = ''
        this._dateTo = ''
        this._page = 0
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

        if (this.exceptions.length === 0 && this._page === 0)
            return html` <div class="alert alert-success"><span>Keine Exceptions gefunden.</span></div> `

        const from = this._page * PAGE_SIZE + 1
        const to = this._page * PAGE_SIZE + this.exceptions.length

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
                    <span class="text-sm text-base-content/60">
                        ${from}–${to} ${this._total !== null ? html`<span class="text-base-content/40">von ${this._total}</span>` : ''}
                        Exceptions
                    </span>
                    <button class="btn btn-sm btn-ghost" @click=${this._load}>↻ Reload</button>
                </div>
            </div>

            <!-- Exception cards -->
            <div class="flex flex-col gap-2">
                ${this.exceptions.map((ex, idx) => {
                    const id = ex.id ?? idx
                    const open = this.expanded.has(id)
                    const hasTrace = !!ex.traceString

                    return html`
                        <div class="rounded-box border border-error/25 bg-base-200 overflow-hidden">
                            <div class="grid grid-cols-[1fr_auto] gap-2 px-4 py-3">
                                <div class="min-w-0">
                                    <div class="font-semibold text-sm text-base-content leading-tight mb-0.5" title="${ex.stubSource}">
                                        ${shortClass(ex.stubSource)}
                                    </div>
                                    <div class="text-sm text-error leading-snug break-words mb-2">${ex.message}</div>
                                    <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-base-content/50">
                                        ${ex.file
                                            ? html`
                                                  <span title="${ex.file}">
                                                      <span class="font-mono" style="font-size:11px;">
                                                          ${ex.file.split('/').slice(-2).join('/')}:${ex.line}
                                                      </span>
                                                  </span>
                                              `
                                            : ''}
                                        <span>${formatDate(ex.time)}</span>
                                    </div>
                                </div>

                                <div class="flex flex-col items-end justify-between gap-2 flex-shrink-0">
                                    <button
                                        class="btn btn-xs btn-ghost font-mono text-primary/70 hover:text-primary"
                                        title="Flow ${ex.flowHash} öffnen"
                                        @click=${() => this._navigateToFlow(ex.flowHash)}
                                    >
                                        ⤢ ${ex.flowHash.slice(0, 10)}…
                                    </button>
                                    ${hasTrace
                                        ? html`
                                              <button class="btn btn-xs btn-ghost text-base-content/40" @click=${() => this._toggleRow(id)}>
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

customElements.define('fc-exception-list', FcExceptionList)

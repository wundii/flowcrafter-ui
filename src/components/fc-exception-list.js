import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'
import { renderApiError } from '../utils/error.js'
import { skeletonExceptionList } from '../utils/skeleton.js'
import { timeEl } from '../utils/time.js'
import './fc-empty-state.js'
import './fc-tooltip.js'

const PAGE_SIZE = 20
const LOAD_MORE_COOLDOWN = 500
const GROUP_WINDOW_MS = 15 * 60 * 1000

const STATUS_OPTIONS = [
    { value: 'FAILED', label: 'Failed' },
    { value: 'NOT_FAILED', label: 'Verarbeitet' },
]

const TYPE_OPTIONS = [
    { value: 'ALL', label: 'Alle Typen' },
    { value: 'flow', label: 'Flow' },
    { value: 'schedule', label: 'Schedule' },
    { value: 'observer', label: 'Observer' },
]

const STATUS_COLORS = {
    FAILED: 'badge-error',
    WARNING: 'badge-warning',
    OK: 'badge-success',
    IN_PROGRESS: 'badge-info',
    IN_PROGRESS_EXCEEDED: 'badge-warning',
}

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

function buildFingerprint(ex) {
    const fileLine = `${ex.file ?? ''}:${ex.line ?? ''}`
    switch (ex.type) {
        case 'flow':
            return `flow|${ex.message}|${ex.stepSource ?? ''}|${fileLine}`
        case 'schedule':
            return `schedule|${ex.message}|${ex.scheduleName ?? ''}|${ex.scheduleExpression ?? ''}`
        case 'observer':
            return `observer|${ex.message}|${ex.observerFlowSource ?? ''}|${ex.observerMessageSource ?? ''}`
        default:
            return `${ex.type}|${ex.message}`
    }
}

export class FcExceptionList extends BaseElement {
    static properties = {
        _dateFrom: { state: true },
        _dateTo: { state: true },
        _expandedGroups: { state: true },
        _hasMore: { state: true },
        _items: { state: true },
        _loadingMore: { state: true },
        _offset: { state: true },
        _statusFilter: { state: true },
        _total: { state: true },
        _typeFilter: { state: true },
        dateFrom: { type: String },
        dateTo: { type: String },
        error: { state: true },
        expanded: { state: true },
        loading: { state: true },
    }

    constructor() {
        super()
        this._dateFrom = ''
        this._dateTo = ''
        this._expandedGroups = new Set()
        this._statusFilter = 'FAILED'
        this._typeFilter = 'ALL'
        this.dateFrom = null
        this.dateTo = null
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
    }

    disconnectedCallback() {
        super.disconnectedCallback()
        this._observer?.disconnect()
        this._observer = null
    }

    updated(changed) {
        if (changed.has('dateFrom') || changed.has('dateTo')) {
            this._dateFrom = this.dateFrom ?? ''
            this._dateTo = this.dateTo ?? ''
            this._load()
        }
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
            const isNotFailed = this._statusFilter === 'NOT_FAILED'
            const dateOpts = {}
            this._buildDateOpts(dateOpts)
            const res = await api.getExceptions({
                sort: 'desc',
                top: PAGE_SIZE,
                skip: 0,
                status: isNotFailed ? undefined : this._statusFilter || undefined,
                ...dateOpts,
            })
            let items = res.items ?? []
            if (isNotFailed) {
                items = items.filter(i => !(i.type === 'flow' && i.flowStatus === 'FAILED'))
                items = items.filter(i => i.type !== 'schedule')
                items = items.filter(i => i.type !== 'observer')
            }
            this._offset = (res.items ?? []).length
            this._hasMore = res.hasMore ?? false
            this._total = isNotFailed ? items.length : (res.total ?? null)
            this._items = items
        } catch (err) {
            this.error = err
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
            const isNotFailed = this._statusFilter === 'NOT_FAILED'
            const dateOpts = {}
            this._buildDateOpts(dateOpts)
            const res = await api.getExceptions({
                sort: 'desc',
                top: PAGE_SIZE,
                skip: this._offset,
                status: isNotFailed ? undefined : this._statusFilter || undefined,
                ...dateOpts,
            })
            let newItems = res.items ?? []
            if (isNotFailed) {
                newItems = newItems.filter(i => !(i.type === 'flow' && i.flowStatus === 'FAILED'))
                newItems = newItems.filter(i => i.type !== 'schedule')
                newItems = newItems.filter(i => i.type !== 'observer')
            }
            this._offset += (res.items ?? []).length
            this._hasMore = res.hasMore ?? false
            this._total = isNotFailed ? this._items.length + newItems.length : (res.total ?? null)
            this._items = [...this._items, ...newItems]
        } catch (err) {
            this.error = err
        } finally {
            this._lastLoadMore = Date.now()
            this._loadingMore = false
        }
        await this.updateComplete
        if (this._hasMore && this._isSentinelVisible()) {
            setTimeout(() => this._loadMore(), LOAD_MORE_COOLDOWN)
        }
    }

    _isSentinelVisible() {
        const sentinel = this.querySelector('#exception-scroll-sentinel')
        if (!sentinel) return false
        const rect = sentinel.getBoundingClientRect()
        const viewportH = window.innerHeight || document.documentElement.clientHeight
        return rect.top <= viewportH + 200
    }

    _toggleRow(id) {
        const next = new Set(this.expanded)
        next.has(id) ? next.delete(id) : next.add(id)
        this.expanded = next
    }

    _toggleGroup(fp) {
        const next = new Set(this._expandedGroups)
        next.has(fp) ? next.delete(fp) : next.add(fp)
        this._expandedGroups = next
    }

    _buildDisplayItems() {
        let items = this._items
        if (this._typeFilter !== 'ALL') {
            items = items.filter(ex => ex.type === this._typeFilter)
        }

        const openGroups = new Map()
        const result = []
        let groupSeq = 0
        for (const ex of items) {
            const fp = buildFingerprint(ex)
            const exTime = new Date(ex.time).getTime()
            const open = openGroups.get(fp)
            if (open) {
                const gap = new Date(open._lastTime).getTime() - exTime
                if (gap <= GROUP_WINDOW_MS) {
                    open._count += 1
                    open._members.push(ex)
                    open._lastTime = ex.time
                    continue
                }
            }
            const group = {
                ...ex,
                _count: 1,
                _firstTime: ex.time,
                _lastTime: ex.time,
                _members: [ex],
                _fingerprint: `${fp}#${groupSeq++}`,
            }
            openGroups.set(fp, group)
            result.push(group)
        }
        return result
    }

    _renderItem(ex, idx) {
        if (ex.type === 'schedule') return this._renderScheduleItem(ex, idx)
        if (ex.type === 'observer') return this._renderObserverItem(ex, idx)
        return this._renderFlowItem(ex, idx)
    }

    _renderWithGroup(ex, idx) {
        const header = this._renderItem(ex, idx)
        if (!(ex._count > 1 && this._expandedGroups.has(ex._fingerprint))) return header
        return html`
            ${header}
            <div class="ml-4 flex flex-col gap-2 border-l-2 border-base-300 pl-3">
                ${ex._members.map((m, mi) => this._renderItem(m, `${idx}-${mi}`))}
            </div>
        `
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

    _renderRowAction(ex, id, hasTrace, open) {
        if (ex._count > 1) {
            const groupOpen = this._expandedGroups.has(ex._fingerprint)
            return html`
                <button class="btn btn-xs btn-ghost text-base-content/40 flex-shrink-0" @click=${() => this._toggleGroup(ex._fingerprint)}>
                    ${groupOpen ? '▲' : '▼'} Alle (${ex._count})
                </button>
            `
        }
        if (hasTrace) {
            return html`
                <button class="btn btn-xs btn-ghost text-base-content/40 flex-shrink-0" @click=${() => this._toggleRow(id)}>
                    ${open ? '▲ Trace' : '▼ Trace'}
                </button>
            `
        }
        return ''
    }

    _renderTimeDisplay(ex) {
        if (ex._count > 1) {
            return html`
                <div class="flex items-center gap-1.5 flex-shrink-0">
                    <span class="badge badge-xs badge-neutral">${ex._count}×</span>
                    <span class="text-xs text-base-content/50">${timeEl(ex._lastTime)} – ${timeEl(ex._firstTime)}</span>
                </div>
            `
        }
        return html`<span class="text-xs text-base-content/50 flex-shrink-0">${timeEl(ex.time)}</span>`
    }

    _renderFlowItem(ex, idx) {
        const id = ex.hash ?? idx
        const open = ex._count > 1 ? false : this.expanded.has(id)
        const hasTrace = !!ex.traceString
        return html`
            <div class="rounded-box border border-error/25 bg-base-200 overflow-hidden">
                <div class="px-4 py-3 flex flex-col gap-1.5">
                    <!-- Row 1: Step + Status + Time -->
                    <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2 min-w-0">
                            <span class="font-semibold text-sm text-base-content truncate" title="${ex.stepSource}">
                                ${shortClass(ex.stepSource)}
                            </span>
                            ${ex.flowStatus
                                ? html`<span class="badge badge-xs ${STATUS_COLORS[ex.flowStatus] ?? 'badge-ghost'}"
                                      >${ex.flowStatus}</span
                                  >`
                                : ''}
                        </div>
                        ${this._renderTimeDisplay(ex)}
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
                            <fc-tooltip
                                text="Flow ${ex.flowHash} öffnen"
                                .content=${html`
                                    <button
                                        class="font-mono text-primary/70 hover:text-primary flex-shrink-0"
                                        style="font-size:11px;"
                                        @click=${e => {
                                            e.stopPropagation()
                                            this._navigateToFlow(ex.flowHash)
                                        }}
                                    >
                                        ⤢ ${ex.flowHash}
                                    </button>
                                `}
                            ></fc-tooltip>
                        </div>
                        ${this._renderRowAction(ex, id, hasTrace, open)}
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
    }

    _renderObserverItem(ex, idx) {
        const id = ex.hash ?? 'o' + idx
        const open = ex._count > 1 ? false : this.expanded.has(id)
        const hasTrace = !!ex.traceString
        return html`
            <div class="rounded-box border border-info/25 bg-base-200 overflow-hidden">
                <div class="px-4 py-3 flex flex-col gap-1.5">
                    <!-- Row 1: FlowSource + Badge + Time -->
                    <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2 min-w-0">
                            <span class="font-semibold text-sm text-base-content truncate" title="${ex.observerFlowSource}">
                                ${shortClass(ex.observerFlowSource)}
                            </span>
                            <span class="badge badge-xs badge-info flex-shrink-0">Observer</span>
                        </div>
                        ${this._renderTimeDisplay(ex)}
                    </div>
                    <!-- Row 2: Error message -->
                    <div class="text-sm text-error leading-snug break-words">${ex.message}</div>
                    <!-- Row 3: MessageSource + File + Trace toggle -->
                    <div class="flex items-center justify-between gap-2">
                        <div class="flex items-baseline gap-3 min-w-0 text-xs text-base-content/50">
                            <span class="font-mono flex-shrink-0" style="font-size:11px;" title="${ex.observerMessageSource}">
                                ${shortClass(ex.observerMessageSource)}
                            </span>
                            ${ex.file
                                ? html`
                                      <span class="font-mono truncate" style="font-size:11px;" title="${ex.file}">
                                          ${ex.file.split('/').slice(-2).join('/')}:${ex.line}
                                      </span>
                                  `
                                : ''}
                        </div>
                        ${this._renderRowAction(ex, id, hasTrace, open)}
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
    }

    _renderScheduleItem(ex, idx) {
        const id = ex.hash ?? 's' + idx
        const open = ex._count > 1 ? false : this.expanded.has(id)
        const hasTrace = !!ex.traceString
        return html`
            <div class="rounded-box border border-warning/25 bg-base-200 overflow-hidden">
                <div class="px-4 py-3 flex flex-col gap-1.5">
                    <!-- Row 1: ScheduleName + Badge + Time -->
                    <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2 min-w-0">
                            <span class="font-semibold text-sm text-base-content truncate" title="${ex.scheduleName}">
                                ${shortClass(ex.scheduleName)}
                            </span>
                            <span class="badge badge-xs badge-warning flex-shrink-0">Schedule</span>
                        </div>
                        ${this._renderTimeDisplay(ex)}
                    </div>
                    <!-- Row 2: Error message -->
                    <div class="text-sm text-error leading-snug break-words">${ex.message}</div>
                    <!-- Row 3: CronExpression + File + Trace toggle -->
                    <div class="flex items-center justify-between gap-2">
                        <div class="flex items-baseline gap-3 min-w-0 text-xs text-base-content/50">
                            <span class="font-mono flex-shrink-0" style="font-size:11px;">${ex.scheduleExpression}</span>
                            ${ex.file
                                ? html`
                                      <span class="font-mono truncate" style="font-size:11px;" title="${ex.file}">
                                          ${ex.file.split('/').slice(-2).join('/')}:${ex.line}
                                      </span>
                                  `
                                : ''}
                        </div>
                        ${this._renderRowAction(ex, id, hasTrace, open)}
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
    }

    render() {
        if (this.loading) return skeletonExceptionList()

        if (this.error) return renderApiError(this.error, { compact: true, retry: this._load })

        const displayItems = this._buildDisplayItems()
        const isEmpty = displayItems.length === 0
        const groupCount = displayItems.length
        const loadedCount = displayItems.reduce((s, g) => s + (g._count || 1), 0)

        return html`
            <!-- Toolbar -->
            <div class="flex flex-wrap items-center gap-2 mb-4">
                <!-- Links: Status + Datumsfilter -->
                <div class="flex items-center flex-wrap gap-2">
                    <select
                        class="select select-sm select-bordered text-xs w-auto"
                        .value=${this._statusFilter}
                        @change=${e => {
                            this._statusFilter = e.target.value
                            this._load()
                        }}
                    >
                        ${STATUS_OPTIONS.map(
                            o => html`<option value=${o.value} ?selected=${this._statusFilter === o.value}>${o.label}</option>`
                        )}
                    </select>
                    <select
                        class="select select-sm select-bordered text-xs w-auto"
                        .value=${this._typeFilter}
                        @change=${e => {
                            this._typeFilter = e.target.value
                            this._expandedGroups = new Set()
                            this.expanded = new Set()
                        }}
                    >
                        ${TYPE_OPTIONS.map(
                            o => html`<option value=${o.value} ?selected=${this._typeFilter === o.value}>${o.label}</option>`
                        )}
                    </select>
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
                              ${groupCount} ${groupCount === 1 ? 'Gruppe' : 'Gruppen'}
                              <span class="text-base-content/40">· ${loadedCount} ${loadedCount === 1 ? 'Exception' : 'Exceptions'}</span>
                          </span>`}
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

            ${isEmpty
                ? html`<fc-empty-state
                      message=${this._dateFrom || this._dateTo
                          ? 'Keine Exceptions für den gewählten Zeitraum gefunden.'
                          : 'Keine Exceptions gefunden.'}
                  ></fc-empty-state>`
                : html`
                      <!-- Exception cards -->
                      <div class="flex flex-col gap-2">${displayItems.map((ex, idx) => this._renderWithGroup(ex, idx))}</div>

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

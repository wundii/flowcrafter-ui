import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'
import { renderApiError } from '../utils/error.js'
import { skeletonScheduleGrid } from '../utils/skeleton.js'
import './fc-source-viewer.js'
import './fc-tooltip.js'

function shortClass(fqn) {
    return fqn?.split('\\').pop() ?? fqn
}

function cronToHuman(expr) {
    const parts = expr.split(/\s+/)
    if (parts.length !== 5) return expr
    const [min, hour, dom, mon, dow] = parts

    const months = ['', 'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
    const days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
    const time = (h, m) => `${h.padStart(2, '0')}:${m.padStart(2, '0')}`

    if (min === '*' && hour === '*') return 'Jede Minute'
    if (min.startsWith('*/') && hour === '*') return `Alle ${min.slice(2)} Min.`
    if (hour.startsWith('*/') && min === '0') return `Alle ${hour.slice(2)} Std.`
    if (min !== '*' && hour !== '*' && dom === '*' && mon === '*' && dow === '*') return `Täglich ${time(hour, min)}`
    if (min !== '*' && hour !== '*' && dow !== '*' && dom === '*' && mon === '*') return `${days[parseInt(dow)] ?? dow} ${time(hour, min)}`
    if (min !== '*' && hour !== '*' && dom !== '*' && mon !== '*' && dow === '*')
        return `${dom}. ${months[parseInt(mon)] ?? mon} ${time(hour, min)}`
    if (min !== '*' && hour !== '*' && dom !== '*' && mon === '*' && dow === '*') return `Monatlich am ${dom}. ${time(hour, min)}`
    if (min !== '*' && hour !== '*' && dom === '*' && mon === '*' && dow.includes(','))
        return `${dow
            .split(',')
            .map(d => days[parseInt(d)] ?? d)
            .join(', ')} ${time(hour, min)}`
    if (min === '0' && hour === '0' && dom === '*' && mon === '*' && dow === '*') return 'Täglich 00:00'
    return expr
}

export class FcScheduleList extends BaseElement {
    static properties = {
        _activeGroup: { state: true },
        _error: { state: true },
        _filter: { state: true },
        _loading: { state: true },
        _runClassName: { state: true },
        _runError: { state: true },
        _runName: { state: true },
        _runSuccess: { state: true },
        _running: { state: true },
        _schedules: { state: true },
        _selectedSource: { state: true },
        _sourceError: { state: true },
        _sourceLoading: { state: true },
    }

    constructor() {
        super()
        this._activeGroup = null
        this._error = null
        this._filter = ''
        this._loading = true
        this._runClassName = null
        this._runError = null
        this._runName = null
        this._runSuccess = false
        this._running = false
        this._schedules = []
        this._selectedSource = null
        this._sourceError = null
        this._sourceLoading = false
    }

    connectedCallback() {
        super.connectedCallback()
        this._load()
    }

    async _load() {
        this._loading = true
        this._error = null
        try {
            this._schedules = await api.getSchedules()
        } catch (err) {
            this._error = err
        } finally {
            this._loading = false
        }
    }

    _groupMap() {
        const map = new Map()
        for (const s of this._schedules) {
            if (s.group) {
                if (!map.has(s.group)) map.set(s.group, [])
                map.get(s.group).push(s)
            }
        }
        return map
    }

    _ungrouped() {
        return this._schedules.filter(s => !s.group).sort((a, b) => (a.name ?? a.className).localeCompare(b.name ?? b.className))
    }

    _filteredInGroup(schedules) {
        const q = this._filter.toLowerCase().trim()
        if (!q) return schedules
        return schedules.filter(s => (s.name ?? '').toLowerCase().includes(q) || s.className.toLowerCase().includes(q))
    }

    async _showSource(className) {
        this._selectedSource = null
        this._sourceError = null
        this._sourceLoading = true
        this.updateComplete.then(() => this.querySelector('#fc-schedule-source-modal')?.showModal())
        try {
            this._selectedSource = await api.getScheduleSource(className)
        } catch (err) {
            this._sourceError = err.message
        } finally {
            this._sourceLoading = false
        }
    }

    _askRun(className, name) {
        this._runClassName = className
        this._runError = null
        this._runName = name ?? shortClass(className)
        this._runSuccess = false
        this._running = false
        this.updateComplete.then(() => this.querySelector('#fc-schedule-run-modal')?.showModal())
    }

    _closeRun() {
        this.querySelector('#fc-schedule-run-modal')?.close()
        this._runClassName = null
        this._runError = null
        this._runName = null
        this._runSuccess = false
    }

    async _confirmRun() {
        this._runError = null
        this._running = true
        try {
            await api.runSchedule(this._runClassName)
            this._runSuccess = true
        } catch (err) {
            this._runError = err
        } finally {
            this._running = false
        }
    }

    _closeSource() {
        this.querySelector('#fc-schedule-source-modal')?.close()
        this._selectedSource = null
        this._sourceError = null
    }

    _renderScheduleCard(item) {
        const human = cronToHuman(item.expression)
        const isRaw = human === item.expression
        const inactive = item.active === false
        return html`
            <div
                class="rounded-box border ${inactive
                    ? 'border-base-content/20'
                    : 'border-base-300 hover:border-primary/30 hover:shadow-md'} bg-base-200 transition-all duration-200 flex flex-col group"
            >
                <!-- Card header with gradient -->
                <div
                    class="px-4 pt-4 pb-3 ${inactive
                        ? 'bg-gradient-to-br from-base-content/3 via-transparent to-transparent'
                        : 'bg-gradient-to-br from-primary/5 via-transparent to-transparent'}"
                >
                    <div class="flex items-start gap-2.5">
                        <div
                            class="w-8 h-8 rounded-lg ${inactive
                                ? 'bg-base-content/8 text-base-content/30'
                                : 'bg-primary/10 text-primary'} flex items-center justify-center shrink-0 mt-0.5"
                        >
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                            </svg>
                        </div>
                        <div class="min-w-0 flex-1">
                            <div
                                class="font-bold text-sm leading-tight truncate ${inactive ? 'text-base-content/45' : ''}"
                                title="${item.name ?? shortClass(item.className)}"
                            >
                                ${item.name ?? shortClass(item.className)}
                            </div>
                            <div class="text-xs text-base-content/35 mt-1 truncate font-mono" title="${item.className}">
                                ${shortClass(item.className)}
                            </div>
                            ${inactive
                                ? html`<div class="flex items-center gap-1 mt-1.5">
                                      <svg
                                          class="w-3 h-3 text-base-content/35"
                                          fill="none"
                                          stroke="currentColor"
                                          stroke-width="2"
                                          viewBox="0 0 24 24"
                                      >
                                          <path
                                              stroke-linecap="round"
                                              stroke-linejoin="round"
                                              d="M14.25 9v6m-4.5 0V9M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                                          />
                                      </svg>
                                      <span class="text-[10px] text-base-content/35 font-medium tracking-wider uppercase">Inaktiv</span>
                                  </div>`
                                : ''}
                        </div>
                    </div>
                </div>

                <!-- Cron info -->
                <div
                    class="px-4 py-3 flex-1 flex flex-col justify-center border-t ${inactive
                        ? 'border-base-content/10'
                        : 'border-base-300/50'}"
                >
                    <div class="text-center">
                        <div class="text-lg font-semibold ${inactive ? 'text-base-content/30' : 'text-base-content/80'} leading-tight">
                            ${isRaw ? '' : human}
                        </div>
                        <div class="mt-1.5">
                            <span
                                class="badge badge-sm badge-ghost font-mono text-[10px] tracking-wider ${inactive
                                    ? 'text-base-content/25'
                                    : 'text-base-content/40'}"
                                >${item.expression}</span
                            >
                        </div>
                    </div>
                </div>

                <!-- Footer -->
                <div class="px-4 py-2 border-t border-base-300/50 flex justify-end gap-1">
                    <fc-tooltip
                        text=${inactive ? 'Schedule ist inaktiv' : 'Schedule manuell starten'}
                        .content=${html`
                            <button
                                class="btn btn-xs btn-ghost text-base-content/40 hover:text-success gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity"
                                @click=${() => this._askRun(item.className, item.name)}
                            >
                                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"
                                    />
                                </svg>
                                Start
                            </button>
                        `}
                    ></fc-tooltip>
                    <button
                        class="btn btn-xs btn-ghost ${inactive
                            ? 'text-base-content/20 hover:text-primary/40'
                            : 'text-base-content/40 hover:text-primary'} gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity"
                        @click=${() => this._showSource(item.className)}
                    >
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5"
                            />
                        </svg>
                        Source
                    </button>
                </div>
            </div>
        `
    }

    _renderGroupCard(groupName, items) {
        const count = items.length
        return html`
            <div
                class="rounded-box border border-base-300 bg-base-200 hover:border-primary/30 hover:shadow-md transition-all duration-200 flex flex-col cursor-pointer group"
                @click=${() => {
                    this._activeGroup = groupName
                    this._filter = ''
                }}
            >
                <!-- Card header with gradient -->
                <div class="px-4 pt-4 pb-3 bg-gradient-to-br from-primary/5 via-transparent to-transparent flex-1">
                    <div class="flex items-start gap-2.5">
                        <div class="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v8.25A2.25 2.25 0 0 0 4.5 16.5h15a2.25 2.25 0 0 0 2.25-2.25V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
                                />
                            </svg>
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="font-bold text-sm leading-tight truncate">${groupName}</div>
                            <div class="text-xs text-base-content/35 mt-1">
                                <span class="badge badge-xs badge-ghost">${count}</span>
                                Schedule${count !== 1 ? 's' : ''}
                            </div>
                            <div class="mt-2 flex flex-col gap-0.5">
                                ${items
                                    .slice(0, 5)
                                    .map(
                                        s =>
                                            html`<div class="text-[11px] text-base-content/40 truncate font-mono">
                                                ${s.name ?? shortClass(s.className)}
                                            </div>`
                                    )}
                                ${items.length > 5 ? html`<div class="text-[11px] text-base-content/30">…</div>` : ''}
                            </div>
                        </div>
                        <svg
                            class="w-4 h-4 text-base-content/20 group-hover:text-primary/40 transition-colors shrink-0 mt-1"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            viewBox="0 0 24 24"
                        >
                            <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                    </div>
                </div>
            </div>
        `
    }

    _renderRoot() {
        const groupMap = this._groupMap()
        const ungrouped = this._ungrouped()
        const isEmpty = this._schedules.length === 0

        const sortedGroups = [...groupMap.entries()].sort(([a], [b]) => a.localeCompare(b))

        return html`
            <!-- Toolbar -->
            <div class="flex items-center gap-2 mb-4">
                ${!isEmpty
                    ? html`<input
                              type="text"
                              class="input input-sm w-64 font-mono text-xs"
                              placeholder="Filter..."
                              .value=${this._filter}
                              @input=${e => (this._filter = e.target.value)}
                          />${this._filter
                              ? html`<button class="btn btn-sm btn-ghost" @click=${() => (this._filter = '')}>clear</button>`
                              : ''}`
                    : ''}
                <div class="ml-auto flex items-center gap-3">
                    <span class="text-sm text-base-content/60">
                        ${isEmpty ? '' : html`<span class="font-semibold">${this._schedules.length}</span> Schedule(s)`}
                    </span>
                    <fc-tooltip
                        position="bottom"
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
                ? html`<div class="alert alert-info"><span>Keine Schedules gefunden.</span></div>`
                : this._filter.trim()
                  ? html`
                        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            ${this._filteredInGroup(this._schedules).map(item => this._renderScheduleCard(item))}
                        </div>
                    `
                  : html`
                        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            ${sortedGroups.map(([name, items]) => this._renderGroupCard(name, items))}
                            ${ungrouped.map(item => this._renderScheduleCard(item))}
                        </div>
                    `}
        `
    }

    _renderGroup() {
        const groupMap = this._groupMap()
        const items = this._filteredInGroup(groupMap.get(this._activeGroup) ?? [])

        return html`
            <!-- Toolbar -->
            <div class="flex items-center gap-2 mb-4">
                <button
                    class="btn btn-sm btn-ghost border border-base-content/30 hover:border-base-content/50 gap-1.5"
                    @click=${() => {
                        this._activeGroup = null
                        this._filter = ''
                    }}
                >
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                    </svg>
                    Zurück
                </button>
                <span class="font-semibold text-sm">${this._activeGroup}</span>
                <input
                    type="text"
                    class="input input-sm w-48 font-mono text-xs ml-2"
                    placeholder="Filter..."
                    .value=${this._filter}
                    @input=${e => (this._filter = e.target.value)}
                />
                ${this._filter ? html`<button class="btn btn-sm btn-ghost" @click=${() => (this._filter = '')}>clear</button>` : ''}
                <div class="ml-auto">
                    <span class="text-sm text-base-content/60"><span class="font-semibold">${items.length}</span> Schedule(s)</span>
                </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                ${items.map(item => this._renderScheduleCard(item))}
            </div>
        `
    }

    render() {
        if (this._loading) return skeletonScheduleGrid()

        if (this._error) return renderApiError(this._error, { compact: true, retry: this._load })

        return html`
            ${this._activeGroup ? this._renderGroup() : this._renderRoot()}

            <!-- Source Modal -->
            <dialog
                id="fc-schedule-source-modal"
                class="modal"
                @close=${() => {
                    this._selectedSource = null
                    this._sourceError = null
                }}
            >
                <div class="modal-box w-[95vw] max-w-[95vw] h-[90vh] max-h-[90vh] p-0 flex flex-col overflow-hidden">
                    <!-- Header -->
                    <div class="bg-gradient-to-br from-primary/10 via-secondary/5 to-transparent px-5 pt-4 pb-3 flex-shrink-0">
                        <div class="flex items-center justify-between">
                            <div>
                                <h3 class="font-bold text-lg">Schedule Source</h3>
                                ${this._selectedSource
                                    ? html`<div class="text-xs text-base-content/50 mt-0.5 font-mono">
                                          ${this._selectedSource.className}
                                      </div>`
                                    : ''}
                            </div>
                            <button class="btn btn-sm btn-circle btn-ghost" @click=${this._closeSource}>
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    <!-- Content -->
                    <div class="flex-1 overflow-auto">
                        ${this._sourceLoading
                            ? html`
                                  <div class="flex justify-center py-16">
                                      <span class="loading loading-spinner loading-lg"></span>
                                  </div>
                              `
                            : this._sourceError
                              ? html`<div class="alert alert-error m-4"><span>${this._sourceError}</span></div>`
                              : this._selectedSource
                                ? html`<fc-source-viewer .value=${this._selectedSource.source}></fc-source-viewer>`
                                : ''}
                    </div>
                </div>
                <form method="dialog" class="modal-backdrop backdrop-blur-sm"><button>close</button></form>
            </dialog>

            <!-- Run Confirm Modal -->
            <dialog
                id="fc-schedule-run-modal"
                class="modal"
                @close=${() => {
                    this._runClassName = null
                    this._runError = null
                    this._runSuccess = false
                }}
            >
                <div class="modal-box max-w-sm p-0 overflow-hidden">
                    <!-- Header -->
                    <div class="bg-gradient-to-br from-primary/10 via-secondary/5 to-transparent px-6 pt-5 pb-4">
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
                                            d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"
                                        />
                                    </svg>
                                </div>
                                <h3 class="font-bold text-base">Schedule starten</h3>
                            </div>
                            <button class="btn btn-sm btn-ghost btn-square btn-circle" @click=${this._closeRun}>✕</button>
                        </div>
                    </div>

                    <!-- Content -->
                    <div class="px-6 pb-6 pt-4">
                        ${this._runSuccess
                            ? html`
                                  <div class="alert alert-success py-2 px-3 text-xs">
                                      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                          <path
                                              stroke-linecap="round"
                                              stroke-linejoin="round"
                                              d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                                          />
                                      </svg>
                                      <span><strong>${this._runName}</strong> wurde gestartet.</span>
                                  </div>
                                  <div class="modal-action mt-3">
                                      <button class="btn btn-sm" @click=${this._closeRun}>Schließen</button>
                                  </div>
                              `
                            : html`
                                  <p class="text-sm text-base-content/70">
                                      Möchtest du <strong>${this._runName}</strong> wirklich manuell starten?
                                  </p>
                                  ${this._runError
                                      ? html`<div class="mt-4">${renderApiError(this._runError, { compact: true })}</div>`
                                      : ''}
                                  <div class="modal-action mt-3">
                                      <button class="btn btn-ghost btn-sm" @click=${this._closeRun} ?disabled=${this._running}>
                                          Abbrechen
                                      </button>
                                      <button class="btn btn-primary btn-sm" @click=${this._confirmRun} ?disabled=${this._running}>
                                          ${this._running ? html`<span class="loading loading-spinner loading-xs"></span>` : 'Starten'}
                                      </button>
                                  </div>
                              `}
                    </div>
                </div>
                <form method="dialog" class="modal-backdrop backdrop-blur-sm">
                    <button @click=${this._closeRun}>close</button>
                </form>
            </dialog>
        `
    }
}

customElements.define('fc-schedule-list', FcScheduleList)

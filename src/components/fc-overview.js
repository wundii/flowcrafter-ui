import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'
import './fc-exception-chart.js'
import './fc-flow-chart.js'

function formatDateTime(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    return `${date} ${time}`
}

function formatRelativeOrDate(iso) {
    if (!iso) return ''
    const diffMs = Date.now() - new Date(iso).getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMs < 86400000) {
        if (diffMins < 1) return 'gerade eben'
        if (diffMins < 60) return `vor ${diffMins} Min.`
        return `vor ${Math.floor(diffMins / 60)} Std.`
    }
    return formatDateTime(iso)
}

function shortClass(fqn) {
    return fqn?.split('\\').pop() ?? fqn
}

function isoWithOffset(d) {
    const off = -d.getTimezoneOffset()
    const sign = off >= 0 ? '+' : '-'
    const h = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')
    const m = String(Math.abs(off) % 60).padStart(2, '0')
    const pad = v => String(v).padStart(2, '0')
    return (
        d.getFullYear() +
        '-' +
        pad(d.getMonth() + 1) +
        '-' +
        pad(d.getDate()) +
        'T' +
        pad(d.getHours()) +
        ':' +
        pad(d.getMinutes()) +
        ':' +
        pad(d.getSeconds()) +
        '.000' +
        sign +
        h +
        ':' +
        m
    )
}

export class FcOverview extends BaseElement {
    static properties = {
        _countdown: { state: true },
        _error: { state: true },
        _kpi: { state: true },
        _lastLoaded: { state: true },
        _loading: { state: true },
        _recentExceptions: { state: true },
        _problematicFlows: { state: true },
        serverInfo: { type: Object },
    }

    constructor() {
        super()
        this._countdown = 30
        this._error = false
        this._kpi = null
        this._lastLoaded = null
        this._loading = true
        this._recentExceptions = []
        this._problematicFlows = []
        this.serverInfo = null
    }

    connectedCallback() {
        super.connectedCallback()
        this._load()
        this._refreshTimer = setInterval(() => this._load(), 30000)
        this._countdownTimer = setInterval(() => {
            this._countdown = this._countdown > 0 ? this._countdown - 1 : 0
        }, 1000)
    }

    disconnectedCallback() {
        super.disconnectedCallback()
        clearInterval(this._refreshTimer)
        clearInterval(this._countdownTimer)
    }

    _navigate(tab) {
        this.dispatchEvent(new CustomEvent('tab-navigate', { detail: { tab }, bubbles: true, composed: true }))
    }

    async _load() {
        this._countdown = 30
        const isInitialLoad = this._kpi === null
        if (isInitialLoad) this._loading = true
        this._error = false
        try {
            const now = new Date()
            const todayStart = new Date(now)
            todayStart.setHours(0, 0, 0, 0)
            const weekAgo = new Date(now)
            weekAgo.setDate(weekAgo.getDate() - 6)
            weekAgo.setHours(0, 0, 0, 0)

            const nowIso = isoWithOffset(now)
            const todayIso = isoWithOffset(todayStart)
            const weekAgoIso = isoWithOffset(weekAgo)

            const [statsRes, queueRes, excWeekRes, schedulesRes, recentExcRes, problematicRes] = await Promise.all([
                api.getFlowStats({ from: todayIso, to: nowIso }),
                api.getQueueCount(),
                api.getExceptions({ top: 1, skip: 0, from: weekAgoIso, to: nowIso }),
                api.getSchedules(),
                api.getExceptions({ top: 5, sort: 'desc' }),
                api.getFlows({ top: 5, sort: 'desc', status: 'IN_PROGRESS_EXCEEDED,WARNING' }),
            ])

            const flowsToday = (statsRes ?? []).reduce((s, d) => s + (d.instances ?? 0), 0)
            const queueCount = queueRes?.count ?? 0
            const exceptionsWeek = excWeekRes?.total ?? 0
            const scheduleCount = (schedulesRes ?? []).length

            this._kpi = { flowsToday, queueCount, exceptionsWeek, scheduleCount }
            this._recentExceptions = recentExcRes?.items ?? []
            this._problematicFlows = problematicRes?.items ?? []
            this._lastLoaded = new Date()
        } catch {
            this._error = true
        }
        this._loading = false
        if (!isInitialLoad) {
            this.querySelector('fc-flow-chart')?._load()
            this.querySelector('fc-exception-chart')?._load()
        }
    }

    _renderKpi() {
        const { flowsToday, queueCount, exceptionsWeek, scheduleCount } = this._kpi

        const queueColor = queueCount > 0 ? 'warning' : 'success'
        const excColor = exceptionsWeek > 0 ? 'error' : 'success'

        const card = (label, value, color, icon, tab) => html`
            <button
                class="rounded-box border border-base-300 bg-base-200 p-4 text-left hover:shadow-lg hover:-translate-y-0.5 transition-all cursor-pointer w-full overflow-hidden relative group"
                @click=${tab ? () => this._navigate(tab) : null}
            >
                <!-- Gradient background overlay -->
                <div
                    class="absolute inset-0 bg-gradient-to-br from-${color ??
                    'primary'}/8 via-transparent to-transparent pointer-events-none"
                ></div>
                <!-- Accent line bottom -->
                <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-${color ?? 'primary'}/50 to-transparent"></div>
                <div class="relative flex items-start justify-between gap-3 mb-3">
                    <!-- Icon bubble -->
                    <div
                        class="w-9 h-9 rounded-xl bg-${color ?? 'primary'}/12 flex items-center justify-center text-${color ??
                        'primary'} flex-shrink-0"
                    >
                        ${icon}
                    </div>
                    <!-- Value -->
                    <div class="text-3xl font-bold tabular-nums text-base-content leading-none mt-0.5">${value}</div>
                </div>
                <div class="relative text-xs font-medium text-base-content/50 group-hover:text-base-content/70 transition-colors">
                    ${label}
                </div>
            </button>
        `

        const flowIcon = html`<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>`
        const queueIcon = html`<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24">
            <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
        </svg>`
        const excIcon = html`<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24">
            <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
        </svg>`
        const schedIcon = html`<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>`

        return html`
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                ${card('Flows heute', flowsToday, 'primary', flowIcon, 'flows')}
                ${card('Queue offen', queueCount, queueColor, queueIcon, 'queues')}
                ${card('Exceptions 7 Tage', exceptionsWeek, excColor, excIcon, 'exceptions')}
                ${card('Schedules', scheduleCount, 'secondary', schedIcon, 'schedules')}
            </div>
        `
    }

    _renderProblematicFlows() {
        const items = this._problematicFlows

        return html`
            <div class="rounded-box border border-base-300 bg-base-200 p-3 flex flex-col gap-2">
                <div class="flex items-center justify-between">
                    <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wide">Fehlgeschlagene Flows</span>
                </div>

                ${items.length === 0
                    ? html`<div class="flex items-center gap-2 text-xs text-success py-1">
                          <svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Keine auffälligen Flows
                      </div>`
                    : html`
                          <div class="flex flex-col gap-1">
                              ${items.map(flow => {
                                  const isExceeded = flow.status === 'IN_PROGRESS_EXCEEDED'
                                  const badgeText = isExceeded ? 'Exceeded' : 'Warning'
                                  const name = shortClass(flow.flowSource)
                                  return html`
                                      <button
                                          class="flex items-start gap-2 text-left hover:bg-base-300/50 rounded-lg py-1.5 pl-2 pr-1 transition-colors w-full border-l-2 border-warning/40 cursor-pointer"
                                          @click=${() =>
                                              this.dispatchEvent(
                                                  new CustomEvent('flow-selected', {
                                                      detail: { hash: flow.flowHash },
                                                      bubbles: true,
                                                      composed: true,
                                                  })
                                              )}
                                      >
                                          <div class="min-w-0 flex-1">
                                              <div class="flex items-center gap-1.5 min-w-0">
                                                  <span class="text-[11px] font-semibold text-base-content truncate">${name}</span>
                                                  <span class="badge badge-xs badge-warning flex-shrink-0 opacity-70">${badgeText}</span>
                                                  <span class="text-[10px] text-base-content/40 flex-shrink-0 ml-auto"
                                                      >${formatRelativeOrDate(flow.lastTerm)}</span
                                                  >
                                              </div>
                                              <div class="text-[10px] text-base-content/40 truncate mt-0.5">${flow.flowType}</div>
                                          </div>
                                      </button>
                                  `
                              })}
                          </div>
                      `}
            </div>
        `
    }

    _renderRecentExceptions() {
        const items = this._recentExceptions.slice(0, 5)

        return html`
            <div class="rounded-box border border-base-300 bg-base-200 p-3 flex flex-col gap-2">
                <div class="flex items-center justify-between">
                    <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wide">Letzte Exceptions</span>
                </div>

                ${items.length === 0
                    ? html`<div class="flex items-center gap-2 text-xs text-success py-1">
                          <svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Keine Exceptions
                      </div>`
                    : html`
                          <div class="flex flex-col gap-1">
                              ${items.map(ex => {
                                  const isSchedule = ex.type === 'schedule'
                                  const borderColor = isSchedule ? 'warning' : 'error'
                                  const badgeClass = isSchedule ? 'badge-warning' : 'badge-error'
                                  const name = isSchedule ? shortClass(ex.scheduleName) : shortClass(ex.stubSource)
                                  return html`
                                      <button
                                          class="flex items-start gap-2 text-left hover:bg-base-300/50 rounded-lg py-1.5 pl-2 pr-1 transition-colors w-full border-l-2 border-${borderColor}/40 cursor-pointer"
                                          @click=${() =>
                                              isSchedule || !ex.flowHash
                                                  ? this._navigate('exceptions')
                                                  : this.dispatchEvent(
                                                        new CustomEvent('flow-selected', {
                                                            detail: { hash: ex.flowHash },
                                                            bubbles: true,
                                                            composed: true,
                                                        })
                                                    )}
                                      >
                                          <div class="min-w-0 flex-1">
                                              <div class="flex items-center gap-1.5 min-w-0">
                                                  <span class="text-[11px] font-semibold text-base-content truncate">${name}</span>
                                                  <span class="badge badge-xs ${badgeClass} flex-shrink-0 opacity-70">
                                                      ${isSchedule ? 'Schedule' : 'Flow'}
                                                  </span>
                                                  <span class="text-[10px] text-base-content/40 flex-shrink-0 ml-auto"
                                                      >${formatRelativeOrDate(ex.time)}</span
                                                  >
                                              </div>
                                              <div class="text-[10px] text-base-content/40 truncate mt-0.5">${ex.message}</div>
                                          </div>
                                      </button>
                                  `
                              })}
                          </div>
                      `}
            </div>
        `
    }

    render() {
        if (this._loading) {
            return html`
                <div class="flex justify-center py-16">
                    <span class="loading loading-spinner loading-lg"></span>
                </div>
            `
        }

        if (this._error) {
            return html`
                <div class="alert alert-error">
                    <span>Fehler beim Laden des Dashboards.</span>
                    <button class="btn btn-sm btn-ghost ml-2" @click=${this._load}>↻ Retry</button>
                </div>
            `
        }

        const lastLoadedLabel = this._lastLoaded
            ? this._lastLoaded.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            : ''

        return html`
            <div class="flex flex-col gap-4">
                <!-- Header -->
                <div class="flex items-center justify-between">
                    <div>
                        <h2 class="text-base font-semibold text-base-content">Übersicht</h2>
                        ${lastLoadedLabel ? html`<p class="text-xs text-base-content/40 mt-0.5">Stand: ${lastLoadedLabel}</p>` : ''}
                    </div>
                    <div class="relative inline-flex items-center justify-center" title="Nächster Refresh in ${this._countdown}s">
                        <svg class="absolute w-9 h-9 -rotate-90 pointer-events-none" viewBox="0 0 36 36">
                            <circle cx="18" cy="18" r="15" fill="none" class="stroke-base-content/15" stroke-width="2" />
                            <circle
                                cx="18"
                                cy="18"
                                r="15"
                                fill="none"
                                class="stroke-primary/70"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-dasharray="${2 * Math.PI * 15}"
                                stroke-dashoffset="${2 * Math.PI * 15 * (this._countdown / 30)}"
                            />
                        </svg>
                        <button class="btn btn-sm btn-ghost btn-circle border-0" @click=${this._load}>
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

                <!-- Row 1: KPI-Karten -->
                ${this._renderKpi()}

                <!-- Row 2: Charts + System-Status + Letzte Exceptions -->
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <fc-flow-chart
                        @chart-date-click=${e =>
                            this.dispatchEvent(new CustomEvent('chart-flow-date', { detail: e.detail, bubbles: true, composed: true }))}
                    ></fc-flow-chart>
                    <fc-exception-chart
                        @chart-date-click=${e =>
                            this.dispatchEvent(new CustomEvent('chart-exc-date', { detail: e.detail, bubbles: true, composed: true }))}
                    ></fc-exception-chart>
                    ${this._renderProblematicFlows()} ${this._renderRecentExceptions()}
                </div>
            </div>
        `
    }
}

customElements.define('fc-overview', FcOverview)

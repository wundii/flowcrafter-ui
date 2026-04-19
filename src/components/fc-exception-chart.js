import { html, svg } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'

const DAYS = 14
const PAD_X = 32
const PAD_TOP = 16
const PAD_BOT = 28
const W = 400
const H = 220

function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function shortDate(iso) {
    const [, m, d] = iso.split('-')
    return `${d}.${m}.`
}

function longDate(iso) {
    const [y, m, d] = iso.split('-')
    return `${d}.${m}.${y}`
}

export class FcExceptionChart extends BaseElement {
    static properties = {
        _data: { state: true },
        _error: { state: true },
        _loading: { state: true },
        _tooltip: { state: true },
    }

    constructor() {
        super()
        this._data = []
        this._error = false
        this._loading = true
        this._tooltip = null
    }

    connectedCallback() {
        super.connectedCallback()
        this._load()
    }

    async _load() {
        this._loading = true
        this._error = false
        try {
            const now = new Date()
            const from = new Date(now)
            from.setDate(from.getDate() - (DAYS - 1))
            from.setHours(0, 0, 0, 0)

            const fromStr = from.toISOString().replace('Z', '+00:00')
            const toStr = now.toISOString().replace('Z', '+00:00')

            const stats = await api.getExceptionStats({ from: fromStr, to: toStr })
            this._data = this._mergeWithEmptyDays(stats ?? [])
        } catch {
            this._error = true
            this._data = this._emptyDays()
        } finally {
            this._loading = false
        }
    }

    _emptyDays() {
        const days = []
        const now = new Date()
        for (let i = DAYS - 1; i >= 0; i--) {
            const d = new Date(now)
            d.setDate(d.getDate() - i)
            days.push({ date: dateKey(d), flow: 0, schedule: 0, observer: 0 })
        }
        return days
    }

    _mergeWithEmptyDays(stats) {
        const days = this._emptyDays()
        const map = Object.fromEntries(days.map(d => [d.date, d]))
        for (const s of stats) {
            if (map[s.date]) {
                map[s.date].flow = s.flow ?? 0
                map[s.date].schedule = s.schedule ?? 0
                map[s.date].observer = s.observer ?? 0
            }
        }
        return days
    }

    _onPointEnter(e, coord) {
        const svgEl = e.currentTarget.closest('svg')
        const container = svgEl.closest('.fc-chart-wrap')
        const cRect = container.getBoundingClientRect()
        const sRect = svgEl.getBoundingClientRect()
        const scaleX = sRect.width / W
        const scaleY = sRect.height / H
        this._tooltip = {
            x: sRect.left - cRect.left + coord.x * scaleX,
            y: sRect.top - cRect.top + coord.y * scaleY,
            coord,
        }
    }

    _onPointLeave() {
        this._tooltip = null
    }

    _onPointClick(date) {
        this.dispatchEvent(new CustomEvent('chart-date-click', { detail: { date }, bubbles: true, composed: true }))
    }

    render() {
        if (this._loading) {
            return html`
                <div class="flex justify-center items-center py-16">
                    <span class="loading loading-spinner loading-md"></span>
                </div>
            `
        }

        const data = this._data
        const max = Math.max(...data.map(d => Math.max(d.flow, d.schedule, d.observer)), 1)
        const totalFlow = data.reduce((s, d) => s + d.flow, 0)
        const totalSchedule = data.reduce((s, d) => s + d.schedule, 0)
        const totalObserver = data.reduce((s, d) => s + d.observer, 0)

        const chartW = W - PAD_X - 8
        const chartH = H - PAD_TOP - PAD_BOT
        const step = chartW / (DAYS - 1)

        const flowCoords = data.map((d, i) => ({
            x: PAD_X + i * step,
            y: PAD_TOP + chartH - (d.flow / max) * chartH,
            ...d,
        }))
        const scheduleCoords = data.map((d, i) => ({
            x: PAD_X + i * step,
            y: PAD_TOP + chartH - (d.schedule / max) * chartH,
            ...d,
        }))
        const observerCoords = data.map((d, i) => ({
            x: PAD_X + i * step,
            y: PAD_TOP + chartH - (d.observer / max) * chartH,
            ...d,
        }))

        const flowLine = flowCoords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
        const flowArea = `${flowLine} L${flowCoords.at(-1).x.toFixed(1)},${PAD_TOP + chartH} L${PAD_X},${PAD_TOP + chartH} Z`
        const scheduleLine = scheduleCoords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
        const scheduleArea = `${scheduleLine} L${scheduleCoords.at(-1).x.toFixed(1)},${PAD_TOP + chartH} L${PAD_X},${PAD_TOP + chartH} Z`
        const observerLine = observerCoords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
        const observerArea = `${observerLine} L${observerCoords.at(-1).x.toFixed(1)},${PAD_TOP + chartH} L${PAD_X},${PAD_TOP + chartH} Z`

        const yTicks = [0, Math.round(max / 2), max]
        const xLabels = flowCoords.filter((_, i) => i % 2 === 0 || i === DAYS - 1)

        const hasSchedule = totalSchedule > 0
        const hasObserver = totalObserver > 0

        return html`
            <div class="fc-chart-wrap rounded-box border border-base-300 bg-base-200 p-4 relative">
                <div class="flex items-start justify-between mb-3">
                    <div>
                        <div class="text-xs font-semibold text-base-content/50 uppercase tracking-wide">Exceptions</div>
                        <div class="text-[10px] text-base-content/35 mt-0.5">letzte 14 Tage</div>
                    </div>
                    <div class="flex items-center gap-4">
                        <span class="flex items-center gap-1.5 text-xs text-base-content/50">
                            <span
                                class="inline-block w-6 h-0 border-t-2 border-solid flex-shrink-0"
                                style="border-color:oklch(var(--er))"
                            ></span>
                            Flow (${totalFlow})
                        </span>
                        <span class="flex items-center gap-1.5 text-xs text-base-content/50">
                            <span
                                class="inline-block w-6 h-0 border-t-2 border-dashed flex-shrink-0"
                                style="border-color:oklch(var(--wa))"
                            ></span>
                            Schedule (${totalSchedule})
                        </span>
                        <span class="flex items-center gap-1.5 text-xs text-base-content/50">
                            <span
                                class="inline-block w-6 h-0 border-t-2 border-dotted flex-shrink-0"
                                style="border-color:oklch(var(--in))"
                            ></span>
                            Observer (${totalObserver})
                        </span>
                    </div>
                </div>

                <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" preserveAspectRatio="xMidYMid meet">
                    <defs>
                        <linearGradient id="exception-area-grad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" class="[stop-color:oklch(var(--er))]" stop-opacity="0.3" />
                            <stop offset="100%" class="[stop-color:oklch(var(--er))]" stop-opacity="0" />
                        </linearGradient>
                        <linearGradient id="schedule-exception-area-grad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" class="[stop-color:oklch(var(--wa))]" stop-opacity="0.2" />
                            <stop offset="100%" class="[stop-color:oklch(var(--wa))]" stop-opacity="0" />
                        </linearGradient>
                        <linearGradient id="observer-exception-area-grad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" class="[stop-color:oklch(var(--in))]" stop-opacity="0.2" />
                            <stop offset="100%" class="[stop-color:oklch(var(--in))]" stop-opacity="0" />
                        </linearGradient>
                    </defs>

                    <!-- Y-axis grid + labels -->
                    ${yTicks.map(t => {
                        const y = PAD_TOP + chartH - (t / max) * chartH
                        return svg`
                            <line x1="${PAD_X}" y1="${y}" x2="${W - 8}" y2="${y}"
                                  stroke="currentColor" class="text-base-content/10" stroke-width="1" />
                            <text x="${PAD_X - 6}" y="${y + 3}" text-anchor="end"
                                  class="fill-base-content/40" style="font-size:10px">${t}</text>
                        `
                    })}

                    <!-- Observer area + line (dotted) -->
                    ${hasObserver ? svg`<path d="${observerArea}" fill="url(#observer-exception-area-grad)" />` : ''}
                    ${hasObserver
                        ? svg`<path
                        d="${observerLine}"
                        fill="none"
                        class="stroke-info"
                        stroke-width="1.5"
                        stroke-linejoin="round"
                        stroke-linecap="round"
                        stroke-dasharray="2 3"
                    />`
                        : ''}

                    <!-- Schedule area + line (behind flow, dashed) -->
                    <path d="${scheduleArea}" fill="url(#schedule-exception-area-grad)" />
                    <path
                        d="${scheduleLine}"
                        fill="none"
                        class="stroke-warning"
                        stroke-width="1.5"
                        stroke-linejoin="round"
                        stroke-linecap="round"
                        stroke-dasharray="4 3"
                    />

                    <!-- Flow area + line -->
                    <path d="${flowArea}" fill="url(#exception-area-grad)" />
                    <path
                        d="${flowLine}"
                        fill="none"
                        class="stroke-error"
                        stroke-width="2"
                        stroke-linejoin="round"
                        stroke-linecap="round"
                    />

                    <!-- Flow data points -->
                    ${flowCoords.map(
                        c => svg`
                        <g @mouseenter=${e => this._onPointEnter(e, c)} @mouseleave=${() => this._onPointLeave()} @click=${() => this._onPointClick(c.date)} style="cursor:pointer">
                            <circle cx="${c.x}" cy="${c.y}" r="8" fill="transparent" stroke="none" />
                            <circle cx="${c.x}" cy="${c.y}" r="3"
                                    class="fill-error stroke-base-200" stroke-width="1.5" style="pointer-events:none" />
                        </g>
                    `
                    )}

                    <!-- Schedule data points -->
                    ${hasSchedule
                        ? scheduleCoords
                              .filter(c => c.schedule > 0)
                              .map(
                                  c => svg`
                            <g @mouseenter=${e => this._onPointEnter(e, c)} @mouseleave=${() => this._onPointLeave()} @click=${() => this._onPointClick(c.date)} style="cursor:pointer">
                                <circle cx="${c.x}" cy="${c.y}" r="8" fill="transparent" stroke="none" />
                                <circle cx="${c.x}" cy="${c.y}" r="2.5"
                                        class="fill-warning stroke-base-200" stroke-width="1" style="pointer-events:none" />
                            </g>
                        `
                              )
                        : ''}

                    <!-- Observer data points -->
                    ${hasObserver
                        ? observerCoords
                              .filter(c => c.observer > 0)
                              .map(
                                  c => svg`
                            <g @mouseenter=${e => this._onPointEnter(e, c)} @mouseleave=${() => this._onPointLeave()} @click=${() => this._onPointClick(c.date)} style="cursor:pointer">
                                <circle cx="${c.x}" cy="${c.y}" r="8" fill="transparent" stroke="none" />
                                <circle cx="${c.x}" cy="${c.y}" r="2.5"
                                        class="fill-info stroke-base-200" stroke-width="1" style="pointer-events:none" />
                            </g>
                        `
                              )
                        : ''}

                    <!-- X-axis labels -->
                    ${xLabels.map(
                        c => svg`
                        <text x="${c.x}" y="${H - 4}" text-anchor="middle"
                              class="fill-base-content/40" style="font-size:9px">${shortDate(c.date)}</text>
                    `
                    )}
                </svg>

                ${this._tooltip
                    ? html`
                          <div
                              class="absolute z-50 pointer-events-none"
                              style="left:${this._tooltip.x}px;top:${this._tooltip.y}px;transform:translate(-50%,calc(-100% - 10px))"
                          >
                              <div
                                  class="bg-base-300 border border-base-content/10 rounded-lg shadow-xl px-3 py-2 text-xs whitespace-nowrap"
                              >
                                  <div class="font-semibold text-base-content/80 mb-2">${longDate(this._tooltip.coord.date)}</div>
                                  <div class="flex items-center gap-2 text-base-content/60">
                                      <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:oklch(var(--er))"></span>
                                      <span>Flow</span>
                                      <span class="ml-auto font-medium text-base-content pl-3">${this._tooltip.coord.flow}</span>
                                  </div>
                                  <div class="flex items-center gap-2 text-base-content/60 mt-1">
                                      <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:oklch(var(--wa))"></span>
                                      <span>Schedule</span>
                                      <span class="ml-auto font-medium text-base-content pl-3">${this._tooltip.coord.schedule}</span>
                                  </div>
                                  <div class="flex items-center gap-2 text-base-content/60 mt-1">
                                      <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:oklch(var(--in))"></span>
                                      <span>Observer</span>
                                      <span class="ml-auto font-medium text-base-content pl-3">${this._tooltip.coord.observer}</span>
                                  </div>
                              </div>
                          </div>
                      `
                    : ''}
            </div>
        `
    }
}

customElements.define('fc-exception-chart', FcExceptionChart)

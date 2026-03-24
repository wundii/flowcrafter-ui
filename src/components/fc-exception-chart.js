import { html, svg } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'

const DAYS = 14
const PAD_X = 32
const PAD_TOP = 16
const PAD_BOT = 28

function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function shortDate(iso) {
    const [, m, d] = iso.split('-')
    return `${d}.${m}.`
}

export class FcExceptionChart extends BaseElement {
    static properties = {
        _data: { state: true },
        _loading: { state: true },
        _error: { state: true },
    }

    constructor() {
        super()
        this._data = []
        this._loading = true
        this._error = false
    }

    async _load() {
        this._loading = true
        this._error = false
        try {
            const now = new Date()
            const from = new Date(now)
            from.setDate(from.getDate() - (DAYS - 1))
            from.setHours(0, 0, 0, 0)

            const res = await api.getExceptions({
                sort: 'desc',
                top: 10000,
                skip: 0,
                from: from.toISOString().replace('Z', '+00:00'),
                to: now.toISOString().replace('Z', '+00:00'),
            })
            const items = res.items ?? []
            this._data = this._aggregate(items)
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
            days.push({ date: dateKey(d), count: 0 })
        }
        return days
    }

    _aggregate(items) {
        const days = this._emptyDays()
        const map = Object.fromEntries(days.map(d => [d.date, d]))
        for (const ex of items) {
            const key = dateKey(new Date(ex.time))
            if (map[key]) map[key].count++
        }
        return days
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
        const max = Math.max(...data.map(d => d.count), 1)
        const total = data.reduce((s, d) => s + d.count, 0)

        // Responsive: use viewBox, let CSS scale
        const W = 400
        const H = 220
        const chartW = W - PAD_X - 8
        const chartH = H - PAD_TOP - PAD_BOT
        const step = chartW / (DAYS - 1)

        const coords = data.map((d, i) => {
            const x = PAD_X + i * step
            const y = PAD_TOP + chartH - (d.count / max) * chartH
            return { x, y, ...d }
        })

        const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
        const areaPath = `${linePath} L${coords.at(-1).x.toFixed(1)},${PAD_TOP + chartH} L${PAD_X},${PAD_TOP + chartH} Z`

        // Y-axis ticks (0, mid, max)
        const yTicks = [0, Math.round(max / 2), max]

        // X-axis labels — show every 2nd day to avoid clutter
        const xLabels = coords.filter((_, i) => i % 2 === 0 || i === DAYS - 1)

        return html`
            <div class="rounded-box border border-base-300 bg-base-200 p-4">
                <div class="flex items-baseline justify-between mb-3">
                    <span class="text-sm font-semibold text-base-content">Verlauf der letzten 14 Tage</span>
                    <span class="text-xs text-base-content/50">${total} gesamt</span>
                </div>

                <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" preserveAspectRatio="xMidYMid meet">
                    <defs>
                        <linearGradient id="exception-area-grad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" class="[stop-color:oklch(var(--er))]" stop-opacity="0.3" />
                            <stop offset="100%" class="[stop-color:oklch(var(--er))]" stop-opacity="0" />
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

                    <!-- Area fill with vertical gradient -->
                    <path d="${areaPath}" fill="url(#exception-area-grad)" />

                    <!-- Line -->
                    <path
                        d="${linePath}"
                        fill="none"
                        class="stroke-error"
                        stroke-width="2"
                        stroke-linejoin="round"
                        stroke-linecap="round"
                    />

                    <!-- Data points -->
                    ${coords.map(
                        c => svg`
                        <circle cx="${c.x}" cy="${c.y}" r="3"
                                class="fill-error stroke-base-200" stroke-width="1.5">
                            <title>${shortDate(c.date)}: ${c.count} Exceptions</title>
                        </circle>
                    `
                    )}

                    <!-- X-axis labels -->
                    ${xLabels.map(
                        c => svg`
                        <text x="${c.x}" y="${H - 4}" text-anchor="middle"
                              class="fill-base-content/40" style="font-size:9px">${shortDate(c.date)}</text>
                    `
                    )}
                </svg>
            </div>
        `
    }
}

customElements.define('fc-exception-chart', FcExceptionChart)

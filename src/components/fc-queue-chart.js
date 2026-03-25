import { html, svg } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'

const MAX_POINTS = 60
const POLL_MS = 3000
const W = 160
const H = 40

export class FcQueueChart extends BaseElement {
    static properties = {
        _points: { state: true },
        _current: { state: true },
        _error: { state: true },
    }

    constructor() {
        super()
        this._points = []
        this._current = null
        this._error = false
        this._timer = null
    }

    connectedCallback() {
        super.connectedCallback()
        this._poll()
        this._timer = setInterval(() => this._poll(), POLL_MS)
    }

    disconnectedCallback() {
        super.disconnectedCallback()
        clearInterval(this._timer)
    }

    async _poll() {
        try {
            const { count } = await api.getQueueCount()
            this._current = count
            this._error = false
            this._points = [...this._points.slice(-(MAX_POINTS - 1)), count]
        } catch {
            this._error = true
        }
    }

    _buildPath() {
        const pts = this._points
        if (pts.length < 2) return { path: '', area: '' }

        const max = Math.max(...pts, 1)
        // Always spread across the full chart width
        const step = W / (pts.length - 1)

        const coords = pts.map((v, i) => {
            const x = i * step
            const y = H - 4 - (v / max) * (H - 8)
            return [x, y]
        })

        const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
        const area = `${line} L${W},${H} L0,${H} Z`

        return { path: line, area }
    }

    render() {
        const { path, area } = this._buildPath()
        const hasData = this._points.length > 0
        const isActive = this._current !== null && this._current > 0
        const colorClass = isActive ? 'text-warning' : 'text-success'

        return html`
            <div class="flex items-center gap-2.5" title="Queue-Größe (live, alle 3s)">
                <!-- Label + count -->
                <div class="text-right">
                    <div class="text-xs text-base-content/40 leading-none mb-0.5">Queue</div>
                    <div class="text-sm font-mono font-semibold leading-none ${colorClass}">
                        ${this._error
                            ? html`<span class="text-base-content/30">—</span>`
                            : (this._current ?? html`<span class="text-base-content/30">…</span>`)}
                    </div>
                </div>

                <!-- SVG chart — currentColor is set by colorClass on the svg element -->
                <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="rounded ${colorClass}">
                    <!-- background -->
                    <rect x="0" y="0" width="${W}" height="${H}" rx="4" style="fill: oklch(from var(--color-base-300) l c h / 0.6)" />

                    ${hasData && area
                        ? svg`
                        <path d="${area}" fill="currentColor" opacity="0.18" />
                        <path d="${path}" fill="none" stroke="currentColor" stroke-width="1.5"
                            stroke-linejoin="round" stroke-linecap="round" />
                    `
                        : ''}

                    <!-- baseline -->
                    <line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="currentColor" stroke-width="1" opacity="0.15" />
                </svg>
            </div>
        `
    }
}

customElements.define('fc-queue-chart', FcQueueChart)

import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { formatAbsolute, formatRelative, isRelative } from '../utils/time.js'

export class FcTime extends BaseElement {
    static properties = {
        iso: { type: String },
        _hover: { state: true },
        _x: { state: true },
        _y: { state: true },
    }

    constructor() {
        super()
        this.iso = null
        this._hover = false
        this._x = 0
        this._y = 0
    }

    _onEnter(e) {
        const rect = e.currentTarget.getBoundingClientRect()
        this._x = rect.left + rect.width / 2
        this._y = rect.top
        this._hover = true
    }

    _onLeave() {
        this._hover = false
    }

    render() {
        if (!this.iso) return ''
        if (!isRelative(this.iso)) return html`<span>${formatAbsolute(this.iso)}</span>`
        return html`
            <span @mouseenter=${this._onEnter} @mouseleave=${this._onLeave}>${formatRelative(this.iso)}</span>
            ${
                this._hover
                    ? html`
                          <span
                              class="fixed z-[9999] -translate-x-1/2 -translate-y-full -mt-1 px-2 py-1 rounded bg-base-300/95 backdrop-blur-sm text-base-content border border-base-content/10 text-xs whitespace-nowrap shadow-lg pointer-events-none"
                              style="left:${this._x}px;top:${this._y}px"
                          >
                              ${formatAbsolute(this.iso)}
                          </span>
                      `
                    : ''
            }
        `
    }
}

customElements.define('fc-time', FcTime)

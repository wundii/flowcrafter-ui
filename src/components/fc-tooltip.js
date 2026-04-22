import { html, render as litRender } from 'lit'
import { BaseElement } from '../base-element.js'

/**
 * Hover tooltip with fixed positioning. Bubble is portaled to document.body
 * to escape transformed/clipping ancestors (e.g. DaisyUI modal-box).
 *
 * Properties:
 *   text     {String|TemplateResult} — Tooltip body
 *   content  {TemplateResult}        — Trigger element (wrapped)
 *   position {'top'|'bottom'|'left'|'right'} — Default 'top'
 */
export class FcTooltip extends BaseElement {
    static properties = {
        text: {},
        content: { type: Object },
        position: { type: String },
    }

    constructor() {
        super()
        this.text = ''
        this.content = null
        this.position = 'top'
        this._x = 0
        this._y = 0
        this._bubble = null
    }

    _onEnter(e) {
        const rect = e.currentTarget.getBoundingClientRect()
        switch (this.position) {
            case 'bottom':
                this._x = rect.left + rect.width / 2
                this._y = rect.bottom
                break
            case 'left':
                this._x = rect.left
                this._y = rect.top + rect.height / 2
                break
            case 'right':
                this._x = rect.right
                this._y = rect.top + rect.height / 2
                break
            default:
                this._x = rect.left + rect.width / 2
                this._y = rect.top
        }
        clearTimeout(this._openTimer)
        this._openTimer = setTimeout(() => this._showBubble(), 400)
    }

    _onLeave() {
        clearTimeout(this._openTimer)
        this._hideBubble()
    }

    disconnectedCallback() {
        super.disconnectedCallback()
        clearTimeout(this._openTimer)
        this._hideBubble()
    }

    _bubbleClasses() {
        const base =
            'fixed z-[9999] px-2 py-1 rounded bg-base-300/95 backdrop-blur-sm text-base-content border border-base-content/10 text-xs whitespace-nowrap shadow-lg pointer-events-none'
        switch (this.position) {
            case 'bottom':
                return `${base} -translate-x-1/2 mt-1`
            case 'left':
                return `${base} -translate-x-full -translate-y-1/2 -ml-1`
            case 'right':
                return `${base} -translate-y-1/2 ml-1`
            default:
                return `${base} -translate-x-1/2 -translate-y-full -mt-1`
        }
    }

    _showBubble() {
        if (!this.text) return
        const needsTopLayer = !!document.querySelector('dialog[open]')
        if (!this._bubble) {
            this._bubble = document.createElement('span')
            if (needsTopLayer && 'popover' in HTMLElement.prototype) this._bubble.popover = 'manual'
            document.body.appendChild(this._bubble)
        }
        this._bubble.className = this._bubbleClasses()
        this._bubble.style.inset = 'auto'
        this._bubble.style.margin = '0'
        this._bubble.style.left = `${this._x}px`
        this._bubble.style.top = `${this._y}px`
        litRender(this.text, this._bubble)
        if (needsTopLayer && this._bubble.showPopover) {
            try {
                this._bubble.showPopover()
            } catch {
                // already open
            }
        }
        this._clampToViewport()
    }

    _hideBubble() {
        if (this._bubble) {
            if (this._bubble.hasAttribute('popover') && this._bubble.hidePopover) {
                try {
                    this._bubble.hidePopover()
                } catch {
                    // already closed
                }
            }
            this._bubble.remove()
            this._bubble = null
        }
    }

    _clampToViewport() {
        if (!this._bubble) return
        const rect = this._bubble.getBoundingClientRect()
        const margin = 8
        let dx = 0
        let dy = 0
        if (rect.right > window.innerWidth - margin) dx = window.innerWidth - margin - rect.right
        else if (rect.left < margin) dx = margin - rect.left
        if (rect.bottom > window.innerHeight - margin) dy = window.innerHeight - margin - rect.bottom
        else if (rect.top < margin) dy = margin - rect.top
        if (dx !== 0) this._bubble.style.left = `${this._x + dx}px`
        if (dy !== 0) this._bubble.style.top = `${this._y + dy}px`
    }

    render() {
        return html`<span @mouseenter=${this._onEnter} @mouseleave=${this._onLeave}>${this.content}</span>`
    }
}

customElements.define('fc-tooltip', FcTooltip)

import { html } from 'lit'
import { BaseElement } from '../base-element.js'

export class FcEmptyState extends BaseElement {
    static properties = {
        message: { type: String },
    }

    constructor() {
        super()
        this.message = ''
    }

    render() {
        return html`
            <div class="flex flex-col items-center gap-3 py-12 text-base-content/40">
                <svg class="w-8 h-8" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803 7.5 7.5 0 0016.803 15.803z"
                    />
                </svg>
                <span class="text-sm">${this.message}</span>
            </div>
        `
    }
}

customElements.define('fc-empty-state', FcEmptyState)

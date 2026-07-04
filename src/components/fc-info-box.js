import { html } from 'lit'
import { BaseElement } from '../base-element.js'

/**
 * Reusable styled info box with a header and body content.
 *
 * Properties:
 *   title       {String}         — Header text
 *   titleColor  {String}         — Tailwind color class for the title, e.g. 'text-info' (default: 'text-base-content/50')
 *   subtitle    {String}         — Optional subtitle shown next to the title in muted style
 *   content     {TemplateResult} — Lit html`...` template rendered in the body
 */
export class FcInfoBox extends BaseElement {
    static properties = {
        content: { type: Object },
        title: { type: String },
        titleColor: { type: String },
        subtitle: { type: String },
    }

    constructor() {
        super()
        this.title = ''
        this.titleColor = 'text-base-content/50'
        this.subtitle = ''
        this.content = null
    }

    render() {
        return html`
            <div class="rounded-box border border-base-300 bg-base-100 shadow-lg">
                <div class="bg-base-200 px-4 py-3 rounded-t-box">
                    <span class="text-xs font-semibold uppercase ${this.titleColor}">${this.title}</span>
                    ${
                        this.subtitle
                            ? html`<div
                                  class="text-[10px] text-base-content/40 font-normal font-mono truncate mt-0.5 min-w-0 max-w-full"
                                  title="${this.subtitle}"
                              >
                                  ${this.subtitle}
                              </div>`
                            : ''
                    }
                </div>
                <div class="px-4 py-3">${this.content}</div>
            </div>
        `
    }
}

customElements.define('fc-info-box', FcInfoBox)

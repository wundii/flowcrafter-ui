import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'

function shortClass(fqn) {
    return fqn?.split('\\').pop() ?? fqn
}

export class FcQueueList extends BaseElement {
    static properties = {
        _queues: { state: true },
        _loading: { state: true },
        _error: { state: true },
        _expanded: { state: true },
    }

    constructor() {
        super()
        this._queues = []
        this._loading = true
        this._error = null
        this._expanded = new Set()
    }

    connectedCallback() {
        super.connectedCallback()
        this._load()
    }

    async _load() {
        this._loading = true
        this._error = null
        try {
            this._queues = await api.getQueues()
        } catch (err) {
            this._error = err.message
        } finally {
            this._loading = false
        }
    }

    _toggleRow(id) {
        const next = new Set(this._expanded)
        next.has(id) ? next.delete(id) : next.add(id)
        this._expanded = next
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

    render() {
        if (this._loading)
            return html`
                <div class="flex justify-center py-16">
                    <span class="loading loading-spinner loading-lg"></span>
                </div>
            `

        if (this._error)
            return html`
                <div class="alert alert-error">
                    <span>Fehler beim Laden: ${this._error}</span>
                    <button class="btn btn-sm btn-ghost ml-2" @click=${this._load}>↻ Retry</button>
                </div>
            `

        if (this._queues.length === 0)
            return html`<div class="alert alert-success"><span>Queue ist leer.</span></div>`

        return html`
            <!-- Toolbar -->
            <div class="flex items-center justify-between mb-4">
                <span class="text-sm text-base-content/60">
                    <span class="font-semibold">${this._queues.length}</span> Einträge in der Queue
                </span>
                <button class="btn btn-sm btn-ghost" @click=${this._load}>↻ Reload</button>
            </div>

            <!-- Queue cards -->
            <div class="flex flex-col gap-2">
                ${this._queues.map((item, idx) => {
                    const id = item.queueId || idx
                    const open = this._expanded.has(id)
                    const hasMessage = item.message && Object.keys(item.message).length > 0

                    return html`
                        <div class="rounded-box border border-warning/25 bg-base-200 overflow-hidden">
                            <div class="grid grid-cols-[1fr_auto] gap-2 px-4 py-3">
                                <!-- Left -->
                                <div class="min-w-0">
                                    <div class="font-semibold text-sm text-base-content leading-tight mb-0.5" title="${item.flowSource}">
                                        ${shortClass(item.flowSource)}
                                    </div>
                                    <div class="text-xs text-base-content/50 mb-1" title="${item.messageSource}">
                                        ${shortClass(item.messageSource)}
                                    </div>
                                    ${item.queueId
                                        ? html`<div class="font-mono text-xs text-base-content/30">#${item.queueId}</div>`
                                        : ''}
                                </div>

                                <!-- Right -->
                                <div class="flex flex-col items-end justify-between gap-2 flex-shrink-0">
                                    ${item.flowHash
                                        ? html`
                                              <button
                                                  class="btn btn-xs btn-ghost font-mono text-primary/70 hover:text-primary"
                                                  title="Flow ${item.flowHash} öffnen"
                                                  @click=${() => this._navigateToFlow(item.flowHash)}
                                              >
                                                  ⤢ ${item.flowHash.slice(0, 10)}…
                                              </button>
                                          `
                                        : ''}
                                    ${hasMessage
                                        ? html`
                                              <button class="btn btn-xs btn-ghost text-base-content/40" @click=${() => this._toggleRow(id)}>
                                                  ${open ? '▲ Message' : '▼ Message'}
                                              </button>
                                          `
                                        : ''}
                                </div>
                            </div>

                            <!-- Message payload (collapsible) -->
                            ${open && hasMessage
                                ? html`
                                      <div class="border-t border-base-300 px-4 py-3 bg-base-300/50">
                                          <pre class="text-xs font-mono text-base-content/60 whitespace-pre-wrap overflow-auto max-h-64 leading-relaxed">${JSON.stringify(item.message, null, 2)}</pre>
                                      </div>
                                  `
                                : ''}
                        </div>
                    `
                })}
            </div>
        `
    }
}

customElements.define('fc-queue-list', FcQueueList)

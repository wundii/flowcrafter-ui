import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'

function shortClass(fqn) {
  return fqn?.split('\\').pop() ?? fqn
}

function formatDate(iso) {
  return new Date(iso).toLocaleString('de-DE', {
    dateStyle: 'short',
    timeStyle: 'medium',
  })
}

export class FcExceptionList extends BaseElement {
  static properties = {
    exceptions: { state: true },
    loading:    { state: true },
    error:      { state: true },
    expanded:   { state: true },   // Set of expanded row IDs
  }

  constructor() {
    super()
    this.exceptions = []
    this.loading    = true
    this.error      = null
    this.expanded   = new Set()
  }

  connectedCallback() {
    super.connectedCallback()
    this._load()
  }

  async _load() {
    this.loading = true
    this.error   = null
    try {
      this.exceptions = await api.getExceptions({ sort: 'desc' })
    } catch (err) {
      this.error = err.message
    } finally {
      this.loading = false
    }
  }

  _toggleRow(id) {
    const next = new Set(this.expanded)
    next.has(id) ? next.delete(id) : next.add(id)
    this.expanded = next
  }

  _navigateToFlow(hash) {
    this.dispatchEvent(new CustomEvent('flow-selected', {
      detail:   { hash },
      bubbles:  true,
      composed: true,
    }))
  }

  render() {
    if (this.loading) return html`
      <div class="flex justify-center py-16">
        <span class="loading loading-spinner loading-lg"></span>
      </div>
    `

    if (this.error) return html`
      <div class="alert alert-error">
        <span>Fehler beim Laden: ${this.error}</span>
        <button class="btn btn-sm ml-2" @click=${this._load}>Retry</button>
      </div>
    `

    if (this.exceptions.length === 0) return html`
      <div class="alert alert-success"><span>Keine Exceptions gefunden.</span></div>
    `

    // Group by flowHash for the summary badge
    const byFlow = new Map()
    for (const ex of this.exceptions) {
      byFlow.set(ex.flowHash, (byFlow.get(ex.flowHash) ?? 0) + 1)
    }

    return html`
      <!-- Toolbar -->
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-3">
          <span class="text-sm text-base-content/60">
            Letzte <span class="font-semibold">${this.exceptions.length}</span> Exceptions
          </span>
        </div>
        <button class="btn btn-sm btn-ghost" @click=${this._load}>↻ Reload</button>
      </div>

      <!-- Exception cards -->
      <div class="flex flex-col gap-2">
        ${this.exceptions.map((ex, idx) => {
          const id       = ex.id ?? idx
          const open     = this.expanded.has(id)
          const hasTrace = !!ex.traceString

          return html`
            <div class="rounded-box border border-error/25 bg-base-200 overflow-hidden">

              <!-- Main row -->
              <div class="grid grid-cols-[1fr_auto] gap-2 px-4 py-3">

                <!-- Left: headline + subtitle + meta -->
                <div class="min-w-0">
                  <!-- Headline: stub name -->
                  <div class="font-semibold text-sm text-base-content leading-tight mb-0.5"
                       title="${ex.stubSource}">
                    ${shortClass(ex.stubSource)}
                  </div>

                  <!-- Subtitle: exception message -->
                  <div class="text-sm text-error leading-snug break-words mb-2">
                    ${ex.message}
                  </div>

                  <!-- Meta row -->
                  <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-base-content/50">

                    <!-- File:line -->
                    ${ex.file ? html`
                      <span title="${ex.file}">
                        <span class="font-mono" style="font-size:11px;">
                          ${ex.file.split('/').slice(-2).join('/')}:${ex.line}
                        </span>
                      </span>
                    ` : ''}

                    <!-- Timestamp -->
                    <span>${formatDate(ex.time)}</span>
                  </div>
                </div>

                <!-- Right: flow link + expand -->
                <div class="flex flex-col items-end justify-between gap-2 flex-shrink-0">
                  <!-- Flow-Hash Link -->
                  <button
                    class="btn btn-xs btn-ghost font-mono text-primary/70 hover:text-primary"
                    title="Flow ${ex.flowHash} öffnen"
                    @click=${() => this._navigateToFlow(ex.flowHash)}
                  >
                    ⤢ ${ex.flowHash.slice(0, 10)}…
                  </button>

                  <!-- Stacktrace toggle -->
                  ${hasTrace ? html`
                    <button
                      class="btn btn-xs btn-ghost text-base-content/40"
                      @click=${() => this._toggleRow(id)}
                    >
                      ${open ? '▲ Trace' : '▼ Trace'}
                    </button>
                  ` : ''}
                </div>
              </div>

              <!-- Stacktrace (collapsible) -->
              ${open && hasTrace ? html`
                <div class="border-t border-base-300 px-4 py-3 bg-base-300/50">
                  <pre class="text-xs font-mono text-base-content/60 whitespace-pre-wrap overflow-auto max-h-64 leading-relaxed">${ex.traceString}</pre>
                </div>
              ` : ''}
            </div>
          `
        })}
      </div>
    `
  }
}

customElements.define('fc-exception-list', FcExceptionList)

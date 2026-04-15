import { html } from 'lit'

const warningIcon = html`
    <svg class="w-4 h-4 text-error shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
        />
    </svg>
`

const warningIconLg = html`
    <svg class="w-5 h-5 text-error shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
        />
    </svg>
`

/**
 * Renders an API error with optional file/line context and stack trace.
 *
 * @param {Error|{message:string,file?:string|null,line?:number|null,trace?:string|null,fileContext?:Array|null}|string|null} error
 * @param {{ retry?: Function, detailed?: boolean, compact?: boolean }} [opts]
 *   - retry:    optional callback shown as a retry button
 *   - detailed: show full fileContext + trace (DevTools only)
 *   - compact:  small inline variant for modals / footers
 */
export function renderApiError(error, opts = {}) {
    if (!error) return ''

    const msg = typeof error === 'string' ? error : (error.message ?? String(error))
    const file = typeof error === 'object' ? (error.file ?? null) : null
    const line = typeof error === 'object' ? (error.line ?? null) : null
    const trace = typeof error === 'object' ? (error.trace ?? null) : null
    const fileContext = typeof error === 'object' ? (error.fileContext ?? null) : null
    const fileLine = file ? `${file}${line !== null ? `:${line}` : ''}` : null

    const { retry, detailed = false, compact = false } = opts

    // ── Compact ─────────────────────────────────────────────────────────────
    if (compact) {
        return html`
            <div class="rounded-lg border border-error/30 bg-error/5 px-3 py-2.5">
                <div class="flex items-center gap-1.5">
                    <svg class="w-3.5 h-3.5 text-error shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                        />
                    </svg>
                    <span class="text-xs font-semibold text-error">${msg}</span>
                </div>
                ${fileLine ? html`<div class="text-[10px] font-mono text-base-content/40 mt-1 ml-5 truncate">${fileLine}</div>` : ''}
            </div>
        `
    }

    // ── Detailed (DevTools) ──────────────────────────────────────────────────
    if (detailed) {
        return html`
            <div class="rounded-box border border-error/30 bg-base-100 overflow-auto flex flex-col">
                <div class="px-6 py-4 border-b border-error/20 bg-error/5 shrink-0 flex items-center gap-3">
                    ${warningIconLg}
                    <div class="flex-1 min-w-0">
                        <div class="font-semibold text-error text-sm">Fehler aufgetreten</div>
                    </div>
                    ${retry
                        ? html`<button class="btn btn-xs btn-ghost text-error/70 hover:text-error shrink-0" @click=${retry}>
                              Erneut versuchen
                          </button>`
                        : ''}
                </div>

                <div class="p-6 flex flex-col gap-6">
                    <div>
                        <div class="text-xs font-semibold text-base-content/40 uppercase tracking-wider mb-1.5">Fehlermeldung</div>
                        <code class="block text-sm font-mono text-error bg-error/5 border border-error/20 rounded-lg px-4 py-3 break-all"
                            >${msg}</code
                        >
                    </div>

                    ${fileContext?.length
                        ? html`
                              <div>
                                  <div class="text-xs font-semibold text-base-content/40 uppercase tracking-wider mb-1.5">Quelldatei</div>
                                  <div class="rounded-lg border border-base-300 overflow-hidden text-xs font-mono leading-relaxed">
                                      ${fileContext.map(
                                          l => html`
                                              <div
                                                  class="flex gap-0 ${l.highlighted
                                                      ? 'bg-error/10 border-l-2 border-error'
                                                      : 'border-l-2 border-transparent'}"
                                              >
                                                  <span
                                                      class="select-none w-12 shrink-0 px-3 py-0.5 text-right ${l.highlighted
                                                          ? 'text-error font-bold'
                                                          : 'text-base-content/25'} border-r border-base-300"
                                                      >${l.number}</span
                                                  >
                                                  <pre
                                                      class="flex-1 px-4 py-0.5 ${l.highlighted
                                                          ? 'text-error/90'
                                                          : 'text-base-content/70'} overflow-x-auto whitespace-pre"
                                                  >
${l.content}</pre
                                                  >
                                              </div>
                                          `
                                      )}
                                  </div>
                              </div>
                          `
                        : ''}
                    ${trace
                        ? html`
                              <div>
                                  <div class="text-xs font-semibold text-base-content/40 uppercase tracking-wider mb-1.5">Stack Trace</div>
                                  <pre
                                      class="text-xs font-mono text-base-content/50 bg-base-200/50 border border-base-300 rounded-lg px-4 py-3 overflow-auto max-h-64 whitespace-pre leading-relaxed"
                                  >
${trace}</pre
                                  >
                              </div>
                          `
                        : ''}
                </div>
            </div>
        `
    }

    // ── Standard ─────────────────────────────────────────────────────────────
    return html`
        <div class="rounded-box border border-error/30 bg-error/5 overflow-hidden">
            <div class="px-4 py-3 flex items-start gap-3">
                ${warningIcon}
                <div class="flex-1 min-w-0">
                    <div class="text-sm font-semibold text-error">${msg}</div>
                    ${fileLine ? html`<div class="text-xs font-mono text-base-content/40 mt-0.5 truncate">${fileLine}</div>` : ''}
                </div>
                ${retry
                    ? html`<button class="btn btn-xs btn-ghost text-error/70 hover:text-error shrink-0" @click=${retry}>↻ Retry</button>`
                    : ''}
            </div>
            ${trace
                ? html`
                      <details class="border-t border-error/20">
                          <summary class="px-4 py-2 text-xs text-base-content/40 cursor-pointer select-none hover:text-base-content/60">
                              Stack Trace anzeigen
                          </summary>
                          <pre class="px-4 pb-3 text-xs font-mono text-base-content/50 overflow-auto whitespace-pre max-h-48">${trace}</pre>
                      </details>
                  `
                : ''}
        </div>
    `
}

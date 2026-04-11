import { html } from 'lit'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'
import { buildRuns } from '../services/runs.js'
import { renderApiError } from '../utils/error.js'
import './fc-flow-graph.js'
import './fc-json-editor.js'
import './fc-source-viewer.js'

function shortClass(fqn) {
    return fqn?.split('\\').pop() ?? fqn
}

function computeStubDiff(liveStubs, storedStubs) {
    const storedBySource = new Map(storedStubs.map(s => [s.source, s]))
    const diff = {}
    for (const live of liveStubs) {
        const stored = storedBySource.get(live.source)
        if (!stored) {
            diff[live.source] = { status: 'added', changes: null }
            continue
        }
        const addedMessages = live.messages.filter(m => !stored.messages.includes(m))
        const removedMessages = stored.messages.filter(m => !live.messages.includes(m))
        const addedReturnTypes = live.returnTypes.filter(r => !stored.returnTypes.includes(r))
        const removedReturnTypes = stored.returnTypes.filter(r => !live.returnTypes.includes(r))
        if (addedMessages.length || removedMessages.length || addedReturnTypes.length || removedReturnTypes.length) {
            diff[live.source] = {
                status: 'changed',
                changes: {
                    messages: { added: addedMessages, removed: removedMessages },
                    returnTypes: { added: addedReturnTypes, removed: removedReturnTypes },
                },
            }
        } else {
            diff[live.source] = { status: 'unchanged', changes: null }
        }
    }
    return diff
}

function nextVersion(type) {
    const m = type?.match(/v(\d+)$/)
    if (!m) return null
    return { current: `v${m[1]}`, next: `v${parseInt(m[1]) + 1}` }
}

function removedStubs(liveStubs, storedStubs) {
    const liveSources = new Set(liveStubs.map(s => s.source))
    return storedStubs.filter(s => !liveSources.has(s.source))
}

export class FcDev extends BaseElement {
    static properties = {
        _activeGroup: { state: true },
        _detail: { state: true },
        _detailError: { state: true },
        _detailLoading: { state: true },
        _error: { state: true },
        _filter: { state: true },
        _flows: { state: true },
        _lastRunFlow: { state: true },
        _lastRunOutput: { state: true },
        _loading: { state: true },
        _outputModalSelectedStub: { state: true },
        _runError: { state: true },
        _runMessage: { state: true },
        _runMessageValid: { state: true },
        _runModalLoading: { state: true },
        _runResult: { state: true },
        _runSending: { state: true },
        _selected: { state: true },
        _sidebarWidth: { state: true },
        _srcContent: { state: true },
        _srcError: { state: true },
        _srcLoading: { state: true },
        _srcSource: { state: true },
        _validationCache: { state: true },
    }

    constructor() {
        super()
        this._activeGroup = null
        this._detail = null
        this._detailError = null
        this._detailLoading = false
        this._error = null
        this._filter = ''
        this._flows = []
        this._lastRunFlow = null
        this._lastRunOutput = null
        this._loading = true
        this._runError = null
        this._runMessage = {}
        this._runMessageValid = true
        this._runModalLoading = false
        this._runResult = null
        this._runSending = false
        this._selected = null
        this._sidebarWidth = 300
        this._srcContent = null
        this._srcError = null
        this._srcLoading = false
        this._srcSource = null
        this._validationCache = {}
    }

    _startResize(e) {
        e.preventDefault()
        const startX = e.clientX
        const startWidth = this._sidebarWidth
        const minWidth = 300
        const maxWidth = Math.round(300 * 1.8)

        const onMove = mv => {
            this._sidebarWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + mv.clientX - startX))
        }
        const onUp = () => {
            document.removeEventListener('mousemove', onMove)
            document.removeEventListener('mouseup', onUp)
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
    }

    connectedCallback() {
        super.connectedCallback()
        this._load()
    }

    async _load() {
        this._error = null
        this._loading = true
        try {
            this._flows = await api.getDevFlows()
        } catch (err) {
            this._error = {
                message: err.message,
                file: err.file ?? null,
                line: err.line ?? null,
                trace: err.trace ?? null,
                fileContext: err.fileContext ?? null,
            }
        } finally {
            this._loading = false
        }
    }

    async _selectFlow(className) {
        this._detail = null
        this._detailError = null
        this._detailLoading = true
        this._selected = className
        this._lastRunFlow = null
        this._lastRunOutput = null
        try {
            const data = await api.getDevFlow(className)
            this._detail = data
            this._validationCache = { ...this._validationCache, [className]: data.valid && !data.hashDrift }
        } catch (err) {
            this._detailError = err
        } finally {
            this._detailLoading = false
        }
    }

    _groupMap() {
        const map = new Map()
        for (const f of this._flows) {
            if (f.group) {
                if (!map.has(f.group)) map.set(f.group, [])
                map.get(f.group).push(f)
            }
        }
        return map
    }

    _ungrouped() {
        return this._flows.filter(f => !f.group)
    }

    _filtered(list) {
        const q = this._filter.toLowerCase().trim()
        if (!q) return list
        return list.filter(
            f =>
                f.className.toLowerCase().includes(q) ||
                (f.type ?? '').toLowerCase().includes(q) ||
                (f.group ?? '').toLowerCase().includes(q)
        )
    }

    _syntheticFlow(schema) {
        return {
            flowSchema: schema,
            flowMessages: [],
            flowExceptions: [],
            flowResults: [],
            flowHash: null,
        }
    }

    async _handleSourceRequested(e) {
        const source = e.detail?.source
        if (!source) return
        this._srcContent = null
        this._srcError = null
        this._srcLoading = true
        this._srcSource = source
        await this.updateComplete
        this.querySelector('#fc-dev-source-modal')?.showModal()
        try {
            const data = await api.getStubSource(source)
            this._srcContent = data.source ?? ''
        } catch (err) {
            this._srcError = err
        } finally {
            this._srcLoading = false
        }
    }

    _closeSourceModal() {
        this.querySelector('#fc-dev-source-modal')?.close()
        this._srcContent = null
        this._srcError = null
        this._srcSource = null
    }

    _initMessageClass(schema) {
        const initStub = schema?.stubs?.find(s => s.messageEnum === 'init')
        return initStub?.messages?.[0] ?? null
    }

    async _loadRunModalData() {
        this._runModalLoading = true
        try {
            const data = await api.getDevFlow(this._selected)
            this._detail = data
            this._validationCache = { ...this._validationCache, [this._selected]: data.valid && !data.hashDrift }
            this._runMessage = this._detail?.initMessageSchema ?? {}
            this._runMessageValid = true
        } catch {
            // bei Fehler vorhandene Daten behalten
        } finally {
            this._runModalLoading = false
        }
    }

    async _openRunModal() {
        await this._loadRunModalData()
        this._runResult = null
        this._runError = null
        await this.updateComplete
        this.querySelector('#fc-dev-run-modal')?.showModal()
    }

    _closeRunModal() {
        const dialog = this.querySelector('#fc-dev-run-modal')
        const box = dialog?.querySelector('.modal-box')
        if (box) {
            box.style.position = ''
            box.style.margin = ''
            box.style.left = ''
            box.style.top = ''
        }
        dialog?.close()
        this._runResult = null
        this._runError = null
    }

    _startModalDrag(e, dialogId = 'fc-dev-run-modal') {
        const dialog = this.querySelector(`#${dialogId}`)
        const box = dialog?.querySelector('.modal-box')
        if (!box) return
        e.preventDefault()
        const rect = box.getBoundingClientRect()
        const startX = e.clientX
        const startY = e.clientY
        const origLeft = rect.left
        const origTop = rect.top
        box.style.position = 'fixed'
        box.style.margin = '0'
        box.style.left = `${origLeft}px`
        box.style.top = `${origTop}px`
        const onMove = ev => {
            box.style.left = `${origLeft + ev.clientX - startX}px`
            box.style.top = `${origTop + ev.clientY - startY}px`
        }
        const onUp = () => {
            document.removeEventListener('mousemove', onMove)
            document.removeEventListener('mouseup', onUp)
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
    }

    async _runFlow() {
        if (!this._selected || !this._detail?.schema) return
        const messageSource = this._initMessageClass(this._detail.schema)
        if (!messageSource) return
        this._runSending = true
        this._runResult = null
        this._runError = null
        try {
            const message = typeof this._runMessage === 'string' ? JSON.parse(this._runMessage) : this._runMessage
            const result = await api.runDevFlow(this._selected, messageSource, message)
            this._runResult = result
            if (result.success && result.flow) {
                this._lastRunFlow = result.flow
                this._lastRunOutput = result.output ?? null
                this._outputModalSelectedStub = result.output?.[0]?.class ?? null
                this.querySelector('#fc-dev-run-modal')?.close()
                if (result.output?.length) {
                    this.querySelector('#fc-dev-output-modal')?.showModal()
                }
            }
        } catch (err) {
            this._runError = err
        } finally {
            this._runSending = false
        }
    }

    _renderValidationIcon(className) {
        const valid = this._validationCache[className]
        if (valid === undefined) return ''
        return valid
            ? html`<svg class="w-3.5 h-3.5 text-success shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>`
            : html`<svg class="w-3.5 h-3.5 text-error shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>`
    }

    _renderFlowItem(f) {
        const active = this._selected === f.className
        return html`
            <button
                class="w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 transition-colors ${active
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-base-content/5'}"
                @click=${() => this._selectFlow(f.className)}
            >
                <div class="min-w-0 flex-1">
                    <div class="text-sm font-medium truncate">${shortClass(f.className)}</div>
                    ${f.type
                        ? html`<div class="text-[10px] font-mono text-base-content/40 truncate mt-0.5">${f.type}</div>`
                        : html`<div class="text-[10px] text-error/60 mt-0.5">schema() fehlgeschlagen</div>`}
                </div>
                ${this._renderValidationIcon(f.className)}
            </button>
        `
    }

    _renderSidebar() {
        const groupMap = this._groupMap()
        const ungrouped = this._filtered(this._ungrouped())
        const sortedGroups = [...groupMap.entries()].sort(([a], [b]) => a.localeCompare(b))

        return html`
            <div class="flex flex-col gap-1 overflow-y-auto h-full pr-1">
                <!-- Filter -->
                <div class="flex items-center gap-2 mb-2 shrink-0">
                    <input
                        type="text"
                        class="input input-sm flex-1 font-mono text-xs"
                        placeholder="Filter..."
                        .value=${this._filter}
                        @input=${e => (this._filter = e.target.value)}
                    />
                    ${this._filter ? html`<button class="btn btn-sm btn-ghost px-2" @click=${() => (this._filter = '')}>✕</button>` : ''}
                </div>

                ${this._flows.length === 0
                    ? html`<div class="text-sm text-base-content/40 text-center py-8">Keine lokalen Flows gefunden</div>`
                    : html`
                          ${sortedGroups.map(([groupName, items]) => {
                              const filtered = this._filtered(items)
                              if (filtered.length === 0) return ''
                              return html`
                                  <div class="mb-1">
                                      <div
                                          class="flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-base-content/50 uppercase tracking-wider"
                                      >
                                          <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                              <path
                                                  stroke-linecap="round"
                                                  stroke-linejoin="round"
                                                  d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v8.25A2.25 2.25 0 004.5 16.5h15a2.25 2.25 0 002.25-2.25V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                                              />
                                          </svg>
                                          ${groupName}
                                      </div>
                                      ${filtered.map(f => this._renderFlowItem(f))}
                                  </div>
                              `
                          })}
                          ${ungrouped.length > 0
                              ? html`
                                    <div class="mb-1">
                                        ${sortedGroups.length > 0
                                            ? html`<div
                                                  class="px-2 py-1 text-xs font-semibold text-base-content/50 uppercase tracking-wider"
                                              >
                                                  Ohne Gruppe
                                              </div>`
                                            : ''}
                                        ${ungrouped.map(f => this._renderFlowItem(f))}
                                    </div>
                                `
                              : ''}
                      `}
            </div>
        `
    }

    _renderDetail() {
        if (!this._selected) {
            return html`
                <div class="flex flex-col items-center justify-center h-full text-base-content/30 gap-3">
                    <svg class="w-12 h-12" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
                        />
                    </svg>
                    <span class="text-sm">Flow aus der Liste auswählen</span>
                </div>
            `
        }

        if (this._detailLoading) {
            return html`
                <div class="flex justify-center items-center h-full">
                    <span class="loading loading-spinner loading-lg"></span>
                </div>
            `
        }

        if (this._detailError) {
            return html`<div class="p-4">${renderApiError(this._detailError)}</div>`
        }

        if (!this._detail) return ''

        const d = this._detail
        const selectedFlow = this._flows.find(f => f.className === this._selected)

        return html`
            <div class="flex flex-col h-full overflow-hidden">
                <!-- Header -->
                <div
                    class="px-5 py-4 border-b border-base-300/50 shrink-0 bg-gradient-to-br via-transparent to-transparent ${!d.valid
                        ? 'from-error/5'
                        : d.hashDrift
                          ? 'from-orange-500/5'
                          : 'from-primary/5'}"
                >
                    <div class="flex items-start gap-3">
                        <div
                            class="w-9 h-9 rounded-lg ${!d.valid
                                ? 'bg-error/10 text-error'
                                : d.hashDrift
                                  ? 'bg-orange-500/10 text-orange-500'
                                  : 'bg-primary/10 text-primary'} flex items-center justify-center shrink-0 mt-0.5"
                        >
                            <svg class="w-4.5 h-4.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
                                />
                            </svg>
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="font-bold text-base leading-tight">${shortClass(this._selected)}</div>
                            ${d.schema?.type ? html`<div class="text-xs font-mono text-base-content/50 mt-0.5">${d.schema.type}</div>` : ''}
                            ${selectedFlow?.file
                                ? html`<div class="text-[10px] text-base-content/30 mt-1 truncate font-mono" title="${selectedFlow.file}">
                                      ${selectedFlow.file}
                                  </div>`
                                : ''}
                        </div>
                        ${d.hash
                            ? html`<div class="flex flex-col items-end gap-1 shrink-0">
                                  ${d.hashDrift
                                      ? html`<span class="badge badge-xs bg-orange-500/15 text-orange-500 border-orange-500/30"
                                            >Schema geändert</span
                                        >`
                                      : d.storedHash === null
                                        ? html`<span class="badge badge-xs badge-ghost">nicht deployed</span>`
                                        : html`<span class="badge badge-xs badge-success">aktuell</span>`}
                                  <span class="text-[10px] font-mono text-base-content/30">${d.hash}</span>
                              </div>`
                            : ''}
                    </div>
                </div>

                <!-- Status banner -->
                ${!d.valid
                    ? html`
                          <div class="px-5 py-3 border-b border-error/30 bg-error/5 shrink-0">
                              <div class="flex items-start gap-3">
                                  <svg
                                      class="w-5 h-5 text-error shrink-0 mt-0.5"
                                      fill="none"
                                      stroke="currentColor"
                                      stroke-width="2.5"
                                      viewBox="0 0 24 24"
                                  >
                                      <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                  <div class="flex-1 min-w-0">
                                      <div class="font-semibold text-error text-sm">Schema ungültig</div>
                                      <div class="text-xs text-base-content/60 mt-1">${d.error}</div>
                                  </div>
                              </div>
                          </div>
                      `
                    : d.hashDrift
                      ? html`
                            <div class="px-5 py-3 border-b border-orange-500/30 bg-orange-500/5 shrink-0">
                                <div class="flex items-start gap-3">
                                    <svg
                                        class="w-5 h-5 text-orange-500 shrink-0 mt-0.5"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                                        />
                                    </svg>
                                    <div class="flex-1 min-w-0">
                                        <div class="font-semibold text-orange-500 text-sm">Schema ungültig — neue Version erforderlich</div>
                                        <div class="text-xs text-base-content/60 mt-1">
                                            Das Schema wurde geändert, der Flow-Typ
                                            <code class="font-mono bg-base-300/50 px-1 rounded">${d.schema?.type}</code>
                                            ist bereits in der Datenbank gespeichert. Bitte den Versionsbezeichner erhöhen (z.B.
                                            <code class="font-mono bg-base-300/50 px-1 rounded"
                                                >${nextVersion(d.schema?.type)?.current ?? 'v1'}</code
                                            >
                                            →
                                            <code class="font-mono bg-base-300/50 px-1 rounded"
                                                >${nextVersion(d.schema?.type)?.next ?? 'v2'}</code
                                            >).
                                        </div>
                                    </div>
                                </div>
                            </div>
                        `
                      : html`
                            <div class="px-5 py-3 border-b border-success/30 bg-success/5 shrink-0">
                                <div class="flex items-start gap-3">
                                    <svg
                                        class="w-5 h-5 text-success shrink-0 mt-0.5"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2.5"
                                        viewBox="0 0 24 24"
                                    >
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                    </svg>
                                    <div class="flex-1 min-w-0">
                                        <div class="font-semibold text-success text-sm">Schema gültig</div>
                                        <div class="text-xs text-base-content/60 mt-1">
                                            Das Schema ist syntaktisch
                                            korrekt${d.storedHash !== null ? ' und entspricht der gespeicherten Version.' : '.'}
                                        </div>
                                    </div>
                                    <button
                                        class="btn btn-sm btn-success btn-outline shrink-0 m-2"
                                        ?disabled=${this._runModalLoading}
                                        @click=${() => this._openRunModal()}
                                    >
                                        ${this._runModalLoading
                                            ? html`<span class="loading loading-spinner loading-xs"></span>`
                                            : html`<svg
                                                  class="w-3.5 h-3.5"
                                                  fill="none"
                                                  stroke="currentColor"
                                                  stroke-width="2"
                                                  viewBox="0 0 24 24"
                                              >
                                                  <path
                                                      stroke-linecap="round"
                                                      stroke-linejoin="round"
                                                      d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347c-.75.412-1.667-.13-1.667-.986V5.653z"
                                                  />
                                              </svg>`}
                                        ${this._runModalLoading ? 'Laden...' : 'Flow starten'}
                                    </button>
                                </div>
                            </div>
                        `}

                <!-- Message drift banner -->
                ${d.valid && d.changedMessages?.length > 0
                    ? html`
                          <div class="px-5 py-3 border-b border-yellow-500/30 bg-yellow-500/5 shrink-0">
                              <div class="flex items-start gap-3">
                                  <svg
                                      class="w-5 h-5 text-yellow-500 shrink-0 mt-0.5"
                                      fill="none"
                                      stroke="currentColor"
                                      stroke-width="2"
                                      viewBox="0 0 24 24"
                                  >
                                      <path
                                          stroke-linecap="round"
                                          stroke-linejoin="round"
                                          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                                      />
                                  </svg>
                                  <div class="flex-1 min-w-0">
                                      <div class="font-semibold text-yellow-500 text-sm">Nachrichtenstruktur geändert</div>
                                      <div class="text-xs text-base-content/60 mt-1">
                                          Folgende Messages haben einen geänderten Konstruktor — alle verarbeiteten Flows werden nur noch
                                          als
                                          <strong>Readonly</strong> interpretiert. Empfehlung: Versionsbezeichner erhöhen (z.B.
                                          <code class="font-mono bg-base-300/50 px-1 rounded"
                                              >${nextVersion(d.schema?.type)?.current ?? 'v1'}</code
                                          >
                                          →
                                          <code class="font-mono bg-base-300/50 px-1 rounded"
                                              >${nextVersion(d.schema?.type)?.next ?? 'v2'}</code
                                          >).
                                      </div>
                                      <ul class="mt-2 flex flex-col gap-0.5">
                                          ${d.changedMessages.map(
                                              m => html`
                                                  <li class="text-[10px] font-mono text-yellow-500/80 flex items-center gap-1.5">
                                                      <span class="text-yellow-500 font-bold">!</span>
                                                      ${shortClass(m.class)}
                                                      <span class="text-base-content/30" title="${m.class}">${m.class}</span>
                                                  </li>
                                              `
                                          )}
                                      </ul>
                                  </div>
                              </div>
                          </div>
                      `
                    : ''}

                <!-- Graph -->
                ${d.valid && d.schema
                    ? html`
                          ${this._lastRunFlow
                              ? (() => {
                                    const run = buildRuns(this._lastRunFlow).at(-1) ?? null
                                    const dur = run?.duration ?? null
                                    const durLabel = dur === null ? '' : dur < 1000 ? `${dur}ms` : `${(dur / 1000).toFixed(1)}s`
                                    return html`
                                        <div
                                            class="flex items-center justify-between px-3 py-1.5 bg-success/10 border-b border-success/20 text-xs shrink-0"
                                        >
                                            <div class="flex items-center gap-2">
                                                <span class="text-success font-semibold">Run-Ergebnis</span>
                                                ${durLabel ? html`<span class="text-base-content/40 font-mono">${durLabel}</span>` : ''}
                                            </div>
                                            <div class="flex items-center gap-1">
                                                ${this._lastRunOutput?.length
                                                    ? html`
                                                          <button
                                                              class="btn btn-ghost btn-xs"
                                                              @click=${() => this.querySelector('#fc-dev-output-modal')?.showModal()}
                                                          >
                                                              Output anzeigen
                                                          </button>
                                                      `
                                                    : ''}
                                                <button
                                                    class="btn btn-ghost btn-xs"
                                                    @click=${() => {
                                                        this._lastRunFlow = null
                                                    }}
                                                >
                                                    × Schema-Ansicht
                                                </button>
                                            </div>
                                        </div>
                                    `
                                })()
                              : ''}
                          <div class="flex-1 overflow-auto m-3">
                              ${(() => {
                                  const graphRun = this._lastRunFlow ? (buildRuns(this._lastRunFlow).at(-1) ?? null) : null
                                  const graphFlow = this._lastRunFlow ?? this._syntheticFlow(d.schema)
                                  const stubDiff = this._lastRunFlow
                                      ? null
                                      : (() => {
                                            const messageDriftMap = Object.fromEntries((d.changedMessages ?? []).map(m => [m.class, m]))
                                            const messageDriftClasses = new Set(Object.keys(messageDriftMap))
                                            const base =
                                                d.hashDrift && d.storedSchema ? computeStubDiff(d.schema.stubs, d.storedSchema.stubs) : {}
                                            const diff = { ...base }
                                            for (const stub of d.schema.stubs ?? []) {
                                                const affectedMessages = [...stub.messages, ...stub.returnTypes].filter(m =>
                                                    messageDriftClasses.has(m)
                                                )
                                                if (affectedMessages.length > 0 && diff[stub.source]?.status !== 'added') {
                                                    diff[stub.source] = {
                                                        status: 'messageDrift',
                                                        changes: {
                                                            properties: affectedMessages.map(m => ({
                                                                class: m,
                                                                live: messageDriftMap[m]?.liveProperties ?? [],
                                                                stored: messageDriftMap[m]?.storedProperties ?? [],
                                                            })),
                                                        },
                                                    }
                                                }
                                            }
                                            return Object.keys(diff).length > 0 ? diff : null
                                        })()
                                  return html`
                                      <fc-flow-graph
                                          .flow=${graphFlow}
                                          .runId=${graphRun?.runId ?? null}
                                          .runMessages=${graphRun?.messages ?? null}
                                          .runExceptions=${graphRun?.exceptions ?? null}
                                          .runResults=${graphRun?.results ?? null}
                                          .readonly=${true}
                                          .stubDiff=${stubDiff}
                                          .messageSchemas=${this._lastRunFlow ? null : (this._detail?.messageSchemas ?? null)}
                                          @source-requested=${e => this._handleSourceRequested(e)}
                                      ></fc-flow-graph>
                                  `
                              })()}
                          </div>
                      `
                    : html`
                          <div class="flex-1 flex items-center justify-center text-base-content/25 text-sm">
                              Kein Graph verfügbar — Schema ungültig
                          </div>
                      `}

                <!-- Removed stubs banner -->
                ${d.hashDrift && d.storedSchema && removedStubs(d.schema.stubs, d.storedSchema.stubs).length > 0
                    ? html`
                          <div class="px-5 py-3 border-t border-error/30 bg-error/5 shrink-0">
                              <div class="flex items-start gap-3">
                                  <svg
                                      class="w-5 h-5 text-error shrink-0 mt-0.5"
                                      fill="none"
                                      stroke="currentColor"
                                      stroke-width="2"
                                      viewBox="0 0 24 24"
                                  >
                                      <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                  <div class="flex-1 min-w-0">
                                      <div class="font-semibold text-error text-sm">Entfernte Stubs</div>
                                      <div class="text-xs text-base-content/60 mt-1">
                                          Folgende Stubs existieren nicht mehr im aktuellen Schema.
                                      </div>
                                      <ul class="mt-2 flex flex-col gap-0.5">
                                          ${removedStubs(d.schema.stubs, d.storedSchema.stubs).map(
                                              stub => html`
                                                  <li class="text-xs font-mono text-error/80 flex items-center gap-1.5">
                                                      <span class="text-error font-bold">−</span>
                                                      ${shortClass(stub.source)}
                                                      <span class="text-base-content/30" title="${stub.source}">${stub.source}</span>
                                                  </li>
                                              `
                                          )}
                                      </ul>
                                  </div>
                              </div>
                          </div>
                      `
                    : ''}
            </div>
        `
    }

    render() {
        if (this._loading) {
            return html`
                <div class="flex justify-center py-16">
                    <span class="loading loading-spinner loading-lg"></span>
                </div>
            `
        }

        if (this._error) {
            return renderApiError(this._error, { detailed: true, retry: this._load })
        }

        return html`
            <div class="flex gap-0 h-[calc(100vh-10rem)] rounded-box border border-base-300 overflow-hidden">
                <!-- Sidebar -->
                <div style="width: ${this._sidebarWidth}px" class="shrink-0 border-r border-base-300 bg-base-200/50 flex flex-col">
                    <!-- Sidebar header -->
                    <div class="px-3 pt-3 pb-2 border-b border-base-300/50 shrink-0 flex items-center justify-between">
                        <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider">
                            ${this._flows.length} lokale Flow${this._flows.length !== 1 ? 's' : ''}
                        </span>
                        <button
                            class="btn btn-xs btn-ghost btn-circle"
                            title="Neu laden"
                            @click=${async () => {
                                await this._load()
                                if (this._selected) this._selectFlow(this._selected)
                            }}
                        >
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                />
                            </svg>
                        </button>
                    </div>
                    <!-- Sidebar content -->
                    <div class="flex-1 overflow-hidden p-2">${this._renderSidebar()}</div>
                </div>

                <!-- Resize handle -->
                <div
                    class="w-1 shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors -ml-px z-10"
                    @mousedown=${this._startResize}
                ></div>

                <!-- Detail panel -->
                <div class="flex-1 overflow-hidden bg-base-100">${this._renderDetail()}</div>
            </div>

            <!-- Dev Run Modal -->
            <dialog id="fc-dev-run-modal" class="modal">
                <div class="modal-box w-[960px] max-w-[95vw] flex flex-col gap-0 p-0 overflow-hidden">
                    <!-- Header -->
                    <div
                        class="bg-gradient-to-r from-success/10 via-success/5 to-transparent px-5 pt-4 pb-3 border-b border-base-300/50 shrink-0 cursor-move select-none"
                        @mousedown=${e => this._startModalDrag(e)}
                    >
                        <div class="flex items-center justify-between gap-3">
                            <div class="flex items-center gap-3 min-w-0">
                                <div
                                    class="w-8 h-8 rounded-lg bg-success/15 border border-success/20 flex items-center justify-center shrink-0"
                                >
                                    <svg
                                        class="w-4 h-4 text-success"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        viewBox="0 0 24 24"
                                    >
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 3l14 9-14 9V3z" />
                                    </svg>
                                </div>
                                <div class="min-w-0">
                                    <h3 class="font-bold text-sm leading-tight">Flow starten</h3>
                                    <p class="text-[11px] font-mono text-base-content/40 mt-0.5 truncate">${this._selected}</p>
                                </div>
                            </div>
                            <button class="btn btn-sm btn-ghost btn-circle shrink-0" @click=${() => this._closeRunModal()}>✕</button>
                        </div>
                    </div>
                    <div class="flex min-h-0" style="height: 420px">
                        <!-- Left: Init-Message properties -->
                        <div class="w-64 shrink-0 border-r border-base-300 bg-base-200/40 flex flex-col">
                            <!-- Init-Message header -->
                            <div class="px-4 py-3 border-b border-base-300/50 shrink-0">
                                <div class="flex items-start justify-between gap-2">
                                    <div class="min-w-0">
                                        <div class="text-[10px] font-semibold text-base-content/40 uppercase tracking-widest mb-1">
                                            Init-Message
                                        </div>
                                        <div
                                            class="text-xs font-mono font-semibold text-base-content/70 truncate"
                                            title="${this._initMessageClass(this._detail?.schema)}"
                                        >
                                            ${shortClass(this._initMessageClass(this._detail?.schema))}
                                        </div>
                                    </div>
                                    <button
                                        class="btn btn-xs btn-ghost btn-circle shrink-0"
                                        title="Init-Message neu laden"
                                        ?disabled=${this._runModalLoading}
                                        @click=${() => this._loadRunModalData()}
                                    >
                                        ${this._runModalLoading
                                            ? html`<span class="loading loading-spinner loading-xs"></span>`
                                            : html`<svg
                                                  class="w-3.5 h-3.5"
                                                  fill="none"
                                                  stroke="currentColor"
                                                  stroke-width="2"
                                                  viewBox="0 0 24 24"
                                              >
                                                  <path
                                                      stroke-linecap="round"
                                                      stroke-linejoin="round"
                                                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                                  />
                                              </svg>`}
                                    </button>
                                </div>
                            </div>
                            <!-- Property list -->
                            <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-1.5">
                                ${this._detail?.initMessageTypes && Object.keys(this._detail.initMessageTypes).length > 0
                                    ? Object.entries(this._detail.initMessageTypes).map(([name, type]) => {
                                          const nullable = type.startsWith('?')
                                          const base = nullable ? type.slice(1) : type
                                          const typeColor =
                                              base === 'string'
                                                  ? 'text-sky-400'
                                                  : base === 'int' || base === 'float'
                                                    ? 'text-amber-400'
                                                    : base === 'bool'
                                                      ? 'text-violet-400'
                                                      : base === 'array'
                                                        ? 'text-orange-400'
                                                        : 'text-base-content/50'
                                          return html`
                                              <div class="rounded-lg bg-base-100 border border-base-300/60 px-3 py-2 flex flex-col gap-0.5">
                                                  <span class="text-xs font-mono font-semibold text-base-content/90">${name}</span>
                                                  <span class="text-[10px] font-mono ${typeColor}"
                                                      >${nullable ? html`<span class="text-base-content/30">?</span>` : ''}${base}</span
                                                  >
                                              </div>
                                          `
                                      })
                                    : html`
                                          <div class="flex flex-col items-center justify-center h-full gap-2 text-center py-6">
                                              <svg
                                                  class="w-8 h-8 text-base-content/15"
                                                  fill="none"
                                                  stroke="currentColor"
                                                  stroke-width="1.5"
                                                  viewBox="0 0 24 24"
                                              >
                                                  <path
                                                      stroke-linecap="round"
                                                      stroke-linejoin="round"
                                                      d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                                                  />
                                              </svg>
                                              <span class="text-xs text-base-content/30">Keine Properties</span>
                                          </div>
                                      `}
                            </div>
                        </div>
                        <!-- Right: JSON editor + result -->
                        <div class="flex-1 min-w-0 flex flex-col p-4 gap-3 overflow-hidden">
                            ${this._detail?.schema
                                ? html`
                                      <div class="flex flex-col gap-1.5 flex-1 min-h-0">
                                          <div class="flex items-center gap-2">
                                              <span class="text-[10px] font-semibold text-base-content/40 uppercase tracking-widest"
                                                  >Payload</span
                                              >
                                              <span class="text-[10px] font-mono text-base-content/25"
                                                  >${shortClass(this._initMessageClass(this._detail?.schema))}</span
                                              >
                                          </div>
                                          <fc-json-editor
                                              class="flex-1 min-h-0"
                                              .value=${JSON.stringify(this._detail.initMessageSchema ?? {}, null, 2)}
                                              @change=${e => {
                                                  this._runMessage = e.detail.valid ? e.detail.value : this._runMessage
                                                  this._runMessageValid = e.detail.valid
                                              }}
                                          ></fc-json-editor>
                                      </div>
                                  `
                                : ''}
                            ${this._runResult && !this._runResult.success
                                ? html`
                                      <div class="rounded-lg bg-error/8 border border-error/25 px-4 py-3 flex items-start gap-3">
                                          <svg
                                              class="w-4 h-4 text-error shrink-0 mt-0.5"
                                              fill="none"
                                              stroke="currentColor"
                                              stroke-width="2"
                                              viewBox="0 0 24 24"
                                          >
                                              <path
                                                  stroke-linecap="round"
                                                  stroke-linejoin="round"
                                                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                                              />
                                          </svg>
                                          <span class="text-xs text-error">${this._runResult.error}</span>
                                      </div>
                                  `
                                : ''}
                            ${this._runError
                                ? html`
                                      <div class="rounded-lg bg-error/8 border border-error/25 px-4 py-3 flex items-start gap-3">
                                          <svg
                                              class="w-4 h-4 text-error shrink-0 mt-0.5"
                                              fill="none"
                                              stroke="currentColor"
                                              stroke-width="2"
                                              viewBox="0 0 24 24"
                                          >
                                              <path
                                                  stroke-linecap="round"
                                                  stroke-linejoin="round"
                                                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                                              />
                                          </svg>
                                          <span class="text-xs text-error">${this._runError.message}</span>
                                      </div>
                                  `
                                : ''}
                            ${this._runResult?.output
                                ? html`
                                      <div class="rounded-lg bg-base-300/60 border border-base-300 flex flex-col overflow-hidden">
                                          <div
                                              class="flex items-center gap-2 px-3 py-1.5 border-b border-base-300/60 bg-base-300/40 shrink-0"
                                          >
                                              <svg
                                                  class="w-3.5 h-3.5 text-base-content/40"
                                                  fill="none"
                                                  stroke="currentColor"
                                                  stroke-width="2"
                                                  viewBox="0 0 24 24"
                                              >
                                                  <path
                                                      stroke-linecap="round"
                                                      stroke-linejoin="round"
                                                      d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                                                  />
                                              </svg>
                                              <span class="text-[10px] font-semibold text-base-content/40 uppercase tracking-widest"
                                                  >Output</span
                                              >
                                          </div>
                                          <pre
                                              class="text-xs font-mono text-base-content/80 px-3 py-2.5 overflow-auto max-h-40 whitespace-pre-wrap"
                                          >
${this._runResult.output}</pre
                                          >
                                      </div>
                                  `
                                : ''}
                        </div>
                    </div>
                    <div class="modal-action px-5 pb-4 pt-3 mt-0 border-t border-base-300/50 flex items-center justify-between">
                        <span class="text-[10px] text-base-content/25 font-mono"
                            >${this._detail?.initMessageTypes ? Object.keys(this._detail.initMessageTypes).length + ' Felder' : ''}</span
                        >
                        <div class="flex gap-2">
                            <button class="btn btn-ghost btn-sm" @click=${() => this._closeRunModal()}>Abbrechen</button>
                            <button
                                class="btn btn-success btn-sm"
                                ?disabled=${!this._runMessageValid || this._runSending}
                                @click=${() => this._runFlow()}
                            >
                                ${this._runSending
                                    ? html`<span class="loading loading-spinner loading-xs"></span>`
                                    : html`<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                          <path stroke-linecap="round" stroke-linejoin="round" d="M5 3l14 9-14 9V3z" />
                                      </svg>`}
                                Ausführen
                            </button>
                        </div>
                    </div>
                </div>
                <form method="dialog" class="modal-backdrop">
                    <button @click=${() => this._closeRunModal()}>close</button>
                </form>
            </dialog>

            <!-- Console Output Modal -->
            <dialog id="fc-dev-output-modal" class="modal">
                <div class="modal-box w-[800px] max-w-[95vw] flex flex-col gap-0 p-0 overflow-hidden">
                    <!-- Header -->
                    <div
                        class="bg-gradient-to-r from-warning/10 via-warning/5 to-transparent px-5 pt-4 pb-3 border-b border-base-300/50 shrink-0 cursor-move select-none"
                        @mousedown=${e => this._startModalDrag(e, 'fc-dev-output-modal')}
                    >
                        <div class="flex items-center justify-between gap-3">
                            <div class="flex items-center gap-3 min-w-0">
                                <div
                                    class="w-8 h-8 rounded-lg bg-warning/15 border border-warning/20 flex items-center justify-center shrink-0"
                                >
                                    <svg
                                        class="w-4 h-4 text-warning"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                            d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                                        />
                                    </svg>
                                </div>
                                <div class="min-w-0">
                                    <h3 class="font-bold text-sm leading-tight">Console Output</h3>
                                    <p class="text-[11px] font-mono text-base-content/40 mt-0.5 truncate">${this._selected}</p>
                                </div>
                            </div>
                            <button
                                class="btn btn-sm btn-ghost btn-circle shrink-0"
                                @click=${() => this.querySelector('#fc-dev-output-modal')?.close()}
                            >
                                ✕
                            </button>
                        </div>
                    </div>
                    <div class="flex min-h-0" style="height: 420px">
                        <!-- Left: Stub list -->
                        <div class="w-64 shrink-0 border-r border-base-300 bg-base-200/40 flex flex-col overflow-y-auto">
                            <div class="px-4 py-3 border-b border-base-300/50 shrink-0">
                                <div class="text-[10px] font-semibold text-base-content/40 uppercase tracking-widest">Stubs mit Output</div>
                            </div>
                            <div class="flex flex-col flex-1 overflow-y-auto py-1.5 gap-0.5 px-2">
                                ${(this._lastRunOutput ?? []).map(
                                    entry => html`
                                        <button
                                            class="px-3 py-2 text-left text-xs font-mono rounded-lg truncate transition-colors ${this
                                                ._outputModalSelectedStub === entry.class
                                                ? 'bg-warning/15 text-warning font-semibold border border-warning/20'
                                                : 'hover:bg-base-300/50 text-base-content/70'}"
                                            @click=${() => {
                                                this._outputModalSelectedStub = entry.class
                                            }}
                                        >
                                            ${entry.class.split('\\').at(-1)}
                                        </button>
                                    `
                                )}
                            </div>
                        </div>
                        <!-- Right: Output content -->
                        <div
                            class="flex-1 overflow-auto p-4 font-mono text-xs whitespace-pre-wrap [&_pre]:whitespace-pre-wrap [&_pre]:m-0 text-base-content/80"
                        >
                            ${(() => {
                                const allStyles = (this._lastRunOutput ?? [])
                                    .flatMap(e => [...e.content.matchAll(/<style[\s\S]*?<\/style>/gi)].map(m => m[0]))
                                    .join('')
                                const selected = (
                                    (this._lastRunOutput ?? []).find(e => e.class === this._outputModalSelectedStub)?.content ?? ''
                                ).trim()
                                return unsafeHTML(allStyles + selected)
                            })()}
                        </div>
                    </div>
                </div>
                <form method="dialog" class="modal-backdrop"><button>close</button></form>
            </dialog>

            <!-- Stub Source Modal -->
            <dialog id="fc-dev-source-modal" class="modal">
                <div class="modal-box w-[95vw] max-w-[95vw] h-[90vh] max-h-[90vh] p-0 flex flex-col overflow-hidden">
                    <div class="bg-gradient-to-br from-primary/10 via-secondary/5 to-transparent px-5 pt-4 pb-3 flex-shrink-0">
                        <div class="flex items-center justify-between">
                            <div>
                                <h3 class="font-bold text-base">Stub Source</h3>
                                ${this._srcSource
                                    ? html`<p class="text-xs font-mono text-base-content/50 mt-0.5 truncate">${this._srcSource}</p>`
                                    : ''}
                            </div>
                            <button class="btn btn-sm btn-ghost btn-circle" @click=${() => this._closeSourceModal()}>✕</button>
                        </div>
                    </div>
                    <div class="flex-1 overflow-hidden">
                        ${this._srcLoading
                            ? html`<div class="flex items-center justify-center h-full">
                                  <span class="loading loading-spinner loading-md"></span>
                              </div>`
                            : this._srcError
                              ? html`<div class="p-4">${renderApiError(this._srcError, { compact: true })}</div>`
                              : this._srcContent !== null
                                ? html`<fc-source-viewer class="block h-full" .value=${this._srcContent}></fc-source-viewer>`
                                : ''}
                    </div>
                </div>
                <form method="dialog" class="modal-backdrop backdrop-blur-sm">
                    <button @click=${() => this._closeSourceModal()}>close</button>
                </form>
            </dialog>
        `
    }
}

customElements.define('fc-dev', FcDev)

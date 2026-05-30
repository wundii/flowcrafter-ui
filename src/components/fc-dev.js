import { html } from 'lit'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'
import { buildRuns } from '../services/runs.js'
import { formatBytes } from '../utils/bytes.js'
import { renderApiError } from '../utils/error.js'
import './fc-flow-graph.js'
import './fc-info-box.js'
import './fc-json-editor.js'
import './fc-source-viewer.js'
import './fc-tooltip.js'

const devModeTooltipContent = () => html`
    <div class="space-y-1.5 text-xs text-base-content/70">
        <div class="flex gap-2">
            <span class="text-warning shrink-0">✕</span>
            <span>Kein Storage in der Flowcrafter Datenbank</span>
        </div>
        <div class="flex gap-2">
            <span class="text-warning shrink-0">✕</span>
            <span>Keine Queue-Einträge werden angelegt</span>
        </div>
        <div class="flex gap-2">
            <span class="text-success shrink-0">✓</span>
            <span>Schnelles Testen ohne Seiteneffekte</span>
        </div>
    </div>
`

function shortClass(fqn) {
    return fqn?.split('\\').pop() ?? fqn
}

function computeStepDiff(liveSteps, storedSteps) {
    const storedBySource = new Map(storedSteps.map(s => [s.source, s]))
    const diff = {}
    for (const live of liveSteps) {
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

function removedSteps(liveSteps, storedSteps) {
    const liveSources = new Set(liveSteps.map(s => s.source))
    return storedSteps.filter(s => !liveSources.has(s.source))
}

const STATUS_CONFIG = {
    invalid: { color: 'error', iconColor: 'error', headerBg: 'from-error/5', icon: 'x', showButton: false },
    hashDrift: { color: 'orange-500', iconColor: 'orange-500', headerBg: 'from-orange-500/5', icon: 'warning', showButton: false },
    newType: { color: 'info', iconColor: 'info', headerBg: 'from-info/5', icon: 'check', showButton: true, buttonColor: 'info' },
    newVersion: { color: 'info', iconColor: 'info', headerBg: 'from-info/5', icon: 'check', showButton: true, buttonColor: 'info' },
    messageDrift: { color: 'orange-500', iconColor: 'orange-500', headerBg: 'from-orange-500/5', icon: 'warning', showButton: false },
    valid: { color: 'primary', iconColor: 'success', headerBg: 'from-primary/5', icon: 'check', showButton: true, buttonColor: 'success' },
}

function resolveFlowStatus(d, storedSchemas) {
    const typeBase = d.schema?.type?.replace(/\.v\d+$/, '')
    const storedExact = d.storedHash !== null
    const storedPrevVersion =
        !storedExact &&
        !!typeBase &&
        storedSchemas.some(s => s.type && s.type !== d.schema?.type && s.type.replace(/\.v\d+$/, '') === typeBase)
    const storedNone = !storedExact && !storedPrevVersion
    const messageDrift = storedExact && d.changedMessages?.length > 0
    const hasChangedMessages = d.valid && d.changedMessages?.length > 0
    const version = nextVersion(d.schema?.type)

    let key
    if (!d.valid) key = 'invalid'
    else if (d.hashDrift) key = 'hashDrift'
    else if (storedNone) key = 'newType'
    else if (storedPrevVersion) key = 'newVersion'
    else if (messageDrift) key = 'messageDrift'
    else key = 'valid'

    return { key, storedExact, storedPrevVersion, storedNone, messageDrift, hasChangedMessages, version, config: STATUS_CONFIG[key] }
}

export class FcDev extends BaseElement {
    static properties = {
        _activeGroup: { state: true },
        _collapsedGroups: { state: true },
        _detail: { state: true },
        _detailError: { state: true },
        _detailLoading: { state: true },
        _devImport: { state: true },
        _error: { state: true },
        _filter: { state: true },
        _flows: { state: true },
        _importModalError: { state: true },
        _importModalLoading: { state: true },
        _importSecret: { state: true },
        _importUrl: { state: true },
        _lastRunFlow: { state: true },
        _lastRunOutput: { state: true },
        _devRawModal: { state: true },
        _loading: { state: true },
        _outputModalSelectedStep: { state: true },
        _errorModalTab: { state: true },
        _runError: { state: true },
        _runMessage: { state: true },
        _runMessageValid: { state: true },
        _runModalLoading: { state: true },
        _runPayload: { state: true },
        _lastRunMemory: { state: true },
        _runResult: { state: true },
        _runSending: { state: true },
        _selected: { state: true },
        _sidebarWidth: { state: true },
        _srcContent: { state: true },
        _srcError: { state: true },
        _srcLoading: { state: true },
        _srcSource: { state: true },
        _storedSchemas: { state: true },
        _validationCache: { state: true },
        _versionsModal: { state: true },
        _versionsSelected: { state: true },
    }

    constructor() {
        super()
        this._activeGroup = null
        this._collapsedGroups = new Set()
        this._detail = null
        this._detailError = null
        this._detailLoading = false
        this._devImport = null
        this._error = null
        this._filter = ''
        this._flows = []
        this._importModalError = null
        this._importModalLoading = false
        this._importSecret = ''
        this._importUrl = ''
        this._lastRunFlow = null
        this._lastRunMemory = null
        this._lastRunOutput = null
        this._devRawModal = false
        this._errorModalTab = 'error'
        this._loading = true
        this._runError = null
        this._runMessage = {}
        this._runMessageValid = true
        this._runModalLoading = false
        this._runPayload = '{}'
        this._runResult = null
        this._runSending = false
        this._selected = null
        this._sidebarWidth = 300
        this._srcContent = null
        this._srcError = null
        this._srcLoading = false
        this._srcSource = null
        this._storedSchemas = []
        this._validationCache = {}
        this._validateGeneration = 0
        this._versionsModal = false
        this._versionsSelected = null
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
            const [flows, devImport, storedSchemas] = await Promise.all([
                api.getDevFlows(),
                api.getDevImport().catch(() => null),
                api.getSchemas().catch(() => []),
            ])
            const allGroups = new Set(flows.map(f => f.group).filter(Boolean))
            const previousGroups = new Set(this._flows.map(f => f.group).filter(Boolean))
            const newGroups = [...allGroups].filter(g => !previousGroups.has(g))
            this._collapsedGroups = new Set([
                ...[...this._collapsedGroups].filter(g => allGroups.has(g) || g === '__ungrouped__'),
                ...newGroups,
            ])
            this._flows = flows
            this._devImport = devImport
            this._storedSchemas = Array.isArray(storedSchemas) ? storedSchemas : []
            this._validateAllFlows()
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

    async _validateAllFlows() {
        this._validateGeneration++
        const gen = this._validateGeneration
        for (const flow of this._flows) {
            if (this._validateGeneration !== gen) return
            if (this._validationCache[flow.className] !== undefined) continue
            try {
                const data = await api.getDevFlow(flow.className)
                if (this._validateGeneration !== gen) return
                const status = resolveFlowStatus(data, this._storedSchemas)
                this._validationCache = {
                    ...this._validationCache,
                    [flow.className]: status.config.showButton,
                }
            } catch {
                // Flow überspringen
            }
        }
    }

    async _selectFlow(className) {
        this._detail = null
        this._detailError = null
        this._detailLoading = true
        this._lastRunFlow = null
        this._lastRunMemory = null
        this._lastRunOutput = null
        this._selected = className
        try {
            const data = await api.getDevFlow(className)
            if (this._devImport && data.schema?.type) {
                // 1. Schema-Fallback: storedHash + storedSchema aus Import wenn lokal nicht in DB
                const imp = this._devImport.schemas?.[data.schema.type]
                if (imp) {
                    if (data.storedHash === null) data.storedHash = imp.storedHash
                    if (data.storedSchema === null) data.storedSchema = { type: data.schema.type, steps: imp.steps }
                    data.hashDrift = data.hash !== null && data.storedHash !== null && data.hash !== data.storedHash
                }

                const importedMessageSources = this._devImport.messageSources ?? {}

                // 2. changedMessages-Enrichment aus Import
                //    Nur für Klassen die lokal per Reflection bekannt sind (data.messageSchemas),
                //    aber in der lokalen DB fehlen (daher noch nicht in data.changedMessages).
                //    Importiertes Format: { ShortName: [propName, ...] }
                const localMessageSchemas = data.messageSchemas ?? {}
                const changedSet = new Set((data.changedMessages ?? []).map(m => m.class))
                for (const [cls, propsByShortName] of Object.entries(importedMessageSources)) {
                    if (changedSet.has(cls)) continue // lokale DB hat bereits erkannt
                    if (!localMessageSchemas[cls]) continue // Klasse lokal nicht vorhanden → kein Vergleich

                    const shortName = cls.split('\\').pop()
                    const liveProps = Object.keys(localMessageSchemas[cls]).sort()
                    const importedTopLevel = (propsByShortName[shortName] ?? []).map(p => p.split(':')[0]).sort()

                    if (JSON.stringify(liveProps) !== JSON.stringify(importedTopLevel)) {
                        data.changedMessages = data.changedMessages ?? []
                        data.changedMessages.push({
                            class: cls,
                            liveHash: null,
                            storedHash: null,
                            liveProperties: liveProps,
                            storedProperties: propsByShortName[shortName] ?? [],
                            livePropertyNames: { [shortName]: liveProps },
                            storedPropertyNames: propsByShortName,
                        })
                    }
                }

                // 3. messageSchemas-Fallback für Klassen die lokal nicht existieren
                //    Transformation: { ShortName: [propName, ...] } → { propName: '?' }
                //    Lokale Reflection-Daten haben immer Vorrang.
                if (!data.messageSchemas) data.messageSchemas = {}
                for (const [cls, propsByShortName] of Object.entries(importedMessageSources)) {
                    if (data.messageSchemas[cls]) continue // lokal bekannt → überspringen
                    const props = {}
                    for (const propList of Object.values(propsByShortName)) {
                        for (const propName of propList) {
                            props[propName] = '?'
                        }
                    }
                    data.messageSchemas[cls] = props
                }
            }
            this._detail = data
            this._runMessage = data?.initMessageSchema ?? {}
            this._runMessageValid = true
            this._runPayload = JSON.stringify(data?.initMessageSchema ?? {}, null, 2)
            this._validationCache = {
                ...this._validationCache,
                [className]: resolveFlowStatus(data, this._storedSchemas).config.showButton,
            }
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
            const data = await api.getStepSource(source)
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
        const initStep = schema?.steps?.find(s => s.messageEnum === 'init')
        return initStep?.messages?.[0] ?? null
    }

    async _loadRunModalData(resetPayload = false) {
        this._runModalLoading = true
        try {
            const data = await api.getDevFlow(this._selected)
            this._detail = data
            this._validationCache = { ...this._validationCache, [this._selected]: data.valid && !data.hashDrift }
            if (resetPayload) {
                this._runMessage = this._detail?.initMessageSchema ?? {}
                this._runMessageValid = true
                this._runPayload = JSON.stringify(this._detail?.initMessageSchema ?? {}, null, 2)
            }
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

    _startModalResize(e, dialogId) {
        const dialog = this.querySelector(`#${dialogId}`)
        const box = dialog?.querySelector('.modal-box')
        if (!box) return
        e.preventDefault()
        e.stopPropagation()
        const startX = e.clientX
        const startY = e.clientY
        const startW = box.offsetWidth
        const startH = box.offsetHeight
        let lastW = startW
        let lastH = startH
        const onMove = ev => {
            lastW = Math.max(400, startW + ev.clientX - startX)
            lastH = Math.max(300, startH + ev.clientY - startY)
            box.style.width = `${lastW}px`
            box.style.maxWidth = 'none'
            box.style.height = `${lastH}px`
        }
        const onUp = () => {
            document.removeEventListener('mousemove', onMove)
            document.removeEventListener('mouseup', onUp)
            try {
                localStorage.setItem(`modal-size-${dialogId}`, JSON.stringify({ w: lastW, h: lastH }))
            } catch {
                // localStorage not available
            }
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
    }

    _openOutputModal() {
        const dialog = this.querySelector('#fc-dev-output-modal')
        if (!dialog) return
        try {
            const saved = JSON.parse(localStorage.getItem('modal-size-fc-dev-output-modal') ?? 'null')
            if (saved) {
                const box = dialog.querySelector('.modal-box')
                if (box) {
                    box.style.width = `${saved.w}px`
                    box.style.maxWidth = 'none'
                    box.style.height = `${saved.h}px`
                }
            }
        } catch {
            // localStorage not available
        }
        dialog.showModal()
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
            this._lastRunOutput = result.output ?? null
            this._outputModalSelectedStep = result.output?.[0]?.class ?? null
            if (result.success && result.flow) {
                this._lastRunFlow = result.flow
                this._lastRunMemory = result.memory ?? null
                this.querySelector('#fc-dev-run-modal')?.close()
                if (result.output?.length) {
                    this._openOutputModal()
                }
            }
        } catch (err) {
            this._runError = err
        } finally {
            this._runSending = false
        }
    }

    _stepNameFromError(err) {
        if (!err?.file) return null
        const match = err.file.match(/([^/\\]+)\.php$/)
        return match ? match[1] : null
    }

    _renderRunError() {
        const err =
            this._runError ?? (this._runResult && !this._runResult.success ? { message: this._runResult.error, ...this._runResult } : null)
        if (!err) return ''
        const stepName = this._stepNameFromError(err)
        const msg = err.message ?? ''
        const file = err.file ?? null
        const line = err.line ?? null
        const fileLine = file ? `${file}${line !== null ? `:${line}` : ''}` : null
        const hasDetails = !!(file || err.trace || err.fileContext?.length)
        return html`
            <div class="rounded-lg bg-error/8 border border-error/25 px-3 py-2.5 shrink-0">
                <div class="flex items-start gap-2.5">
                    <svg class="w-4 h-4 text-error shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                        />
                    </svg>
                    <div class="flex-1 min-w-0">
                        ${stepName
                            ? html`
                                  <div class="flex items-center gap-1.5 mb-1">
                                      <span class="text-xs text-base-content/40">${stepName}</span>
                                  </div>
                              `
                            : ''}
                        <div class="text-xs text-error font-medium">${msg}</div>
                        ${fileLine
                            ? html`<div class="text-[10px] font-mono text-base-content/40 mt-1 break-all leading-relaxed">${fileLine}</div>`
                            : ''}
                    </div>
                    ${hasDetails
                        ? html`
                              <button
                                  class="btn btn-xs btn-ghost text-error/70 hover:text-error shrink-0"
                                  @click=${() => this._openRunErrorModal()}
                              >
                                  Details
                              </button>
                          `
                        : ''}
                </div>
            </div>
        `
    }

    _openRunErrorModal() {
        this._errorModalTab = 'error'
        this.querySelector('#fc-dev-run-error-modal')?.showModal()
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
                    ${sortedGroups.length > 0
                        ? html`
                              <div class="flex items-center gap-0.5 shrink-0">
                                  <fc-tooltip
                                      text="Alle aufklappen"
                                      .content=${html`
                                          <button
                                              class="btn btn-ghost btn-xs btn-circle"
                                              @click=${() => (this._collapsedGroups = new Set())}
                                          >
                                              <svg
                                                  class="w-3.5 h-3.5"
                                                  fill="none"
                                                  stroke="currentColor"
                                                  stroke-width="2"
                                                  viewBox="0 0 24 24"
                                              >
                                                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                                              </svg>
                                          </button>
                                      `}
                                  ></fc-tooltip>
                                  <fc-tooltip
                                      text="Alle zuklappen"
                                      .content=${html`
                                          <button
                                              class="btn btn-ghost btn-xs btn-circle"
                                              @click=${() =>
                                                  (this._collapsedGroups = new Set([
                                                      ...sortedGroups.map(([name]) => name),
                                                      '__ungrouped__',
                                                  ]))}
                                          >
                                              <svg
                                                  class="w-3.5 h-3.5"
                                                  fill="none"
                                                  stroke="currentColor"
                                                  stroke-width="2"
                                                  viewBox="0 0 24 24"
                                              >
                                                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7" />
                                              </svg>
                                          </button>
                                      `}
                                  ></fc-tooltip>
                              </div>
                          `
                        : ''}
                </div>

                ${this._flows.length === 0
                    ? html`<div class="text-sm text-base-content/40 text-center py-8">Keine lokalen Flows gefunden</div>`
                    : this._filter && this._filtered(this._flows).length === 0
                      ? html`<div class="text-sm text-base-content/40 text-center py-4">Kein Treffer</div>`
                      : html`
                            ${sortedGroups.map(([groupName, items]) => {
                                const filtered = this._filtered(items)
                                if (filtered.length === 0) return ''
                                const collapsed = !this._filter && this._collapsedGroups.has(groupName)
                                return html`
                                    <div class="mb-1">
                                        <button
                                            class="flex items-center gap-1.5 w-full px-2 py-1 text-xs font-semibold text-base-content/50 uppercase tracking-wider hover:text-base-content/70 transition-colors"
                                            @click=${() => {
                                                const next = new Set(this._collapsedGroups)
                                                collapsed ? next.delete(groupName) : next.add(groupName)
                                                this._collapsedGroups = next
                                            }}
                                        >
                                            <svg
                                                class="w-3 h-3 transition-transform ${collapsed ? '-rotate-90' : ''}"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="2"
                                                viewBox="0 0 24 24"
                                            >
                                                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                                            </svg>
                                            <svg
                                                class="w-3 h-3 shrink-0"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="2"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v8.25A2.25 2.25 0 004.5 16.5h15a2.25 2.25 0 002.25-2.25V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                                                />
                                            </svg>
                                            <span class="flex-1 text-left">${groupName}</span>
                                            <span class="font-mono font-normal normal-case tracking-normal text-base-content/30"
                                                >${filtered.length}</span
                                            >
                                        </button>
                                        ${collapsed ? '' : filtered.map(f => this._renderFlowItem(f))}
                                    </div>
                                `
                            })}
                            ${ungrouped.length > 0
                                ? html`
                                      <div class="mb-1">
                                          ${sortedGroups.length > 0
                                              ? (() => {
                                                    const collapsed = !this._filter && this._collapsedGroups.has('__ungrouped__')
                                                    return html`
                                                        <button
                                                            class="flex items-center gap-1.5 w-full px-2 py-1 text-xs font-semibold text-base-content/50 uppercase tracking-wider hover:text-base-content/70 transition-colors"
                                                            @click=${() => {
                                                                const next = new Set(this._collapsedGroups)
                                                                collapsed ? next.delete('__ungrouped__') : next.add('__ungrouped__')
                                                                this._collapsedGroups = next
                                                            }}
                                                        >
                                                            <svg
                                                                class="w-3 h-3 transition-transform ${collapsed ? '-rotate-90' : ''}"
                                                                fill="none"
                                                                stroke="currentColor"
                                                                stroke-width="2"
                                                                viewBox="0 0 24 24"
                                                            >
                                                                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                                                            </svg>
                                                            <span class="flex-1 text-left">Ohne Gruppe</span>
                                                            <span
                                                                class="font-mono font-normal normal-case tracking-normal text-base-content/30"
                                                                >${ungrouped.length}</span
                                                            >
                                                        </button>
                                                        ${collapsed ? '' : ungrouped.map(f => this._renderFlowItem(f))}
                                                    `
                                                })()
                                              : ungrouped.map(f => this._renderFlowItem(f))}
                                      </div>
                                  `
                                : ''}
                        `}
            </div>
        `
    }

    _renderStatusIcon(cfg) {
        if (cfg.icon === 'x') {
            return html`
                <svg
                    class="w-3.5 h-3.5 text-${cfg.iconColor} shrink-0"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    viewBox="0 0 24 24"
                >
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
            `
        }
        if (cfg.icon === 'warning') {
            return html`
                <svg
                    class="w-3.5 h-3.5 text-${cfg.iconColor} shrink-0"
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
            `
        }
        return html`
            <svg
                class="w-3.5 h-3.5 text-${cfg.iconColor} shrink-0"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                viewBox="0 0 24 24"
            >
                <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
        `
    }

    _renderStatusLine(status, d) {
        const v = status.version
        const type = d.schema?.type
        switch (status.key) {
            case 'invalid':
                return html`
                    <span class="text-xs font-semibold text-error">Schema ungültig</span>
                    <span class="text-xs text-base-content/50">— ${d.error}</span>
                `
            case 'hashDrift':
                return html`
                    <span class="text-xs font-semibold text-orange-500">Schema ungültig — neue Version erforderlich</span>
                    <span class="w-full text-xs text-base-content/50">
                        Das Schema hat sich geändert, der Flow-Typ
                        <code class="font-mono bg-base-300/50 px-1 rounded">${type}</code>
                        ist bereits in der Datenbank gespeichert. Bitte den Versionsbezeichner von
                        <code class="font-mono bg-base-300/50 px-1 rounded">${v?.current ?? 'v1'}</code>
                        →
                        <code class="font-mono bg-base-300/50 px-1 rounded">${v?.next ?? 'v2'}</code>
                        erhöhen.
                    </span>
                `
            case 'newType':
                return html`
                    <span class="text-xs font-semibold text-info">Neuer Flow-Typ</span>
                    <span class="text-xs text-base-content/50"
                        >— Das Schema ist syntaktisch korrekt, aber
                        <code class="font-mono bg-base-300/50 px-1 rounded">${type}</code>
                        wurde noch nie registriert.</span
                    >
                `
            case 'newVersion':
                return html`
                    <span class="text-xs font-semibold text-info">Neue Version</span>
                    <span class="text-xs text-base-content/50"
                        >— Das Schema ist syntaktisch korrekt.
                        <code class="font-mono bg-base-300/50 px-1 rounded">${type}</code>
                        ist eine neue Version — eine frühere Version dieses Flow-Typs ist bereits registriert.</span
                    >
                `
            case 'messageDrift':
                return html`
                    <span class="text-xs font-semibold text-orange-500">Schema ungültig — neue Version erforderlich</span>
                    <span class="w-full text-xs text-base-content/50">
                        Der Schema-Hash stimmt überein, aber die Nachrichtenstruktur hat sich geändert. Bitte den Versionsbezeichner von
                        <code class="font-mono bg-base-300/50 px-1 rounded">${v?.current ?? 'v1'}</code>
                        →
                        <code class="font-mono bg-base-300/50 px-1 rounded">${v?.next ?? 'v2'}</code>
                        erhöhen.
                    </span>
                `
            default:
                return html`
                    <span class="text-xs font-semibold text-success">Schema gültig</span>
                    <span class="text-xs text-base-content/50"
                        >— Das Schema ist syntaktisch korrekt und entspricht der gespeicherten Version.</span
                    >
                `
        }
    }

    _renderRunButton(buttonColor) {
        return html`
            <div class="relative group/devtip ml-1 shrink-0">
                <button
                    class="btn btn-xs btn-${buttonColor} btn-outline"
                    ?disabled=${this._runModalLoading}
                    @click=${() => this._openRunModal()}
                >
                    ${this._runModalLoading
                        ? html`<span class="loading loading-spinner loading-xs"></span>`
                        : html`<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                              <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347c-.75.412-1.667-.13-1.667-.986V5.653z"
                              />
                          </svg>`}
                    ${this._runModalLoading ? 'Laden...' : 'Flow starten'}
                </button>
                <fc-info-box
                    class="pointer-events-none opacity-0 group-hover/devtip:opacity-100 transition-opacity absolute top-full left-1/2 -translate-x-1/2 mt-2 w-80 z-50"
                    title="Dev-Modus"
                    titleColor="text-info"
                    .content=${devModeTooltipContent()}
                ></fc-info-box>
            </div>
        `
    }

    _renderChangedMessages(status, d) {
        if (!status.hasChangedMessages) return ''
        return html`
            <div class="flex items-start gap-1.5 mt-1 flex-wrap">
                <svg
                    class="w-3.5 h-3.5 text-yellow-500 shrink-0 mt-0.5"
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
                <span class="text-xs font-semibold text-yellow-500">Nachrichtenstruktur geändert</span>
                <span class="text-xs text-base-content/50">
                    — Die verarbeiteten Flows werden nun als <strong>Readonly</strong> markiert.
                </span>
                <div class="w-full flex flex-wrap gap-1 mt-0.5 ml-5">
                    ${d.changedMessages.map(
                        m => html`
                            <span class="text-[10px] font-mono text-yellow-500/80 bg-yellow-500/10 px-1.5 py-0.5 rounded" title="${m.class}"
                                >${shortClass(m.class)}</span
                            >
                        `
                    )}
                </div>
            </div>
        `
    }

    _openVersionsModal() {
        this._versionsModal = true
        this.updateComplete.then(() => this.querySelector('#fc-dev-versions-modal')?.showModal())
    }

    _renderVersionsModal(d) {
        if (!this._versionsModal || !d?.schema) return ''
        const typeBase = d.schema.type?.replace(/\.v\d+$/, '')
        if (!typeBase) return ''

        const storedVersions = this._storedSchemas.filter(s => s.type?.replace(/\.v\d+$/, '') === typeBase)
        const importedSchemas = this._devImport?.schemas ?? {}
        const storedTypes = new Set(storedVersions.map(s => s.type))
        const importedVersions = Object.entries(importedSchemas)
            .filter(([type]) => type.replace(/\.v\d+$/, '') === typeBase && !storedTypes.has(type))
            .map(([type, imp]) => ({ type, steps: imp.steps ?? [], storedHash: imp.storedHash, fromImport: true }))
        const versions = [...storedVersions, ...importedVersions]
            .map(s => {
                const vMatch = s.type.match(/v(\d+)$/)
                return { ...s, vNum: vMatch ? parseInt(vMatch[1]) : 0 }
            })
            .sort((a, b) => b.vNum - a.vNum)

        const selected = this._versionsSelected ?? versions.find(v => v.type === d.schema.type) ?? versions[0] ?? null
        const currentSources = new Set((d.schema.steps ?? []).map(s => s.source))
        const selectedSources = new Set((selected?.steps ?? []).map(s => s.source))

        return html`
            <dialog
                id="fc-dev-versions-modal"
                class="modal"
                @close=${() => {
                    this._versionsModal = false
                    this._versionsSelected = null
                }}
            >
                <div class="modal-box w-[960px] max-w-[95vw] flex flex-col gap-0 p-0 overflow-hidden">
                    <div
                        class="bg-gradient-to-r from-info/10 via-info/5 to-transparent px-5 pt-4 pb-3 border-b border-base-300/50 shrink-0 cursor-move select-none"
                        @mousedown=${e => this._startModalDrag(e, 'fc-dev-versions-modal')}
                    >
                        <div class="flex items-center justify-between gap-3">
                            <div class="flex items-center gap-3 min-w-0">
                                <div class="w-8 h-8 rounded-lg bg-info/15 border border-info/20 flex items-center justify-center shrink-0">
                                    <svg class="w-4 h-4 text-info" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                        <path
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                            d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                                        />
                                    </svg>
                                </div>
                                <div class="min-w-0">
                                    <h3 class="font-bold text-sm leading-tight">Versionen</h3>
                                    <p class="text-[11px] font-mono text-base-content/40 mt-0.5 truncate">${typeBase}</p>
                                </div>
                            </div>
                            <button
                                class="btn btn-sm btn-ghost btn-circle shrink-0"
                                @click=${() => this.querySelector('#fc-dev-versions-modal')?.close()}
                            >
                                ✕
                            </button>
                        </div>
                    </div>
                    <div class="flex min-h-0" style="height: 560px">
                        <div
                            class="shrink-0 border-r border-base-300 bg-base-200/40 flex flex-col"
                            style="width: 224px; min-width: 224px; max-width: 50%"
                        >
                            <div class="px-4 py-3 border-b border-base-300/50 shrink-0">
                                <div class="text-[10px] font-semibold text-base-content/40 uppercase tracking-widest">
                                    ${versions.length} Versionen
                                </div>
                            </div>
                            <div class="flex-1 overflow-y-auto overflow-x-hidden p-2 flex flex-col gap-1">
                                ${versions.map(v => {
                                    const isCurrent = v.type === d.schema.type
                                    const isSelected = selected?.type === v.type
                                    return html`
                                        <button
                                            class="rounded-lg px-3 py-2 text-left transition-all ${isSelected
                                                ? 'bg-info/15 border border-info/30'
                                                : 'hover:bg-base-100 border border-transparent'}"
                                            @click=${() => (this._versionsSelected = v)}
                                        >
                                            <div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                                                <span class="font-mono text-xs font-semibold">${v.type}</span>
                                                ${isCurrent ? html`<span class="badge badge-xs badge-primary">aktuell</span>` : ''}
                                                ${v.fromImport
                                                    ? html`<fc-tooltip
                                                          text="Aus Schema Import"
                                                          .content=${html`<svg
                                                              class="w-3.5 h-3.5 text-warning/70 shrink-0"
                                                              fill="none"
                                                              stroke="currentColor"
                                                              stroke-width="2"
                                                              viewBox="0 0 24 24"
                                                          >
                                                              <path
                                                                  stroke-linecap="round"
                                                                  stroke-linejoin="round"
                                                                  d="M12 16v-8m0 8l-3-3m3 3l3-3M3 17v1a2 2 0 002 2h14a2 2 0 002-2v-1"
                                                              />
                                                          </svg>`}
                                                      ></fc-tooltip>`
                                                    : ''}
                                            </div>
                                            <div class="text-[10px] text-base-content/40 mt-0.5">${(v.steps ?? []).length} Steps</div>
                                        </button>
                                    `
                                })}
                            </div>
                        </div>
                        <div
                            class="w-1 shrink-0 cursor-col-resize bg-base-300/0 hover:bg-primary/30 active:bg-primary/50 transition-colors"
                            @mousedown=${e => {
                                const panel = e.target.previousElementSibling
                                const container = panel.parentElement
                                const startX = e.clientX
                                const startW = panel.offsetWidth
                                const maxW = Math.floor(container.offsetWidth * 0.5)
                                const onMove = ev => {
                                    const w = Math.min(maxW, Math.max(224, startW + ev.clientX - startX))
                                    panel.style.width = `${w}px`
                                }
                                const onUp = () => {
                                    document.removeEventListener('mousemove', onMove)
                                    document.removeEventListener('mouseup', onUp)
                                }
                                document.addEventListener('mousemove', onMove)
                                document.addEventListener('mouseup', onUp)
                            }}
                        ></div>
                        <div class="flex-1 overflow-y-auto p-4">
                            ${selected
                                ? html`
                                      <div class="flex items-center gap-2 mb-3">
                                          <span class="font-mono text-sm font-semibold">${selected.type}</span>
                                          ${selected.type === d.schema.type
                                              ? html`<span class="badge badge-xs badge-primary">aktuell</span>`
                                              : ''}
                                          ${selected.fromImport
                                              ? html`<fc-tooltip
                                                    text="Aus Schema Import"
                                                    .content=${html`<svg
                                                        class="w-3.5 h-3.5 text-warning/70 shrink-0"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        stroke-width="2"
                                                        viewBox="0 0 24 24"
                                                    >
                                                        <path
                                                            stroke-linecap="round"
                                                            stroke-linejoin="round"
                                                            d="M12 16v-8m0 8l-3-3m3 3l3-3M3 17v1a2 2 0 002 2h14a2 2 0 002-2v-1"
                                                        />
                                                    </svg>`}
                                                ></fc-tooltip>`
                                              : ''}
                                          ${(selected.hash ?? selected.storedHash)
                                              ? html`<span class="text-[10px] font-mono text-base-content/30 ml-auto"
                                                    >${(selected.hash ?? selected.storedHash).slice(0, 12)}</span
                                                >`
                                              : ''}
                                      </div>
                                      <div class="space-y-1.5">
                                          ${(selected.steps ?? []).map(s => {
                                              const inCurrent = currentSources.has(s.source)
                                              const gradientColor = !inCurrent ? 'from-error/10 to-info/5' : 'from-primary/10 to-info/5'
                                              return html`
                                                  <details
                                                      open
                                                      class="rounded-lg border cursor-pointer overflow-hidden ${inCurrent
                                                          ? 'border-base-300/60'
                                                          : 'border-error/20'}"
                                                  >
                                                      <summary class="px-3 py-2 flex items-center gap-2 bg-gradient-to-r ${gradientColor}">
                                                          ${!inCurrent
                                                              ? html`<span class="text-[10px] font-mono text-error shrink-0">−</span>`
                                                              : ''}
                                                          <div class="min-w-0 flex-1">
                                                              <div
                                                                  class="text-[10px] font-mono text-base-content/30 truncate leading-tight"
                                                              >
                                                                  ${s.source.split('\\').slice(0, -1).join('\\')}
                                                              </div>
                                                              <div class="text-xs font-mono font-semibold text-base-content/80 truncate">
                                                                  ${shortClass(s.source)}
                                                              </div>
                                                          </div>
                                                          <span class="text-[10px] text-base-content/30">${s.messageEnum ?? ''}</span>
                                                      </summary>
                                                      <div
                                                          class="px-3 pb-2 pt-1.5 border-t border-base-300/30 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[10px]"
                                                      >
                                                          <span class="text-base-content/35">Messages</span>
                                                          <span class="font-mono truncate">
                                                              ${s.messages?.length
                                                                  ? s.messages.map(
                                                                        (m, i) =>
                                                                            html`${i > 0 ? ', ' : ''}<span class="text-base-content/35"
                                                                                    >${m.split('\\').slice(0, -1).join('\\')
                                                                                        ? m.split('\\').slice(0, -1).join('\\') + '\\'
                                                                                        : ''}</span
                                                                                ><span class="text-base-content/70">${shortClass(m)}</span>`
                                                                    )
                                                                  : html`<span class="text-base-content/25 italic">keine</span>`}
                                                          </span>
                                                          <span class="text-base-content/35">Returns</span>
                                                          <span class="font-mono truncate">
                                                              ${s.returnTypes?.length
                                                                  ? s.returnTypes.map(
                                                                        (r, i) =>
                                                                            html`${i > 0 ? ', ' : ''}<span class="text-base-content/35"
                                                                                    >${r.split('\\').slice(0, -1).join('\\')
                                                                                        ? r.split('\\').slice(0, -1).join('\\') + '\\'
                                                                                        : ''}</span
                                                                                ><span class="text-base-content/70">${shortClass(r)}</span>`
                                                                    )
                                                                  : html`<span class="text-base-content/50">boolesche Rückgabe</span>`}
                                                          </span>
                                                          ${s.retries
                                                              ? html`
                                                                    <span class="text-base-content/35">Retries</span>
                                                                    <span class="font-mono text-base-content/50">${s.retries}</span>
                                                                `
                                                              : ''}
                                                          ${s.delay
                                                              ? html`
                                                                    <span class="text-base-content/35">Delay</span>
                                                                    <span class="font-mono text-base-content/50">${s.delay}ms</span>
                                                                `
                                                              : ''}
                                                          ${s.runOnce
                                                              ? html`
                                                                    <span class="text-base-content/35">RunOnce</span>
                                                                    <span class="font-mono text-base-content/50">ja</span>
                                                                `
                                                              : ''}
                                                      </div>
                                                  </details>
                                              `
                                          })}
                                          ${selected.type !== d.schema.type
                                              ? [...currentSources]
                                                    .filter(s => !selectedSources.has(s))
                                                    .map(src => {
                                                        const cs = (d.schema.steps ?? []).find(st => st.source === src)
                                                        return html`
                                                            <details
                                                                open
                                                                class="rounded-lg border border-success/20 cursor-pointer overflow-hidden"
                                                            >
                                                                <summary
                                                                    class="px-3 py-2 flex items-center gap-2 bg-gradient-to-r from-success/10 to-info/5"
                                                                >
                                                                    <span class="text-[10px] font-mono text-success shrink-0">+</span>
                                                                    <div class="min-w-0 flex-1">
                                                                        <div
                                                                            class="text-[10px] font-mono text-base-content/30 truncate leading-tight"
                                                                        >
                                                                            ${src.split('\\').slice(0, -1).join('\\')}
                                                                        </div>
                                                                        <div
                                                                            class="text-xs font-mono font-semibold text-base-content/80 truncate"
                                                                        >
                                                                            ${shortClass(src)}
                                                                        </div>
                                                                    </div>
                                                                    <span class="text-[10px] text-success/60">neu</span>
                                                                </summary>
                                                                <div
                                                                    class="px-3 pb-2 pt-1.5 border-t border-success/20 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[10px]"
                                                                >
                                                                    <span class="text-base-content/35">Messages</span>
                                                                    <span class="font-mono truncate">
                                                                        ${cs?.messages?.length
                                                                            ? cs.messages.map(
                                                                                  (m, i) =>
                                                                                      html`${i > 0 ? ', ' : ''}<span
                                                                                              class="text-base-content/35"
                                                                                              >${m.split('\\').slice(0, -1).join('\\')
                                                                                                  ? m.split('\\').slice(0, -1).join('\\') +
                                                                                                    '\\'
                                                                                                  : ''}</span
                                                                                          ><span class="text-base-content/70"
                                                                                              >${shortClass(m)}</span
                                                                                          >`
                                                                              )
                                                                            : html`<span class="text-base-content/25 italic">keine</span>`}
                                                                    </span>
                                                                    <span class="text-base-content/35">Returns</span>
                                                                    <span class="font-mono truncate">
                                                                        ${cs?.returnTypes?.length
                                                                            ? cs.returnTypes.map(
                                                                                  (r, i) =>
                                                                                      html`${i > 0 ? ', ' : ''}<span
                                                                                              class="text-base-content/35"
                                                                                              >${r.split('\\').slice(0, -1).join('\\')
                                                                                                  ? r.split('\\').slice(0, -1).join('\\') +
                                                                                                    '\\'
                                                                                                  : ''}</span
                                                                                          ><span class="text-base-content/70"
                                                                                              >${shortClass(r)}</span
                                                                                          >`
                                                                              )
                                                                            : html`<span class="text-base-content/50"
                                                                                  >boolesche Rückgabe</span
                                                                              >`}
                                                                    </span>
                                                                    ${cs?.retries
                                                                        ? html`
                                                                              <span class="text-base-content/35">Retries</span>
                                                                              <span class="font-mono text-base-content/50"
                                                                                  >${cs.retries}</span
                                                                              >
                                                                          `
                                                                        : ''}
                                                                    ${cs?.delay
                                                                        ? html`
                                                                              <span class="text-base-content/35">Delay</span>
                                                                              <span class="font-mono text-base-content/50"
                                                                                  >${cs.delay}ms</span
                                                                              >
                                                                          `
                                                                        : ''}
                                                                    ${cs?.runOnce
                                                                        ? html`
                                                                              <span class="text-base-content/35">RunOnce</span>
                                                                              <span class="font-mono text-base-content/50">ja</span>
                                                                          `
                                                                        : ''}
                                                                </div>
                                                            </details>
                                                        `
                                                    })
                                              : ''}
                                      </div>
                                  `
                                : html`
                                      <div class="flex items-center justify-center h-full text-base-content/30 text-sm">
                                          Version auswählen
                                      </div>
                                  `}
                        </div>
                    </div>
                </div>
                <form method="dialog" class="modal-backdrop">
                    <button>close</button>
                </form>
            </dialog>
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
        const status = resolveFlowStatus(d, this._storedSchemas)
        const cfg = status.config
        const typeBase = d.schema?.type?.replace(/\.v\d+$/, '')
        const allVersions = typeBase ? this._storedSchemas.filter(s => s.type?.replace(/\.v\d+$/, '') === typeBase) : []

        return html`
            <div class="flex flex-col h-full overflow-hidden">
                <!-- Header -->
                <div
                    class="px-5 py-3 border-b border-base-300/50 shrink-0 bg-gradient-to-br via-transparent to-transparent ${cfg.headerBg}"
                >
                    <div class="flex items-start gap-3">
                        <div class="flex flex-col items-center shrink-0 mt-0.5 self-stretch">
                            <div class="w-9 h-9 rounded-lg text-${cfg.color} flex items-center justify-center">
                                <svg class="w-4.5 h-4.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
                                    />
                                </svg>
                            </div>
                            ${allVersions.length >= 1
                                ? html`<fc-tooltip
                                      class="mt-auto"
                                      text="${allVersions.length} Versionen"
                                      .content=${html`
                                          <button
                                              class="w-9 h-9 rounded-lg bg-info/10 text-info flex items-center justify-center hover:bg-info/20 transition-colors cursor-pointer"
                                              @click=${() => this._openVersionsModal()}
                                          >
                                              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                                  <path
                                                      stroke-linecap="round"
                                                      stroke-linejoin="round"
                                                      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                                                  />
                                              </svg>
                                          </button>
                                      `}
                                  ></fc-tooltip>`
                                : ''}
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-2">
                                <div class="font-bold text-base leading-tight">${shortClass(this._selected)}</div>
                                ${d.ephemeral !== null && d.ephemeral !== undefined
                                    ? html`<span class="fc-ephemeral-badge">
                                          <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                                              <path
                                                  stroke-linecap="round"
                                                  stroke-linejoin="round"
                                                  d="M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                              />
                                          </svg>
                                          Ephemeral<span class="fc-ephemeral-sep">·</span>${d.ephemeral} Tage
                                      </span>`
                                    : ''}
                            </div>
                            ${d.schema?.type ? html`<div class="text-xs font-mono text-base-content/50 mt-0.5">${d.schema.type}</div>` : ''}
                            ${selectedFlow?.file
                                ? html`<div class="text-[10px] text-base-content/30 mt-1 truncate font-mono">${selectedFlow.file}</div>`
                                : ''}
                            <div class="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                ${this._renderStatusIcon(cfg)} ${this._renderStatusLine(status, d)}
                                ${cfg.showButton ? this._renderRunButton(cfg.buttonColor) : ''}
                            </div>
                            ${this._renderChangedMessages(status, d)}
                        </div>
                        ${d.hash
                            ? html`
                                  <div class="flex flex-col items-end gap-0.5 shrink-0">
                                      <span class="text-[10px] text-base-content/30 uppercase tracking-wide">Schema-Hash</span>
                                      <span class="text-xs font-mono text-base-content/40">${d.hash}</span>
                                  </div>
                              `
                            : ''}
                    </div>
                </div>

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
                                                ${this._lastRunMemory
                                                    ? html`<span class="text-base-content/40 font-mono"
                                                          >${formatBytes(this._lastRunMemory.used)} /
                                                          ${formatBytes(this._lastRunMemory.peak)} Peak</span
                                                      >`
                                                    : ''}
                                                ${durLabel ? html`<span class="text-base-content/40 font-mono">${durLabel}</span>` : ''}
                                            </div>
                                            <div class="flex items-center gap-1">
                                                <fc-tooltip
                                                    text="Raw JSON"
                                                    .content=${html`
                                                        <button
                                                            class="btn btn-ghost btn-xs btn-circle"
                                                            @click=${() => {
                                                                this._devRawModal = true
                                                                this.updateComplete.then(() =>
                                                                    this.querySelector('#fc-dev-raw-modal')?.showModal()
                                                                )
                                                            }}
                                                        >
                                                            <svg
                                                                class="w-3.5 h-3.5"
                                                                fill="none"
                                                                stroke="currentColor"
                                                                stroke-width="2"
                                                                viewBox="0 0 24 24"
                                                            >
                                                                <path
                                                                    stroke-linecap="round"
                                                                    stroke-linejoin="round"
                                                                    d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
                                                                />
                                                            </svg>
                                                        </button>
                                                    `}
                                                ></fc-tooltip>
                                                <fc-tooltip
                                                    text="Schema-Ansicht"
                                                    .content=${html`
                                                        <button
                                                            class="btn btn-ghost btn-xs btn-circle"
                                                            @click=${() => {
                                                                this._lastRunFlow = null
                                                                this._lastRunMemory = null
                                                            }}
                                                        >
                                                            <svg
                                                                class="w-3.5 h-3.5"
                                                                fill="none"
                                                                stroke="currentColor"
                                                                stroke-width="2"
                                                                viewBox="0 0 24 24"
                                                            >
                                                                <path
                                                                    stroke-linecap="round"
                                                                    stroke-linejoin="round"
                                                                    d="M6 18L18 6M6 6l12 12"
                                                                />
                                                            </svg>
                                                        </button>
                                                    `}
                                                ></fc-tooltip>
                                            </div>
                                        </div>
                                    `
                                })()
                              : ''}
                          <div class="flex-1 overflow-auto m-3">
                              ${(() => {
                                  const graphRun = this._lastRunFlow ? (buildRuns(this._lastRunFlow).at(-1) ?? null) : null
                                  const graphFlow = this._lastRunFlow ?? this._syntheticFlow(d.schema)
                                  const stepDiff = this._lastRunFlow
                                      ? null
                                      : (() => {
                                            const messageDriftMap = Object.fromEntries((d.changedMessages ?? []).map(m => [m.class, m]))
                                            const messageDriftClasses = new Set(Object.keys(messageDriftMap))
                                            const base = d.storedSchema
                                                ? d.hashDrift
                                                    ? computeStepDiff(d.schema.steps, d.storedSchema.steps)
                                                    : Object.fromEntries(
                                                          (d.schema.steps ?? []).map(s => [
                                                              s.source,
                                                              { status: 'unchanged', changes: null },
                                                          ])
                                                      )
                                                : status.storedNone
                                                  ? Object.fromEntries(
                                                        (d.schema.steps ?? []).map(s => [s.source, { status: 'added', changes: null }])
                                                    )
                                                  : {}
                                            const diff = { ...base }
                                            for (const step of d.schema.steps ?? []) {
                                                const affectedMessages = [...step.messages, ...step.returnTypes].filter(m =>
                                                    messageDriftClasses.has(m)
                                                )
                                                if (affectedMessages.length > 0 && diff[step.source]?.status !== 'added') {
                                                    diff[step.source] = {
                                                        status: 'messageDrift',
                                                        changes: {
                                                            properties: affectedMessages.map(m => ({
                                                                class: m,
                                                                live: messageDriftMap[m]?.liveProperties ?? [],
                                                                stored: messageDriftMap[m]?.storedProperties ?? [],
                                                                livePropertyNames: messageDriftMap[m]?.livePropertyNames ?? {},
                                                                storedPropertyNames: messageDriftMap[m]?.storedPropertyNames ?? {},
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
                                          .showStepConfig=${true}
                                          .stepDiff=${stepDiff}
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

                <!-- Removed steps banner -->
                ${d.hashDrift && d.storedSchema && removedSteps(d.schema.steps, d.storedSchema.steps).length > 0
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
                                      <div class="font-semibold text-error text-sm">Entfernte Steps</div>
                                      <div class="text-xs text-base-content/60 mt-1">
                                          Folgende Steps existieren nicht mehr im aktuellen Schema.
                                      </div>
                                      <ul class="mt-2 flex flex-col gap-0.5">
                                          ${removedSteps(d.schema.steps, d.storedSchema.steps).map(
                                              step => html`
                                                  <li class="text-xs font-mono text-error/80 flex items-center gap-1.5">
                                                      <span class="text-error font-bold">−</span>
                                                      ${shortClass(step.source)}
                                                      <span class="text-base-content/30" title="${step.source}">${step.source}</span>
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
                        <div class="flex items-center gap-0.5">
                            <button
                                class="btn btn-xs gap-1 ${this._devImport ? 'btn-success btn-outline' : 'btn-ghost text-base-content/50'}"
                                @click=${() => this.querySelector('#fc-dev-import-modal')?.showModal()}
                            >
                                <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        d="M12 16v-8m0 8l-3-3m3 3l3-3M3 17v1a2 2 0 002 2h14a2 2 0 002-2v-1"
                                    />
                                </svg>
                                <span class="text-[10px]">Schema Import</span>
                            </button>
                            <fc-tooltip
                                text="Neu laden"
                                .content=${html`
                                    <button
                                        class="btn btn-xs btn-ghost btn-circle"
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
                                `}
                            ></fc-tooltip>
                        </div>
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
                                    <fc-tooltip
                                        text="Init-Message neu laden"
                                        .content=${html`
                                            <button
                                                class="btn btn-xs btn-ghost btn-circle shrink-0"
                                                ?disabled=${this._runModalLoading}
                                                @click=${() => this._loadRunModalData(true)}
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
                                        `}
                                    ></fc-tooltip>
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
                                ? (() => {
                                      const isEmptyInit = shortClass(this._initMessageClass(this._detail?.schema)) === 'EmptyInitMessage'
                                      return html`
                                          <div class="flex flex-col gap-1.5 flex-1 min-h-0">
                                              <div class="flex items-center gap-2">
                                                  <span class="text-[10px] font-semibold text-base-content/40 uppercase tracking-widest"
                                                      >Payload</span
                                                  >
                                                  <span class="text-[10px] font-mono text-base-content/25"
                                                      >${shortClass(this._initMessageClass(this._detail?.schema))}</span
                                                  >
                                                  ${isEmptyInit
                                                      ? ''
                                                      : html`
                                                            <div class="flex items-center gap-0.5 ml-auto">
                                                                <fc-tooltip
                                                                    text="Inhalt kopieren"
                                                                    .content=${html`
                                                                        <button
                                                                            class="btn btn-xs btn-ghost btn-circle"
                                                                            @click=${() => navigator.clipboard.writeText(this._runPayload)}
                                                                        >
                                                                            <svg
                                                                                class="w-3.5 h-3.5"
                                                                                fill="none"
                                                                                stroke="currentColor"
                                                                                stroke-width="2"
                                                                                viewBox="0 0 24 24"
                                                                            >
                                                                                <rect
                                                                                    x="9"
                                                                                    y="9"
                                                                                    width="13"
                                                                                    height="13"
                                                                                    rx="2"
                                                                                    ry="2"
                                                                                ></rect>
                                                                                <path
                                                                                    d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"
                                                                                ></path>
                                                                            </svg>
                                                                        </button>
                                                                    `}
                                                                ></fc-tooltip>
                                                                <fc-tooltip
                                                                    text="Aus Zwischenablage einfügen"
                                                                    .content=${html`
                                                                        <button
                                                                            class="btn btn-xs btn-ghost btn-circle"
                                                                            @click=${async () => {
                                                                                try {
                                                                                    const text = await navigator.clipboard.readText()
                                                                                    this._runPayload = text
                                                                                } catch {
                                                                                    // Clipboard-Zugriff verweigert
                                                                                }
                                                                            }}
                                                                        >
                                                                            <svg
                                                                                class="w-3.5 h-3.5"
                                                                                fill="none"
                                                                                stroke="currentColor"
                                                                                stroke-width="2"
                                                                                viewBox="0 0 24 24"
                                                                            >
                                                                                <path
                                                                                    stroke-linecap="round"
                                                                                    stroke-linejoin="round"
                                                                                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                                                                                />
                                                                            </svg>
                                                                        </button>
                                                                    `}
                                                                ></fc-tooltip>
                                                            </div>
                                                        `}
                                              </div>
                                              <fc-json-editor
                                                  class="flex-1 min-h-0"
                                                  .value=${this._runPayload}
                                                  .readonly=${isEmptyInit}
                                                  @change=${e => {
                                                      this._runPayload = e.detail.value
                                                      this._runMessage = e.detail.valid ? e.detail.value : this._runMessage
                                                      this._runMessageValid = e.detail.valid
                                                  }}
                                              ></fc-json-editor>
                                          </div>
                                      `
                                  })()
                                : ''}
                            ${this._renderRunError()}
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

            <!-- Run Error Detail Modal -->
            <dialog id="fc-dev-run-error-modal" class="modal">
                <div class="modal-box w-[1100px] max-w-[95vw] flex flex-col gap-0 p-0 overflow-hidden" style="height: 85vh">
                    <!-- Header -->
                    <div
                        class="bg-gradient-to-r from-error/10 via-error/5 to-transparent px-5 pt-4 pb-3 border-b border-base-300/50 shrink-0 cursor-move select-none"
                        @mousedown=${e => this._startModalDrag(e, 'fc-dev-run-error-modal')}
                    >
                        <div class="flex items-center justify-between gap-3">
                            <div class="flex items-center gap-3 min-w-0">
                                <div
                                    class="w-8 h-8 rounded-lg bg-error/15 border border-error/20 flex items-center justify-center shrink-0"
                                >
                                    <svg class="w-4 h-4 text-error" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                        <path
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                            d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                                        />
                                    </svg>
                                </div>
                                <div class="min-w-0">
                                    <h3 class="font-bold text-sm leading-tight text-error">Fehlerdetails</h3>
                                    <p class="text-[11px] font-mono text-base-content/40 mt-0.5 truncate">${this._selected}</p>
                                </div>
                            </div>
                            <button
                                class="btn btn-sm btn-ghost btn-circle shrink-0"
                                @click=${() => this.querySelector('#fc-dev-run-error-modal')?.close()}
                            >
                                ✕
                            </button>
                        </div>
                    </div>
                    <!-- Tabs (nur wenn auch Console Output vorhanden) -->
                    ${(this._lastRunOutput ?? []).length
                        ? html`
                              <div role="tablist" class="tabs tabs-border px-5 shrink-0 border-b border-base-300/50">
                                  <button
                                      role="tab"
                                      class="tab gap-1.5 ${this._errorModalTab === 'error' ? 'tab-active' : ''}"
                                      @click=${() => {
                                          this._errorModalTab = 'error'
                                      }}
                                  >
                                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                          <path
                                              stroke-linecap="round"
                                              stroke-linejoin="round"
                                              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                                          />
                                      </svg>
                                      Fehlerdetails
                                  </button>
                                  <button
                                      role="tab"
                                      class="tab gap-1.5 ${this._errorModalTab === 'output' ? 'tab-active' : ''}"
                                      @click=${() => {
                                          this._errorModalTab = 'output'
                                      }}
                                  >
                                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                          <path
                                              stroke-linecap="round"
                                              stroke-linejoin="round"
                                              d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                                          />
                                      </svg>
                                      Console Output
                                  </button>
                              </div>
                          `
                        : ''}
                    <!-- Body -->
                    <div class="overflow-y-auto flex-1 ${this._errorModalTab === 'output' ? 'flex flex-col min-h-0 p-0' : 'p-6'}">
                        ${this._errorModalTab === 'error' || !(this._lastRunOutput ?? []).length
                            ? (() => {
                                  const err =
                                      this._runError ??
                                      (this._runResult && !this._runResult.success
                                          ? { message: this._runResult.error, ...this._runResult }
                                          : null)
                                  if (!err) return ''
                                  return html` ${renderApiError(err, { detailed: true })} `
                              })()
                            : html`
                                  <div class="flex flex-1 min-h-0 overflow-hidden">
                                      ${(this._lastRunOutput ?? []).length > 1
                                          ? html`
                                                <div
                                                    class="w-48 shrink-0 border-r border-base-300/60 bg-base-200/40 flex flex-col overflow-y-auto"
                                                >
                                                    <div class="flex flex-col py-1.5 gap-0.5 px-2">
                                                        ${(this._lastRunOutput ?? []).map(
                                                            entry => html`
                                                                <button
                                                                    class="px-3 py-1.5 text-left text-xs font-mono rounded-lg truncate transition-colors ${this
                                                                        ._outputModalSelectedStep === entry.class
                                                                        ? 'bg-base-300/60 text-base-content font-medium'
                                                                        : 'hover:bg-base-300/50 text-base-content/70'}"
                                                                    @click=${() => {
                                                                        this._outputModalSelectedStep = entry.class
                                                                    }}
                                                                >
                                                                    ${entry.class.split('\\').at(-1)}
                                                                </button>
                                                            `
                                                        )}
                                                    </div>
                                                </div>
                                            `
                                          : ''}
                                      <div
                                          class="flex-1 overflow-auto p-4 font-mono text-xs whitespace-pre-wrap [&_pre]:whitespace-pre-wrap [&_pre]:m-0 text-base-content/80"
                                      >
                                          ${(() => {
                                              const allStyles = (this._lastRunOutput ?? [])
                                                  .flatMap(e => [...e.content.matchAll(/<style[\s\S]*?<\/style>/gi)])
                                                  .map(m => m[0])
                                                  .join('')
                                              const selected = (
                                                  (this._lastRunOutput ?? []).find(e => e.class === this._outputModalSelectedStep)
                                                      ?.content ?? ''
                                              ).trim()
                                              return unsafeHTML(allStyles + selected)
                                          })()}
                                      </div>
                                  </div>
                              `}
                    </div>
                    <!-- Footer -->
                    <div class="px-5 pb-4 pt-3 border-t border-base-300/50 flex justify-end shrink-0">
                        <button class="btn btn-sm btn-ghost" @click=${() => this.querySelector('#fc-dev-run-error-modal')?.close()}>
                            Schließen
                        </button>
                    </div>
                </div>
                <form method="dialog" class="modal-backdrop">
                    <button @click=${() => this.querySelector('#fc-dev-run-error-modal')?.close()}>close</button>
                </form>
            </dialog>

            <!-- Console Output Modal -->
            <dialog
                id="fc-dev-output-modal"
                class="modal"
                @close=${() => {
                    const box = this.querySelector('#fc-dev-output-modal .modal-box')
                    if (box) {
                        box.style.position = ''
                        box.style.margin = ''
                        box.style.left = ''
                        box.style.top = ''
                    }
                }}
            >
                <div class="modal-box w-[800px] max-w-[95vw] flex flex-col gap-0 p-0 overflow-hidden relative" style="height: 500px">
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
                    <div class="flex flex-1 min-h-0 overflow-hidden">
                        <!-- Left: Step list -->
                        <div class="w-64 shrink-0 border-r border-base-300 bg-base-200/40 flex flex-col overflow-y-auto">
                            <div class="px-4 py-3 border-b border-base-300/50 shrink-0">
                                <div class="text-[10px] font-semibold text-base-content/40 uppercase tracking-widest">Steps mit Output</div>
                            </div>
                            <div class="flex flex-col flex-1 overflow-y-auto py-1.5 gap-0.5 px-2">
                                ${(this._lastRunOutput ?? []).map(
                                    entry => html`
                                        <button
                                            class="px-3 py-2 text-left text-xs font-mono rounded-lg truncate transition-colors ${this
                                                ._outputModalSelectedStep === entry.class
                                                ? 'bg-base-300/60 text-base-content font-medium'
                                                : 'hover:bg-base-300/50 text-base-content/70'}"
                                            @click=${() => {
                                                this._outputModalSelectedStep = entry.class
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
                                    (this._lastRunOutput ?? []).find(e => e.class === this._outputModalSelectedStep)?.content ?? ''
                                ).trim()
                                return unsafeHTML(allStyles + selected)
                            })()}
                        </div>
                    </div>
                    <!-- Resize Handle -->
                    <div
                        class="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize opacity-25 hover:opacity-60 transition-opacity"
                        @mousedown=${e => this._startModalResize(e, 'fc-dev-output-modal')}
                    >
                        <svg viewBox="0 0 10 10" class="w-full h-full text-base-content/60" fill="currentColor">
                            <path
                                d="M8 2L2 8M6 2L2 6M10 2L2 10"
                                stroke="currentColor"
                                stroke-width="1.5"
                                stroke-linecap="round"
                                fill="none"
                            />
                        </svg>
                    </div>
                </div>
                <form method="dialog" class="modal-backdrop"><button>close</button></form>
            </dialog>

            ${this._renderVersionsModal(this._detail)}

            <!-- Raw JSON Modal -->
            <dialog
                id="fc-dev-raw-modal"
                class="modal backdrop-blur-sm"
                @close=${() => {
                    this._devRawModal = false
                }}
            >
                ${this._devRawModal && this._lastRunFlow
                    ? html`
                          <div class="modal-box w-[95vw] max-w-[95vw] h-[90vh] max-h-[90vh] p-0 flex flex-col overflow-hidden">
                              <!-- Header -->
                              <div class="bg-gradient-to-br from-primary/10 via-secondary/5 to-transparent px-5 pt-4 pb-3 flex-shrink-0">
                                  <div class="flex items-center justify-between">
                                      <div class="flex items-center gap-3">
                                          <div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                                              <svg
                                                  class="w-5 h-5 text-primary"
                                                  fill="none"
                                                  stroke="currentColor"
                                                  stroke-width="2"
                                                  viewBox="0 0 24 24"
                                              >
                                                  <path
                                                      stroke-linecap="round"
                                                      stroke-linejoin="round"
                                                      d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
                                                  />
                                              </svg>
                                          </div>
                                          <div>
                                              <h3 class="font-bold text-base leading-tight">Raw JSON</h3>
                                              <div class="flex items-center gap-2">
                                                  <span class="font-mono text-xs text-base-content/50">${this._lastRunFlow.flowHash}</span>
                                                  <span class="font-mono text-xs text-base-content/40">·</span>
                                                  <span class="font-mono text-xs text-base-content/40"
                                                      >${(() => {
                                                          const bytes = new Blob([JSON.stringify(this._lastRunFlow, null, 2)]).size
                                                          return bytes >= 1024 * 1024
                                                              ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
                                                              : `${(bytes / 1024).toFixed(2)} KB`
                                                      })()}</span
                                                  >
                                              </div>
                                          </div>
                                      </div>
                                      <div class="flex items-center gap-2">
                                          <fc-tooltip
                                              text="JSON kopieren"
                                              .content=${html`
                                                  <button
                                                      class="btn btn-ghost btn-sm"
                                                      @click=${() =>
                                                          navigator.clipboard.writeText(JSON.stringify(this._lastRunFlow, null, 2))}
                                                  >
                                                      <svg
                                                          class="w-4 h-4"
                                                          fill="none"
                                                          stroke="currentColor"
                                                          stroke-width="2"
                                                          viewBox="0 0 24 24"
                                                      >
                                                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                                          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                                                      </svg>
                                                  </button>
                                              `}
                                          ></fc-tooltip>
                                          <button
                                              class="btn btn-ghost btn-sm btn-square btn-circle"
                                              @click=${() => this.querySelector('#fc-dev-raw-modal')?.close()}
                                          >
                                              ✕
                                          </button>
                                      </div>
                                  </div>
                              </div>
                              <!-- Editor -->
                              <div class="flex-1 overflow-hidden relative">
                                  <fc-json-editor
                                      .value=${JSON.stringify(this._lastRunFlow, null, 2)}
                                      .readonly=${true}
                                      .search=${true}
                                  ></fc-json-editor>
                              </div>
                          </div>
                          <form method="dialog" class="modal-backdrop">
                              <button @click=${() => this.querySelector('#fc-dev-raw-modal')?.close()}>close</button>
                          </form>
                      `
                    : ''}
            </dialog>

            <!-- Prod Import Modal -->
            <dialog id="fc-dev-import-modal" class="modal">
                <div class="modal-box w-[580px] max-w-[95vw] flex flex-col gap-0 p-0 overflow-hidden">
                    <!-- Header -->
                    <div
                        class="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-5 pt-4 pb-3 border-b border-base-300/50 shrink-0 cursor-move select-none"
                        @mousedown=${e => this._startModalDrag(e, 'fc-dev-import-modal')}
                    >
                        <div class="flex items-center justify-between gap-3">
                            <div class="flex items-center gap-3 min-w-0">
                                <div
                                    class="w-8 h-8 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0"
                                >
                                    <svg
                                        class="w-4 h-4 text-primary"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                            d="M12 16v-8m0 8l-3-3m3 3l3-3M3 17v1a2 2 0 002 2h14a2 2 0 002-2v-1"
                                        />
                                    </svg>
                                </div>
                                <div class="min-w-0">
                                    <h3 class="font-bold text-sm leading-tight">Schema Import</h3>
                                    <p class="text-[11px] text-base-content/40 mt-0.5">
                                        Schemas und MessageSources von einer FlowCrafter-Service-Instanz importieren
                                    </p>
                                </div>
                            </div>
                            <button
                                class="btn btn-sm btn-ghost btn-circle shrink-0"
                                @click=${() => this.querySelector('#fc-dev-import-modal')?.close()}
                            >
                                ✕
                            </button>
                        </div>
                    </div>
                    <!-- Body -->
                    <div class="flex divide-x divide-base-300/50 min-h-[240px]">
                        <!-- Left: Formular -->
                        <div class="flex flex-col gap-4 p-5 flex-1">
                            <div class="flex flex-col gap-1.5">
                                <label class="text-xs font-semibold text-base-content/60 uppercase tracking-wide"
                                    >Url vom PHP-Backend API Service</label
                                >
                                <input
                                    type="url"
                                    class="input input-sm input-bordered font-mono text-xs w-full"
                                    placeholder="http://localhost:8000"
                                    .value=${this._importUrl}
                                    @input=${e => (this._importUrl = e.target.value)}
                                />
                            </div>
                            <div class="flex flex-col gap-1.5">
                                <label class="text-xs font-semibold text-base-content/60 uppercase tracking-wide">Secret</label>
                                <input
                                    type="password"
                                    class="input input-sm input-bordered font-mono text-xs w-full"
                                    placeholder="Secret"
                                    .value=${this._importSecret}
                                    @input=${e => (this._importSecret = e.target.value)}
                                />
                            </div>
                            ${this._importModalError
                                ? html`<div class="text-xs text-error bg-error/5 border border-error/20 rounded-lg px-3 py-2">
                                      ${this._importModalError}
                                  </div>`
                                : ''}
                            <button
                                class="btn btn-sm btn-primary mt-auto w-full"
                                ?disabled=${this._importModalLoading || !this._importUrl}
                                @click=${async () => {
                                    this._importModalLoading = true
                                    this._importModalError = null
                                    try {
                                        const result = await api.saveDevImport({
                                            url: this._importUrl,
                                            secret: this._importSecret,
                                        })
                                        this._devImport = result
                                        if (this._selected) this._selectFlow(this._selected)
                                    } catch (err) {
                                        this._importModalError = err.message
                                    } finally {
                                        this._importModalLoading = false
                                    }
                                }}
                            >
                                ${this._importModalLoading
                                    ? html`<span class="loading loading-spinner loading-xs"></span> Importiere…`
                                    : html`<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                              <path
                                                  stroke-linecap="round"
                                                  stroke-linejoin="round"
                                                  d="M12 16v-8m0 8l-3-3m3 3l3-3M3 17v1a2 2 0 002 2h14a2 2 0 002-2v-1"
                                              />
                                          </svg>
                                          Daten importieren`}
                            </button>
                        </div>
                        <!-- Right: Aktueller Import -->
                        <div class="flex flex-col p-5 w-64 shrink-0">
                            <span class="text-xs font-semibold text-base-content/60 uppercase tracking-wide mb-3">Aktueller Import</span>
                            ${this._devImport
                                ? html`
                                      <div class="flex flex-col gap-2 text-xs flex-1">
                                          <div class="flex flex-col gap-0.5">
                                              <span class="text-base-content/40 uppercase tracking-wide text-[10px]">Quelle</span>
                                              <button
                                                  class="font-mono text-base-content/70 break-all text-left hover:text-primary hover:underline cursor-pointer transition-colors"
                                                  @click=${() => (this._importUrl = this._devImport.sourceUrl)}
                                              >
                                                  ${this._devImport.sourceUrl}
                                              </button>
                                          </div>
                                          <div class="flex flex-col gap-0.5">
                                              <span class="text-base-content/40 uppercase tracking-wide text-[10px]">Importiert am</span>
                                              <span class="text-base-content/70"
                                                  >${new Date(this._devImport.importedAt).toLocaleString('de-DE')}</span
                                              >
                                          </div>
                                          <div class="flex flex-col gap-0.5">
                                              <span class="text-base-content/40 uppercase tracking-wide text-[10px]">Schemas</span>
                                              <span class="font-semibold text-success">${this._devImport.schemaCount}</span>
                                          </div>
                                          <div class="flex flex-col gap-0.5">
                                              <span class="text-base-content/40 uppercase tracking-wide text-[10px]">Message Sources</span>
                                              <span
                                                  class="font-semibold ${this._devImport.messageSourceCount > 0
                                                      ? 'text-success'
                                                      : 'text-base-content/30'}"
                                                  >${this._devImport.messageSourceCount ?? 0}</span
                                              >
                                          </div>
                                          <button
                                              class="btn btn-sm btn-error btn-outline mt-auto"
                                              @click=${async () => {
                                                  await api.clearDevImport()
                                                  this._devImport = null
                                                  if (this._selected) this._selectFlow(this._selected)
                                              }}
                                          >
                                              Import löschen
                                          </button>
                                      </div>
                                  `
                                : html`<p class="text-xs text-base-content/30 italic">Kein Import vorhanden</p>`}
                        </div>
                    </div>
                </div>
                <form method="dialog" class="modal-backdrop backdrop-blur-sm">
                    <button @click=${() => this.querySelector('#fc-dev-import-modal')?.close()}>close</button>
                </form>
            </dialog>

            <!-- Step Source Modal -->
            <dialog id="fc-dev-source-modal" class="modal">
                <div class="modal-box w-[95vw] max-w-[95vw] h-[90vh] max-h-[90vh] p-0 flex flex-col overflow-hidden">
                    <div class="bg-gradient-to-br from-primary/10 via-secondary/5 to-transparent px-5 pt-4 pb-3 flex-shrink-0">
                        <div class="flex items-center justify-between">
                            <div>
                                <h3 class="font-bold text-base">Step Source</h3>
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

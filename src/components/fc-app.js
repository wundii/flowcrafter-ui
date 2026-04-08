import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'
import { auth } from '../services/auth.js'
import { connection } from '../services/connection.js'
import { logoIcon } from '../assets/logo.js'
import { theme } from '../services/theme.js'
import './fc-exception-chart.js'
import './fc-exception-list.js'
import './fc-flow-chart.js'
import './fc-flow-detail.js'
import './fc-flow-list.js'
import './fc-login.js'
import './fc-overview.js'
import './fc-queue-chart.js'
import './fc-queue-list.js'
import './fc-schedule-list.js'
import './fc-schema-list.js'
import './fc-service-setup.js'
import './fc-type-list.js'

const TABS = ['overview', 'schemas', 'flows', 'exceptions', 'schedules', 'queues']
const SEARCH_LIMIT = 5

function workerAgeSecs(heartbeatIso) {
    return Math.floor((Date.now() - new Date(heartbeatIso).getTime()) / 1000)
}

function workerAgeLabel(secs) {
    if (secs < 60) return `vor ${secs}s`
    if (secs < 3600) return `vor ${Math.floor(secs / 60)}min`
    return `vor ${Math.floor(secs / 3600)}h`
}

function workerAgeColor(secs) {
    if (secs < 30) return 'success'
    if (secs < 300) return 'warning'
    return 'error'
}

function schedulerAgeColor(secs) {
    if (secs < 90) return 'success'
    if (secs < 120) return 'warning'
    return 'error'
}

export class FcApp extends BaseElement {
    static properties = {
        _aiConfigured: { state: true },
        _aiModal: { state: true },
        _aiModel: { state: true },
        _aiModels: { state: true },
        _authed: { state: true },
        _checkingConnection: { state: true },
        _confirmResetConnection: { state: true },
        _editingConnection: { state: true },
        _excChartDate: { state: true },
        _flowChartDate: { state: true },
        _flowListCache: { state: true },
        _isDark: { state: true },
        _pwModal: { state: true },
        _searchQuery: { state: true },
        _searchResults: { state: true },
        _serverDescription: { state: true },
        _serverInfo: { state: true },
        _serverOffline: { state: true },
        _serviceReady: { state: true },
        _toolboxOpen: { state: true },
        activeTab: { state: true },
        selectedFlowHash: { state: true },
        selectedPrefix: { state: true },
        selectedRuntimeHash: { state: true },
    }

    constructor() {
        super()
        this._aiConfigured = false
        this._aiModal = null
        this._aiModel = null
        this._aiModels = []
        this._authed = false
        this._editingConnection = false
        this._excChartDate = null
        this._flowChartDate = null
        this._flowListCache = null
        this._infoTimer = null
        this._isDark = theme.get() === 'dark'
        this._pwModal = null
        this._searchQuery = ''
        this._searchResults = null
        this._serverDescription = null
        this._serverInfo = null
        this._serverOffline = false
        this._serviceReady = false
        this._toolboxOpen = false
        this.activeTab = 'overview'
        this.selectedFlowHash = null
        this.selectedPrefix = null
        this.selectedRuntimeHash = null
    }

    async connectedCallback() {
        super.connectedCallback()
        this._onDocClick = e => {
            if (this._searchResults && !e.target.closest('.fc-search-input, .fc-search-input + button, .fc-search-dropdown')) {
                this._searchResults = null
            }
        }
        document.addEventListener('click', this._onDocClick)
        if (auth.isAuthenticated()) {
            const s = await auth.status()
            this._authed = s.authenticated
            if (this._authed) {
                await connection.load()
                this._serviceReady = connection.isConfigured()
                if (this._serviceReady) {
                    this._loadInfo()
                    this._startInfoPolling()
                }
                this._loadAiConfig()
            }
        }
    }

    async _loadAiConfig() {
        try {
            const config = await api.getAiConfig()
            this._aiConfigured = config.configured
            this._aiModel = config.model ?? null
            this._aiModels = config.models ?? []
        } catch {
            this._aiConfigured = false
        }
    }

    _openAiModal() {
        this._aiModal = { error: null, loading: false }
        this.updateComplete.then(() => this.querySelector('#ai-config-modal')?.showModal())
    }

    _closeAiModal() {
        this.querySelector('#ai-config-modal')?.close()
        this._aiModal = null
    }

    async _onSaveAiConfig(e) {
        e.preventDefault()
        const form = e.target
        const apiKey = form.apiKey.value.trim()
        const model = form.model?.value ?? this._aiModel
        if (!apiKey && !this._aiConfigured) {
            this._aiModal = { ...this._aiModal, error: 'API-Key darf nicht leer sein.' }
            return
        }
        this._aiModal = { ...this._aiModal, loading: true, error: null }
        try {
            const res = await api.saveAiConfig(apiKey, model)
            if (res.error) {
                this._aiModal = { ...this._aiModal, loading: false, error: res.error }
                return
            }
            this._aiConfigured = true
            this._aiModel = model
            this._closeAiModal()
        } catch (err) {
            this._aiModal = { ...this._aiModal, loading: false, error: err.message }
        }
    }

    async _onClearAiConfig() {
        await api.clearAiConfig()
        this._aiConfigured = false
    }

    disconnectedCallback() {
        super.disconnectedCallback()
        this._stopInfoPolling()
        document.removeEventListener('click', this._onDocClick)
    }

    updated(changed) {
        if (changed.has('_serverOffline')) {
            const dialog = this.querySelector('#server-offline-modal')
            if (!dialog) return
            if (this._serverOffline && !dialog.open) {
                dialog.showModal()
            } else if (!this._serverOffline && dialog.open) {
                dialog.close()
                this._confirmResetConnection = false
                if (changed.get('_serverOffline') === true) {
                    this._reloadCurrentView()
                }
            }
        }
    }

    async _onAuthenticated() {
        this._authed = true
        await connection.load()
        this._serviceReady = connection.isConfigured()
        if (this._serviceReady) {
            this._loadInfo()
            this._startInfoPolling()
            this._loadAiConfig()
        }
        this._applyRoute()
    }

    async _loadInfo() {
        try {
            const info = await api.getInfo()
            this._serverInfo = info
            this._serverDescription = info.description ?? null
            this._serverOffline = false
        } catch {
            this._serverOffline = true
        }
    }

    _startInfoPolling() {
        this._stopInfoPolling()
        this._infoTimer = setInterval(() => this._loadInfo(), 15000)
    }

    _stopInfoPolling() {
        if (this._infoTimer !== null) {
            clearInterval(this._infoTimer)
            this._infoTimer = null
        }
    }

    _onConnected() {
        this._serviceReady = true
        this._editingConnection = false
        this._loadInfo()
        this._startInfoPolling()
        this._loadAiConfig()
    }

    _onCancelConnection() {
        this._editingConnection = false
    }

    async _checkConnection() {
        this._checkingConnection = true
        await Promise.all([this._loadInfo(), new Promise(r => setTimeout(r, 1000))])
        this._checkingConnection = false
    }

    async _resetConnection() {
        const dialog = this.querySelector('#server-offline-modal')
        if (dialog?.open) dialog.close()
        this._stopInfoPolling()
        this._serverOffline = false
        this._confirmResetConnection = false
        await connection.clear()
        this._serviceReady = false
    }

    _onEditConnection() {
        this._editingConnection = true
    }

    async _onLogout() {
        await auth.logout()
        this._authed = false
    }

    _openPwModal() {
        this._pwModal = { error: null, loading: false }
        this.updateComplete.then(() => this.querySelector('#pw-change-modal')?.showModal())
    }

    _closePwModal() {
        this.querySelector('#pw-change-modal')?.close()
        this._pwModal = null
    }

    async _onChangePassword(e) {
        e.preventDefault()
        const form = e.target
        const current = form.current.value
        const next = form.next.value
        const confirm = form.confirm.value
        if (next.length < 6) {
            this._pwModal = { ...this._pwModal, error: 'Min. 6 Zeichen.' }
            return
        }
        if (next !== confirm) {
            this._pwModal = { ...this._pwModal, error: 'Passwörter stimmen nicht überein.' }
            return
        }
        this._pwModal = { ...this._pwModal, loading: true, error: null }
        const res = await auth.changePassword(current, next)
        if (res.error) {
            this._pwModal = { ...this._pwModal, loading: false, error: res.error }
            return
        }
        this._closePwModal()
        await auth.logout()
        this._authed = false
    }

    _onToggleTheme() {
        const next = theme.toggle()
        this._isDark = next === 'dark'
    }

    _onSchemaSelected(e) {
        this.selectedPrefix = e.detail.prefix
        this.selectedFlowHash = null
        this._flowListCache = null
    }

    _onFlowSelected(e) {
        this._previousTab = this.activeTab
        this.activeTab = 'flows'
        this.selectedFlowHash = e.detail.hash
    }

    _onFlowLoaded(e) {
        if (!this.selectedPrefix && e.detail.flowType) {
            this.selectedPrefix = e.detail.flowType.replace(/\.v\d+$/, '').toLowerCase()
        }
    }

    _onBackToSchema() {
        this.selectedPrefix = null
        this.selectedFlowHash = null
        this.selectedRuntimeHash = null
    }

    _onBackToList() {
        if (this._previousTab && this._previousTab !== 'flows') {
            this.activeTab = this._previousTab
            this.selectedFlowHash = null
            this.selectedRuntimeHash = null
            this.selectedPrefix = null
            this._previousTab = null
        } else {
            this.selectedFlowHash = null
            this.selectedRuntimeHash = null
        }
    }

    async _onSearch(e) {
        if (e.type === 'keydown' && e.key !== 'Enter') return
        const q = this._searchQuery.trim()
        if (!q) return

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q)

        if (isUuid) {
            // Try to resolve as runtimeHash first via API
            try {
                const flow = await api.getFlowByRuntimeHash(q)
                if (flow?.flowHash) {
                    this._searchQuery = ''
                    this._searchResults = null
                    this.activeTab = 'flows'
                    this.selectedPrefix = null
                    this.selectedFlowHash = flow.flowHash
                    this.selectedRuntimeHash = q
                    return
                }
            } catch {
                // not a runtimeHash — fall through to flowHash search
            }

            // Try as flowHash
            try {
                await api.getFlow(q)
                this._searchQuery = ''
                this._searchResults = null
                this.activeTab = 'flows'
                this.selectedPrefix = null
                this.selectedRuntimeHash = null
                this.selectedFlowHash = q
            } catch {
                this._shakeSearch()
            }
            return
        }

        // Subject search
        try {
            const res = await api.searchFlows({ subject: q, top: SEARCH_LIMIT })
            const items = res.items ?? []
            if (items.length === 1) {
                this._searchQuery = ''
                this._searchResults = null
                this.activeTab = 'flows'
                this.selectedPrefix = null
                this.selectedRuntimeHash = null
                this.selectedFlowHash = items[0].flowHash
            } else if (items.length > 1) {
                this._searchResults = items
                this._searchTotal = res.total ?? items.length
            } else {
                this._shakeSearch()
            }
        } catch {
            this._shakeSearch()
        }
    }

    _selectSearchResult(flowHash) {
        this._searchQuery = ''
        this._searchResults = null
        this.activeTab = 'flows'
        this.selectedPrefix = null
        this.selectedRuntimeHash = null
        this.selectedFlowHash = flowHash
    }

    _closeSearchResults() {
        this._searchResults = null
    }

    _shakeSearch() {
        const input = this.querySelector('.fc-search-input')
        if (!input) return
        input.classList.add('fc-shake')
        input.addEventListener('animationend', () => input.classList.remove('fc-shake'), { once: true })
    }

    _reloadCurrentView() {
        this.querySelectorAll('*').forEach(el => el._load?.())
    }

    _onFlowTypeSelected(_e) {
        this.activeTab = 'flows'
        this.selectedPrefix = null
        this.selectedFlowHash = null
    }

    _renderContent() {
        if (this.activeTab === 'overview') {
            return html`<fc-overview
                .serverInfo=${this._serverInfo}
                @tab-navigate=${e => {
                    this.activeTab = e.detail.tab
                }}
                @chart-flow-date=${e => {
                    this.activeTab = 'flows'
                    this._flowChartDate = e.detail.date
                    this.selectedPrefix = null
                    this.selectedFlowHash = null
                }}
                @chart-exc-date=${e => {
                    this.activeTab = 'exceptions'
                    this._excChartDate = e.detail.date
                }}
            ></fc-overview>`
        }
        if (this.activeTab === 'schemas') {
            return html`<fc-schema-list></fc-schema-list>`
        }
        if (this.activeTab === 'flows') {
            if (this.selectedFlowHash) {
                return html`
                    <fc-flow-detail
                        .hash=${this.selectedFlowHash}
                        .initialRuntimeHash=${this.selectedRuntimeHash}
                        .aiConfigured=${this._aiConfigured}
                        @back=${this._onBackToList}
                    ></fc-flow-detail>
                `
            }
            if (this.selectedPrefix) {
                return html`
                    <div class="flex flex-col md:flex-row gap-4">
                        <div class="w-full md:w-1/3 md:sticky md:top-20 md:self-start">
                            <fc-flow-chart
                                .type=${this.selectedPrefix}
                                @chart-date-click=${e => {
                                    this._flowChartDate = e.detail.date
                                }}
                            ></fc-flow-chart>
                        </div>
                        <div class="w-full md:w-2/3">
                            <fc-flow-list
                                .type=${this.selectedPrefix}
                                .cachedState=${this._flowListCache}
                                .dateFrom=${this._flowChartDate}
                                .dateTo=${this._flowChartDate}
                                @flow-selected=${this._onFlowSelected}
                                @back=${this._onBackToSchema}
                                @list-state-changed=${e => {
                                    this._flowListCache = e.detail
                                }}
                            ></fc-flow-list>
                        </div>
                    </div>
                `
            }
            return html`<fc-type-list @schema-selected=${this._onSchemaSelected}></fc-type-list>`
        }
        if (this.activeTab === 'schedules') return html`<fc-schedule-list></fc-schedule-list>`
        if (this.activeTab === 'queues') return html`<fc-queue-list></fc-queue-list>`
        return html`
            <div class="flex flex-col md:flex-row gap-4">
                <div class="w-full md:w-1/3 md:sticky md:top-20 md:self-start">
                    <fc-exception-chart
                        @chart-date-click=${e => {
                            this._excChartDate = e.detail.date
                        }}
                    ></fc-exception-chart>
                </div>
                <div class="w-full md:w-2/3">
                    <fc-exception-list .dateFrom=${this._excChartDate} .dateTo=${this._excChartDate}></fc-exception-list>
                </div>
            </div>
        `
    }

    render() {
        if (!this._authed) {
            return html` <fc-login @authenticated=${this._onAuthenticated}></fc-login> `
        }

        if (!this._serviceReady || this._editingConnection) {
            return html` <fc-service-setup @connected=${this._onConnected} @cancel=${this._onCancelConnection}></fc-service-setup> `
        }

        return html`
            <div class="min-h-screen bg-base-100">
                <div
                    class="navbar bg-base-200 backdrop-blur-sm shadow-md border-b border-base-content/15 px-2 sm:px-4 min-h-12 sticky top-0 z-50"
                >
                    <!-- Left: logo + title + search -->
                    <div class="flex-1 flex items-center gap-2 sm:gap-3 min-w-0">
                        <!-- Toolbox dropdown -->
                        <div
                            class="relative hidden sm:block"
                            @mouseenter=${() => {
                                clearTimeout(this._toolboxTimer)
                                this._toolboxOpen = true
                            }}
                            @mouseleave=${() => {
                                this._toolboxTimer = setTimeout(() => (this._toolboxOpen = false), 150)
                            }}
                        >
                            <button
                                class="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-base-content/8 transition-colors cursor-pointer"
                                @click=${() => {
                                    this.activeTab = 'overview'
                                    this.selectedFlowHash = null
                                }}
                            >
                                ${logoIcon(24)}
                                <div class="flex flex-col leading-tight text-left">
                                    <span class="text-base font-bold tracking-tight whitespace-nowrap">FlowCrafter UI</span>
                                    ${this._serverDescription || this._serverInfo
                                        ? html` <span
                                              class="text-xs whitespace-nowrap ${this._serverInfo?.workers?.length > 0
                                                  ? 'text-base-content/40'
                                                  : 'text-error/70 animate-pulse'}"
                                          >
                                              ${[...(this._serverDescription ?? '')].length > 24
                                                  ? [...this._serverDescription].slice(0, 21).join('') + '...'
                                                  : this._serverDescription ||
                                                    (!(this._serverInfo?.workers?.length > 0) ? 'Observer stopped' : '')}
                                          </span>`
                                        : ''}
                                </div>
                            </button>

                            ${this._toolboxOpen
                                ? html`
                                      <!-- Dropdown card -->
                                      <div
                                          class="absolute left-0 top-full mt-2 z-50 w-75 rounded-box border border-base-300 bg-base-100 shadow-lg p-4"
                                      >
                                          <div
                                              class="bg-base-200 -mx-4 -mt-4 px-4 py-3 rounded-t-box text-xs font-semibold text-base-content/50 uppercase tracking-wider"
                                          >
                                              Server Info
                                          </div>
                                          <div class="bg-base-100 -mx-4 px-4 py-3 flex flex-col gap-2.5">
                                              ${[...(this._serverDescription ?? '')].length > 24
                                                  ? html`<div class="flex items-baseline justify-between gap-3">
                                                        <span class="text-xs text-base-content/50 shrink-0">Description</span>
                                                        <span class="text-xs text-right break-all text-base-content/60"
                                                            >${this._serverDescription}</span
                                                        >
                                                    </div>`
                                                  : ''}
                                              ${this._serverInfo?.version
                                                  ? html`<div class="flex items-baseline justify-between gap-3">
                                                        <span class="text-xs text-base-content/50 shrink-0">Version</span>
                                                        <span class="font-mono text-xs text-right text-base-content/60"
                                                            >${this._serverInfo.version}</span
                                                        >
                                                    </div>`
                                                  : ''}
                                              ${this._serverInfo?.php
                                                  ? html`<div class="flex items-baseline justify-between gap-3">
                                                        <span class="text-xs text-base-content/50 shrink-0">PHP</span>
                                                        <span class="font-mono text-xs text-right text-base-content/60"
                                                            >${this._serverInfo.php}</span
                                                        >
                                                    </div>`
                                                  : ''}
                                              ${this._serverInfo?.storage
                                                  ? html`<div class="flex items-baseline justify-between gap-3">
                                                        <span class="text-xs text-base-content/50 shrink-0">Storage</span>
                                                        <span class="font-mono text-xs text-right text-base-content/60"
                                                            >${this._serverInfo.storage}</span
                                                        >
                                                    </div>`
                                                  : ''}
                                              <div class="flex items-baseline justify-between gap-3">
                                                  <span class="text-xs text-base-content/50 shrink-0">Service URL</span>
                                                  <span class="font-mono text-xs text-right break-all text-base-content/60"
                                                      >${connection.getUrl()}</span
                                                  >
                                              </div>
                                              <div class="flex items-start justify-between gap-3">
                                                  <span class="text-xs text-base-content/50 shrink-0 mt-0.5">Observer</span>
                                                  ${this._serverInfo?.workers?.length > 0
                                                      ? html`<div class="flex flex-col items-end gap-1">
                                                            ${this._serverInfo.workers.map(w => {
                                                                const secs = workerAgeSecs(w.lastHeartbeat)
                                                                const color = workerAgeColor(secs)
                                                                return html`<span
                                                                    class="flex items-center gap-1.5 font-mono text-[10px] text-${color}"
                                                                    title="Letzter Heartbeat: ${w.lastHeartbeat}"
                                                                >
                                                                    <span
                                                                        class="inline-block w-1.5 h-1.5 rounded-full bg-${color} shrink-0"
                                                                    ></span>
                                                                    ${w.hostname}:${w.pid}
                                                                    <span class="text-base-content/40">(${workerAgeLabel(secs)})</span>
                                                                </span>`
                                                            })}
                                                        </div>`
                                                      : html`<span class="flex items-center gap-1.5 text-xs text-error"
                                                            ><span class="inline-block w-1.5 h-1.5 rounded-full bg-error"></span
                                                            >stopped</span
                                                        >`}
                                              </div>
                                              <div class="flex items-start justify-between gap-3">
                                                  <span class="text-xs text-base-content/50 shrink-0 mt-0.5">Scheduler</span>
                                                  ${this._serverInfo?.scheduler?.length > 0
                                                      ? html`<div class="flex flex-col items-end gap-1">
                                                            ${this._serverInfo.scheduler.map(s => {
                                                                const secs = workerAgeSecs(s.lastHeartbeat)
                                                                const color = schedulerAgeColor(secs)
                                                                return html`<span
                                                                    class="flex items-center gap-1.5 font-mono text-[10px] text-${color}"
                                                                    title="Letzter Heartbeat: ${s.lastHeartbeat}"
                                                                >
                                                                    <span
                                                                        class="inline-block w-1.5 h-1.5 rounded-full bg-${color} shrink-0"
                                                                    ></span>
                                                                    ${s.hostname}:${s.pid}
                                                                    <span class="text-base-content/40">(${workerAgeLabel(secs)})</span>
                                                                </span>`
                                                            })}
                                                        </div>`
                                                      : html`<span class="flex items-center gap-1.5 text-xs text-error"
                                                            ><span class="inline-block w-1.5 h-1.5 rounded-full bg-error"></span
                                                            >stopped</span
                                                        >`}
                                              </div>
                                          </div>
                                      </div>
                                  `
                                : ''}
                        </div>

                        <!-- Mobile: logo only (no dropdown) -->
                        <div class="sm:hidden">${logoIcon(24)}</div>
                        <div class="relative">
                            <div class="join min-w-0">
                                <input
                                    type="text"
                                    class="fc-search-input input input-sm join-item w-28 sm:w-48 md:w-64 font-mono text-xs border-transparent bg-base-content/2"
                                    placeholder="Hash / Subject…"
                                    .value=${this._searchQuery}
                                    @input=${e => {
                                        this._searchQuery = e.target.value
                                        this._searchResults = null
                                    }}
                                    @keydown=${this._onSearch}
                                />
                                <button class="btn btn-sm btn-ghost join-item border-transparent" @click=${this._onSearch}>↵</button>
                            </div>
                            ${this._searchResults?.length
                                ? html`
                                      <div
                                          class="fc-search-dropdown absolute top-full left-0 mt-1 w-84 bg-base-100 border border-base-content/10 rounded-box shadow-xl z-50"
                                      >
                                          <div class="px-3 py-1.5 text-[10px] uppercase tracking-wider text-base-content/40 font-semibold">
                                              Suchergebnisse
                                          </div>
                                          ${this._searchResults.slice(0, SEARCH_LIMIT).map(
                                              item => html`
                                                  <button
                                                      class="group w-full text-left px-3 py-2.5 hover:bg-primary/10 transition-colors border-t border-base-content/5"
                                                      @click=${() => this._selectSearchResult(item.flowHash)}
                                                  >
                                                      <div class="flex items-center justify-between gap-2">
                                                          <span
                                                              class="text-sm font-semibold truncate group-hover:text-primary transition-colors"
                                                              >${item.flowSource?.split('\\').pop()}</span
                                                          >
                                                          <span class="text-xs text-base-content/35 flex-shrink-0"
                                                              >${new Date(item.flowTime).toLocaleString('de-DE', {
                                                                  dateStyle: 'short',
                                                                  timeStyle: 'short',
                                                              })}</span
                                                          >
                                                      </div>
                                                      ${item.flowSubject
                                                          ? html`<div class="text-sm text-base-content/60 truncate mt-0.5">
                                                                ${item.flowSubject}
                                                            </div>`
                                                          : ''}
                                                      <div class="text-xs font-mono text-base-content/30 mt-0.5">
                                                          ${item.flowHash}
                                                          ${item.status === 'FAILED' || item.status === 'WARNING'
                                                              ? html`<span class="text-error/60 ml-2">${item.status}</span>`
                                                              : ''}
                                                      </div>
                                                  </button>
                                              `
                                          )}
                                          ${this._searchTotal > SEARCH_LIMIT
                                              ? html`
                                                    <div
                                                        class="px-3 py-2 text-[11px] text-base-content/40 text-center border-t border-base-content/5 bg-base-200/50"
                                                    >
                                                        ${SEARCH_LIMIT} von ${this._searchTotal} Ergebnissen
                                                    </div>
                                                `
                                              : ''}
                                      </div>
                                  `
                                : ''}
                        </div>
                    </div>

                    <!-- Center: GitHub (only on large screens) -->
                    <div class="hidden lg:flex flex-none absolute left-1/2 -translate-x-1/2">
                        <a
                            href="https://github.com/wundii/flowcrafter"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="flex items-center gap-2 text-sm text-base-content/50 hover:text-base-content transition-colors px-2 py-1 rounded"
                        >
                            <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path
                                    d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"
                                />
                            </svg>
                            wundii/flowcrafter
                        </a>
                    </div>

                    <!-- Right: queue chart + actions -->
                    <div class="flex items-center gap-1 sm:gap-2">
                        <!-- Queue chart (only on medium+ screens) -->
                        <div class="hidden md:flex mr-1 sm:mr-2 pl-3">
                            <fc-queue-chart></fc-queue-chart>
                        </div>

                        <!-- Theme toggle -->
                        <label
                            class="swap swap-rotate btn btn-ghost btn-sm btn-circle"
                            title="${this._isDark ? 'Light Mode' : 'Dark Mode'}"
                        >
                            <input type="checkbox" .checked=${!this._isDark} @change=${this._onToggleTheme} />
                            <!-- Sun (light mode icon) -->
                            <svg class="swap-on w-4 h-4 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                                <path
                                    d="M5.64,17l-.71.71a1,1,0,0,0,0,1.41,1,1,0,0,0,1.41,0l.71-.71A1,1,0,0,0,5.64,17ZM5,12a1,1,0,0,0-1-1H3a1,1,0,0,0,0,2H4A1,1,0,0,0,5,12Zm7-7a1,1,0,0,0,1-1V3a1,1,0,0,0-2,0V4A1,1,0,0,0,12,5ZM5.64,7.05a1,1,0,0,0,.7.29,1,1,0,0,0,.71-.29,1,1,0,0,0,0-1.41l-.71-.71A1,1,0,0,0,4.93,6.34Zm12,.29a1,1,0,0,0,.7-.29l.71-.71a1,1,0,1,0-1.41-1.41L17,5.64a1,1,0,0,0,0,1.41A1,1,0,0,0,17.66,7.34ZM21,11H20a1,1,0,0,0,0,2h1a1,1,0,0,0,0-2Zm-9,8a1,1,0,0,0-1,1v1a1,1,0,0,0,2,0V20A1,1,0,0,0,12,19ZM18.36,17A1,1,0,0,0,17,18.36l.71.71a1,1,0,0,0,1.41,0,1,1,0,0,0,0-1.41ZM12,6.5A5.5,5.5,0,1,0,17.5,12,5.51,5.51,0,0,0,12,6.5Zm0,9A3.5,3.5,0,1,1,15.5,12,3.5,3.5,0,0,1,12,15.5Z"
                                />
                            </svg>
                            <!-- Moon (dark mode icon) -->
                            <svg class="swap-off w-4 h-4 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                                <path
                                    d="M21.64,13a1,1,0,0,0-1.05-.14,8.05,8.05,0,0,1-3.37.73A8.15,8.15,0,0,1,9.08,5.49a8.59,8.59,0,0,1,.25-2A1,1,0,0,0,8,2.36,10.14,10.14,0,1,0,22,14.05,1,1,0,0,0,21.64,13Zm-9.5,6.69A8.14,8.14,0,0,1,7.08,5.22v.27A10.15,10.15,0,0,0,17.22,15.63a9.79,9.79,0,0,0,2.1-.22A8.11,8.11,0,0,1,12.14,19.73Z"
                                />
                            </svg>
                        </label>

                        <!-- AI config -->
                        <button
                            class="hidden sm:flex btn btn-ghost btn-sm btn-circle"
                            title="AI-Analyse konfigurieren"
                            @click=${this._openAiModal}
                        >
                            <svg
                                class="w-4 h-4 ${this._aiConfigured ? 'text-success' : 'text-base-content/50'}"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z"
                                />
                            </svg>
                        </button>

                        <!-- Edit connection -->
                        <button
                            class="hidden sm:flex btn btn-ghost btn-sm btn-circle"
                            title="Verbindung bearbeiten"
                            @click=${this._onEditConnection}
                        >
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
                                />
                            </svg>
                        </button>

                        <!-- Change password -->
                        <button class="hidden sm:flex btn btn-ghost btn-sm btn-circle" title="Passwort ändern" @click=${this._openPwModal}>
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
                                />
                            </svg>
                        </button>

                        <!-- Logout -->
                        <button class="btn btn-ghost btn-sm btn-circle" title="Abmelden" @click=${this._onLogout}>
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6a2 2 0 012 2v1"
                                />
                            </svg>
                        </button>
                    </div>
                </div>

                <div class="px-4 pt-4">
                    <div role="tablist" class="tabs tabs-border">
                        ${TABS.map(
                            tab => html`
                                <a
                                    role="tab"
                                    class="tab gap-1.5 ${this.activeTab === tab ? 'tab-active' : ''}"
                                    @click=${() => {
                                        this.activeTab = tab
                                        this.selectedPrefix = null
                                        this.selectedFlowHash = null
                                        this._flowChartDate = null
                                        this._excChartDate = null
                                    }}
                                >
                                    ${{
                                        overview: html`<svg
                                            class="w-3.5 h-3.5"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2"
                                            viewBox="0 0 24 24"
                                        >
                                            <path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
                                            />
                                        </svg>`,
                                        schemas: html`<svg
                                            class="w-3.5 h-3.5"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2"
                                            viewBox="0 0 24 24"
                                        >
                                            <rect x="3" y="3" width="7" height="7" rx="1"></rect>
                                            <rect x="14" y="3" width="7" height="7" rx="1"></rect>
                                            <rect x="3" y="14" width="7" height="7" rx="1"></rect>
                                            <rect x="14" y="14" width="7" height="7" rx="1"></rect>
                                        </svg>`,
                                        flows: html`<svg
                                            class="w-3.5 h-3.5"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2"
                                            viewBox="0 0 24 24"
                                        >
                                            <path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
                                            />
                                        </svg>`,
                                        exceptions: html`<svg
                                            class="w-3.5 h-3.5"
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
                                        </svg>`,
                                        schedules: html`<svg
                                            class="w-3.5 h-3.5"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2"
                                            viewBox="0 0 24 24"
                                        >
                                            <path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
                                            />
                                        </svg>`,
                                        queues: html`<svg
                                            class="w-3.5 h-3.5"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2"
                                            viewBox="0 0 24 24"
                                        >
                                            <path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859M12 3v8.25m0 0l-3-3m3 3l3-3"
                                            />
                                        </svg>`,
                                    }[tab]}
                                    ${{
                                        overview: 'Overview',
                                        schemas: 'Schemas',
                                        flows: 'Flows',
                                        exceptions: 'Exceptions',
                                        schedules: 'Schedules',
                                        queues: 'Queues',
                                    }[tab]}
                                </a>
                            `
                        )}
                    </div>
                </div>

                <!-- Change password modal -->
                <dialog id="pw-change-modal" class="modal">
                    ${this._pwModal
                        ? html`
                              <div class="modal-box max-w-sm p-0 overflow-hidden">
                                  <div class="bg-gradient-to-br from-primary/10 via-secondary/5 to-transparent px-6 pt-5 pb-4">
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
                                                          d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                                                      />
                                                  </svg>
                                              </div>
                                              <h3 class="font-bold text-base">Passwort ändern</h3>
                                          </div>
                                          <button class="btn btn-sm btn-ghost btn-square btn-circle" @click=${this._closePwModal}>✕</button>
                                      </div>
                                  </div>
                                  <form @submit=${this._onChangePassword} class="flex flex-col gap-3 px-6 pb-6 pt-4">
                                      <div class="form-control">
                                          <label class="label py-1"><span class="label-text text-xs">Aktuelles Passwort</span></label>
                                          <input
                                              type="password"
                                              name="current"
                                              class="input input-bordered input-sm"
                                              autocomplete="current-password"
                                              ?disabled=${this._pwModal.loading}
                                              required
                                          />
                                      </div>
                                      <div class="form-control">
                                          <label class="label py-1"><span class="label-text text-xs">Neues Passwort</span></label>
                                          <input
                                              type="password"
                                              name="next"
                                              class="input input-bordered input-sm"
                                              autocomplete="new-password"
                                              ?disabled=${this._pwModal.loading}
                                              required
                                          />
                                      </div>
                                      <div class="form-control">
                                          <label class="label py-1"
                                              ><span class="label-text text-xs">Neues Passwort wiederholen</span></label
                                          >
                                          <input
                                              type="password"
                                              name="confirm"
                                              class="input input-bordered input-sm"
                                              autocomplete="new-password"
                                              ?disabled=${this._pwModal.loading}
                                              required
                                          />
                                      </div>
                                      ${this._pwModal.error
                                          ? html`
                                                <div class="alert alert-error py-2 px-3 text-xs">
                                                    <span>${this._pwModal.error}</span>
                                                </div>
                                            `
                                          : ''}
                                      <div class="modal-action mt-0">
                                          <button type="button" class="btn btn-ghost btn-sm" @click=${this._closePwModal}>Abbrechen</button>
                                          <button type="submit" class="btn btn-primary btn-sm" ?disabled=${this._pwModal.loading}>
                                              ${this._pwModal.loading
                                                  ? html`<span class="loading loading-spinner loading-xs"></span>`
                                                  : 'Speichern'}
                                          </button>
                                      </div>
                                  </form>
                              </div>
                              <form method="dialog" class="modal-backdrop backdrop-blur-sm">
                                  <button @click=${this._closePwModal}>close</button>
                              </form>
                          `
                        : ''}
                </dialog>
                <!-- AI config modal -->
                <dialog id="ai-config-modal" class="modal">
                    ${this._aiModal
                        ? html`
                              <div class="modal-box max-w-sm p-0 overflow-hidden">
                                  <!-- Header mit Gradient -->
                                  <div class="bg-gradient-to-br from-primary/10 via-secondary/5 to-transparent px-6 pt-5 pb-4">
                                      <div class="flex items-center justify-between">
                                          <div class="flex items-center gap-3">
                                              <div class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                                                  <svg class="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="currentColor">
                                                      <path
                                                          d="M9 4.5a.75.75 0 01.721.544l.813 2.846a3.75 3.75 0 002.576 2.576l2.846.813a.75.75 0 010 1.442l-2.846.813a3.75 3.75 0 00-2.576 2.576l-.813 2.846a.75.75 0 01-1.442 0l-.813-2.846a3.75 3.75 0 00-2.576-2.576l-2.846-.813a.75.75 0 010-1.442l2.846-.813A3.75 3.75 0 007.466 7.89l.813-2.846A.75.75 0 019 4.5zM18 1.5a.75.75 0 01.728.568l.258 1.036c.236.94.97 1.674 1.91 1.91l1.036.258a.75.75 0 010 1.456l-1.036.258c-.94.236-1.674.97-1.91 1.91l-.258 1.036a.75.75 0 01-1.456 0l-.258-1.036a2.625 2.625 0 00-1.91-1.91l-1.036-.258a.75.75 0 010-1.456l1.036-.258a2.625 2.625 0 001.91-1.91l.258-1.036A.75.75 0 0118 1.5zM16.5 15a.75.75 0 01.712.513l.394 1.183c.15.447.5.799.948.948l1.183.395a.75.75 0 010 1.422l-1.183.395c-.447.15-.799.5-.948.948l-.395 1.183a.75.75 0 01-1.422 0l-.395-1.183a1.5 1.5 0 00-.948-.948l-1.183-.395a.75.75 0 010-1.422l1.183-.395c.447-.15.799-.5.948-.948l.395-1.183A.75.75 0 0116.5 15z"
                                                      />
                                                  </svg>
                                              </div>
                                              <div>
                                                  <h3 class="font-bold text-base">AI-Einstellungen</h3>
                                                  <span class="text-xs text-base-content/50">Anthropic Claude</span>
                                              </div>
                                          </div>
                                          <button class="btn btn-sm btn-ghost btn-square btn-circle" @click=${this._closeAiModal}>✕</button>
                                      </div>
                                  </div>

                                  <div class="px-6 pb-6 pt-4">
                                      <!-- Provider info -->
                                      <div class="rounded-lg bg-base-200 border border-base-300 px-3 py-2.5 mb-4">
                                          <p class="text-xs text-base-content/60">
                                              Die AI-Analyse nutzt Claude von Anthropic. Ein API-Key wird unter
                                              <a
                                                  href="https://console.anthropic.com/settings/keys"
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  class="link link-primary"
                                                  >console.anthropic.com</a
                                              >
                                              erstellt.
                                          </p>
                                      </div>

                                      ${this._aiConfigured
                                          ? html`
                                                <div
                                                    class="flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 px-3 py-2.5 mb-4"
                                                >
                                                    <svg
                                                        class="w-4 h-4 text-success flex-shrink-0"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        stroke-width="2"
                                                        viewBox="0 0 24 24"
                                                    >
                                                        <path
                                                            stroke-linecap="round"
                                                            stroke-linejoin="round"
                                                            d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                                        />
                                                    </svg>
                                                    <span class="text-xs text-success font-medium">API-Key ist hinterlegt</span>
                                                </div>
                                            `
                                          : ''}

                                      <form @submit=${this._onSaveAiConfig} class="flex flex-col gap-3">
                                          ${this._aiModels.length > 0
                                              ? html`
                                                    <div class="form-control">
                                                        <label class="label py-1"
                                                            ><span class="label-text text-xs font-medium">Modell</span></label
                                                        >
                                                        <select
                                                            name="model"
                                                            class="select select-bordered select-sm w-full"
                                                            ?disabled=${this._aiModal.loading}
                                                        >
                                                            ${this._aiModels.map(
                                                                m => html`
                                                                    <option value=${m.id} ?selected=${m.id === this._aiModel}>
                                                                        ${m.label}
                                                                    </option>
                                                                `
                                                            )}
                                                        </select>
                                                    </div>
                                                `
                                              : ''}
                                          <div class="form-control">
                                              <label class="label py-1"
                                                  ><span class="label-text text-xs font-medium"
                                                      >${this._aiConfigured ? 'Neuer API-Key' : 'API-Key'}</span
                                                  ></label
                                              >
                                              <input
                                                  type="password"
                                                  name="apiKey"
                                                  class="input input-bordered input-sm font-mono w-full"
                                                  placeholder="sk-ant-..."
                                                  ?disabled=${this._aiModal.loading}
                                                  ?required=${!this._aiConfigured}
                                              />
                                          </div>
                                          ${this._aiModal.error
                                              ? html`
                                                    <div class="alert alert-error py-2 px-3 text-xs">
                                                        <span>${this._aiModal.error}</span>
                                                    </div>
                                                `
                                              : ''}
                                          <div class="flex items-center justify-between mt-16">
                                              ${this._aiConfigured
                                                  ? html`<button
                                                        type="button"
                                                        class="btn btn-ghost btn-sm text-error"
                                                        @click=${this._onClearAiConfig}
                                                    >
                                                        Entfernen
                                                    </button>`
                                                  : html`<span></span>`}
                                              <div class="flex gap-2">
                                                  <button type="button" class="btn btn-ghost btn-sm" @click=${this._closeAiModal}>
                                                      Abbrechen
                                                  </button>
                                                  <button
                                                      type="submit"
                                                      class="btn btn-primary btn-sm min-w-24"
                                                      ?disabled=${this._aiModal.loading}
                                                  >
                                                      ${this._aiModal.loading
                                                          ? html`<span class="loading loading-spinner loading-xs"></span>`
                                                          : 'Speichern'}
                                                  </button>
                                              </div>
                                          </div>
                                      </form>
                                  </div>
                              </div>
                              <form method="dialog" class="modal-backdrop backdrop-blur-sm">
                                  <button @click=${this._closeAiModal}>close</button>
                              </form>
                          `
                        : ''}
                </dialog>

                <main class="p-4" @flow-selected=${this._onFlowSelected} @flow-loaded=${this._onFlowLoaded}>${this._renderContent()}</main>

                <!-- Server offline modal -->
                <dialog id="server-offline-modal" class="modal">
                    <div class="modal-box max-w-sm p-0 overflow-hidden">
                        <div class="bg-gradient-to-br from-warning/10 via-warning/5 to-transparent px-6 pt-5 pb-4">
                            <div class="flex items-center justify-center">
                                <div class="flex items-center gap-3">
                                    <div class="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center">
                                        <svg
                                            class="w-5 h-5 text-warning"
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
                                    </div>
                                    <h3 class="font-bold text-base">Server nicht erreichbar</h3>
                                </div>
                            </div>
                        </div>
                        ${this._confirmResetConnection
                            ? html`
                                  <div class="px-6 pb-6 pt-4 text-center">
                                      <p class="text-sm text-base-content/70">
                                          Soll die aktuelle Verbindung wirklich zurückgesetzt werden?
                                      </p>
                                      <p class="text-xs text-base-content/40 mt-2 font-mono break-all">${connection.getUrl()}</p>
                                      <div class="flex gap-2 justify-center mt-4">
                                          <button class="btn btn-sm btn-outline" @click=${() => (this._confirmResetConnection = false)}>
                                              Abbrechen
                                          </button>
                                          <button class="btn btn-sm btn-error" @click=${this._resetConnection}>
                                              Verbindung zurücksetzen
                                          </button>
                                      </div>
                                  </div>
                              `
                            : html`
                                  <div class="px-6 pb-6 pt-4 text-center">
                                      <span class="loading loading-ring loading-lg text-warning"></span>
                                      <p class="text-sm text-base-content/60 mt-3">
                                          Die Verbindung zum FlowCrafter-Server ist unterbrochen. Die Anwendung versucht automatisch, die
                                          Verbindung wiederherzustellen.
                                      </p>
                                      <p class="text-xs text-base-content/40 mt-2 font-mono break-all">${connection.getUrl()}</p>
                                      <div class="flex gap-2 justify-center mt-4">
                                          <button
                                              class="btn btn-sm btn-outline btn-warning"
                                              ?disabled=${this._checkingConnection}
                                              @click=${this._checkConnection}
                                          >
                                              ${this._checkingConnection
                                                  ? html`<span class="loading loading-spinner loading-xs"></span> Prüfe…`
                                                  : 'Jetzt prüfen'}
                                          </button>
                                          <button class="btn btn-sm btn-outline" @click=${() => (this._confirmResetConnection = true)}>
                                              Verbindung ändern
                                          </button>
                                      </div>
                                  </div>
                              `}
                    </div>
                    <div class="modal-backdrop backdrop-blur-sm"></div>
                </dialog>
            </div>
        `
    }
}

customElements.define('fc-app', FcApp)

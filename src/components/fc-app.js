import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { auth } from '../services/auth.js'
import { connection } from '../services/connection.js'
import { theme } from '../services/theme.js'
import { logoIcon } from '../assets/logo.js'
import { api } from '../services/api.js'
import './fc-login.js'
import './fc-service-setup.js'
import './fc-type-list.js'
import './fc-flow-list.js'
import './fc-flow-detail.js'
import './fc-exception-list.js'
import './fc-queue-chart.js'
import './fc-queue-list.js'
import './fc-exception-chart.js'
import './fc-flow-chart.js'
import './fc-overview.js'

const TABS = ['overview', 'flows', 'exceptions', 'queues']

export class FcApp extends BaseElement {
    static properties = {
        _authed: { state: true },
        _serviceReady: { state: true },
        _editingConnection: { state: true },
        _isDark: { state: true },
        _pwModal: { state: true },
        _serverDescription: { state: true },
        _serverInfo: { state: true },
        _toolboxOpen: { state: true },
        activeTab: { state: true },
        selectedPrefix: { state: true },
        selectedFlowHash: { state: true },
        selectedRuntimeHash: { state: true },
        _searchQuery: { state: true },
    }

    constructor() {
        super()
        this._authed = false
        this._serviceReady = false
        this._editingConnection = false
        this._isDark = theme.get() === 'dark'
        this._pwModal = null
        this._serverDescription = null
        this._serverInfo = null
        this._toolboxOpen = false
        this.activeTab = 'overview'
        this.selectedPrefix = null
        this.selectedFlowHash = null
        this.selectedRuntimeHash = null
        this._searchQuery = ''
        this._infoTimer = null
    }

    async connectedCallback() {
        super.connectedCallback()
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
            }
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback()
        this._stopInfoPolling()
    }

    async _onAuthenticated() {
        this._authed = true
        await connection.load()
        this._serviceReady = connection.isConfigured()
        if (this._serviceReady) {
            this._loadInfo()
            this._startInfoPolling()
        }
        this._applyRoute()
    }

    async _loadInfo() {
        try {
            const info = await api.getInfo()
            this._serverInfo = info
            this._serverDescription = info.description ?? null
        } catch {
            // optional — ignore errors
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
    }

    _onCancelConnection() {
        this._editingConnection = false
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
    }

    _onFlowSelected(e) {
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
        this.selectedFlowHash = null
        this.selectedRuntimeHash = null
    }

    async _onSearch(e) {
        if (e.type === 'keydown' && e.key !== 'Enter') return
        const q = this._searchQuery.trim()
        if (!q) return

        // Try to resolve as runtimeHash first via API
        try {
            const flow = await api.getFlowByRuntimeHash(q)
            if (flow?.flowHash) {
                this._searchQuery = ''
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
            this.activeTab = 'flows'
            this.selectedPrefix = null
            this.selectedRuntimeHash = null
            this.selectedFlowHash = q
        } catch {
            this._shakeSearch()
        }
    }

    _shakeSearch() {
        const input = this.querySelector('.fc-search-input')
        if (!input) return
        input.classList.add('fc-shake')
        input.addEventListener('animationend', () => input.classList.remove('fc-shake'), { once: true })
    }

    _breadcrumb() {
        if (this.activeTab !== 'flows') return ''

        const crumbs = [{ label: 'Types', action: this._onBackToSchema }]
        if (this.selectedPrefix) {
            crumbs.push({
                label: this.selectedPrefix,
                action: this._onBackToList,
            })
        }
        if (this.selectedFlowHash) {
            crumbs.push({ label: this.selectedFlowHash.slice(0, 10) + '…', action: null })
        }

        return html`
            <div class="px-4 pt-2 pb-0 flex items-center gap-1 text-xs text-base-content/40">
                ${crumbs.map(
                    (c, i) => html`
                        ${i > 0 ? html`<span>/</span>` : ''}
                        ${c.action
                            ? html`<button class="hover:text-base-content/70 transition-colors" @click=${c.action}>${c.label}</button>`
                            : html`<span class="text-base-content/70">${c.label}</span>`}
                    `
                )}
            </div>
        `
    }

    _onFlowTypeSelected(_e) {
        this.activeTab = 'flows'
        this.selectedPrefix = null
        this.selectedFlowHash = null
    }

    _renderContent() {
        if (this.activeTab === 'overview') {
            return html`<fc-overview @flow-type-selected=${this._onFlowTypeSelected}></fc-overview>`
        }
        if (this.activeTab === 'flows') {
            if (this.selectedFlowHash) {
                return html`
                    <fc-flow-detail
                        .hash=${this.selectedFlowHash}
                        .initialRuntimeHash=${this.selectedRuntimeHash}
                        @back=${this._onBackToList}
                    ></fc-flow-detail>
                `
            }
            if (this.selectedPrefix) {
                return html`
                    <div class="flex flex-col md:flex-row gap-4">
                        <div class="w-full md:w-1/3">
                            <fc-flow-chart .type=${this.selectedPrefix}></fc-flow-chart>
                        </div>
                        <div class="w-full md:w-2/3">
                            <fc-flow-list
                                .type=${this.selectedPrefix}
                                @flow-selected=${this._onFlowSelected}
                                @back=${this._onBackToSchema}
                            ></fc-flow-list>
                        </div>
                    </div>
                `
            }
            return html` <fc-type-list @schema-selected=${this._onSchemaSelected}></fc-type-list> `
        }
        if (this.activeTab === 'queues') return html`<fc-queue-list></fc-queue-list>`
        return html`
            <div class="flex flex-col md:flex-row gap-4">
                <div class="w-full md:w-1/3">
                    <fc-exception-chart></fc-exception-chart>
                </div>
                <div class="w-full md:w-2/3">
                    <fc-exception-list></fc-exception-list>
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
                                              class="text-xs whitespace-nowrap ${this._serverInfo?.observerRunning
                                                  ? 'text-base-content/40'
                                                  : 'text-error/70 animate-pulse'}"
                                          >
                                              ${[...(this._serverDescription ?? '')].length > 24
                                                  ? [...this._serverDescription].slice(0, 21).join('') + '...'
                                                  : this._serverDescription ||
                                                    (!this._serverInfo?.observerRunning ? 'Observer stopped' : '')}
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
                                              <div class="flex items-baseline justify-between gap-3">
                                                  <span class="text-xs text-base-content/50 shrink-0">Service URL</span>
                                                  <span class="font-mono text-xs text-right break-all text-base-content/60"
                                                      >${connection.getUrl()}</span
                                                  >
                                              </div>
                                              <div class="flex items-center justify-between gap-3">
                                                  <span class="text-xs text-base-content/50 shrink-0">Observer</span>
                                                  ${this._serverInfo?.observerRunning
                                                      ? html`<span class="flex items-center gap-1.5 text-xs text-success"
                                                            ><span class="inline-block w-1.5 h-1.5 rounded-full bg-success"></span
                                                            >running</span
                                                        >`
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
                        <div class="join min-w-0">
                            <input
                                type="text"
                                class="fc-search-input input input-sm join-item w-28 sm:w-48 md:w-64 font-mono text-xs border-transparent bg-base-content/2"
                                placeholder="Hash suchen…"
                                .value=${this._searchQuery}
                                @input=${e => (this._searchQuery = e.target.value)}
                                @keydown=${this._onSearch}
                            />
                            <button class="btn btn-sm btn-ghost join-item border-transparent" @click=${this._onSearch}>↵</button>
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
                            class="swap swap-rotate btn btn-ghost btn-sm btn-square"
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

                        <!-- Edit connection -->
                        <button
                            class="hidden sm:flex btn btn-ghost btn-sm btn-square"
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
                        <button class="hidden sm:flex btn btn-ghost btn-sm btn-square" title="Passwort ändern" @click=${this._openPwModal}>
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
                                />
                            </svg>
                        </button>

                        <!-- Logout -->
                        <button class="btn btn-ghost btn-sm btn-square" title="Abmelden" @click=${this._onLogout}>
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
                                    class="tab ${this.activeTab === tab ? 'tab-active' : ''}"
                                    @click=${() => {
                                        this.activeTab = tab
                                        this.selectedPrefix = null
                                        this.selectedFlowHash = null
                                    }}
                                >
                                    ${{ overview: 'Overview', flows: 'Flows', exceptions: 'Exceptions', queues: 'Queues' }[tab]}
                                </a>
                            `
                        )}
                    </div>
                </div>

                ${this._breadcrumb()}

                <!-- Change password modal -->
                <dialog id="pw-change-modal" class="modal">
                    ${this._pwModal
                        ? html`
                              <div class="modal-box max-w-sm">
                                  <div class="flex items-center justify-between mb-4">
                                      <h3 class="font-bold text-base">Passwort ändern</h3>
                                      <button class="btn btn-sm btn-ghost btn-square" @click=${this._closePwModal}>✕</button>
                                  </div>
                                  <form @submit=${this._onChangePassword} class="flex flex-col gap-3">
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
                <main class="p-4" @flow-selected=${this._onFlowSelected} @flow-loaded=${this._onFlowLoaded}>${this._renderContent()}</main>
            </div>
        `
    }
}

customElements.define('fc-app', FcApp)

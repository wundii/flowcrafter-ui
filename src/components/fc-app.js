import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { auth } from '../services/auth.js'
import { connection } from '../services/connection.js'
import { theme } from '../services/theme.js'
import { logoIcon } from '../assets/logo.js'
import { api } from '../services/api.js'
import './fc-login.js'
import './fc-service-setup.js'
import './fc-schema-list.js'
import './fc-flow-list.js'
import './fc-flow-detail.js'
import './fc-exception-list.js'

const TABS = ['flows', 'exceptions']

export class FcApp extends BaseElement {
    static properties = {
        _authed: { state: true },
        _serviceReady: { state: true },
        _editingConnection: { state: true },
        _isDark: { state: true },
        _pwModal: { state: true },
        activeTab: { state: true },
        selectedSource: { state: true },
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
        this.activeTab = 'flows'
        this.selectedSource = null
        this.selectedFlowHash = null
        this.selectedRuntimeHash = null
        this._searchQuery = ''
    }

    async connectedCallback() {
        super.connectedCallback()
        if (auth.isAuthenticated()) {
            const s = await auth.status()
            this._authed = s.authenticated
            if (this._authed) {
                await connection.load()
                this._serviceReady = connection.isConfigured()
            }
        }
    }

    async _onAuthenticated() {
        this._authed = true
        await connection.load()
        this._serviceReady = connection.isConfigured()
    }

    _onConnected() {
        this._serviceReady = true
        this._editingConnection = false
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
        this.selectedSource = e.detail.source
        this.selectedFlowHash = null
    }

    _onFlowSelected(e) {
        this.activeTab = 'flows'
        this.selectedFlowHash = e.detail.hash
    }

    _onFlowLoaded(e) {
        this.selectedSource = e.detail.source
    }

    _onBackToSchema() {
        this.selectedSource = null
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
        this._searchQuery = ''
        this.activeTab = 'flows'
        this.selectedSource = null

        // Try to resolve as runtimeHash first via API
        try {
            const flow = await api.getFlowByRuntimeHash(q)
            if (flow?.flowHash) {
                this.selectedFlowHash = flow.flowHash
                this.selectedRuntimeHash = q
                return
            }
        } catch {
            // not a runtimeHash — fall through to flowHash search
        }

        this.selectedRuntimeHash = null
        this.selectedFlowHash = q
    }

    _breadcrumb() {
        if (this.activeTab !== 'flows') return ''

        const crumbs = [{ label: 'Schemas', action: this._onBackToSchema }]
        if (this.selectedSource) {
            crumbs.push({
                label: this.selectedSource.split('\\').pop(),
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

    _renderContent() {
        if (this.activeTab === 'flows') {
            if (this.selectedFlowHash) {
                return html` <fc-flow-detail .hash=${this.selectedFlowHash} .initialRuntimeHash=${this.selectedRuntimeHash} @back=${this._onBackToList}></fc-flow-detail> `
            }
            if (this.selectedSource) {
                return html`
                    <fc-flow-list
                        .source=${this.selectedSource}
                        @flow-selected=${this._onFlowSelected}
                        @back=${this._onBackToSchema}
                    ></fc-flow-list>
                `
            }
            return html` <fc-schema-list @schema-selected=${this._onSchemaSelected}></fc-schema-list> `
        }
        return html`<fc-exception-list></fc-exception-list>`
    }

    render() {
        if (!this._authed) {
            return html` <fc-login @authenticated=${this._onAuthenticated}></fc-login> `
        }

        if (!this._serviceReady || this._editingConnection) {
            return html`
                <fc-service-setup
                    @connected=${this._onConnected}
                    @cancel=${this._onCancelConnection}
                ></fc-service-setup>
            `
        }

        return html`
            <div class="min-h-screen bg-base-100">
                <div class="navbar bg-base-200 shadow-sm px-4">
                    <div class="flex-1 flex items-center gap-3">
                        ${logoIcon(28)}
                        <span class="text-xl font-bold tracking-tight">FlowCrafter UI</span>
                        <div class="join">
                            <input
                                type="text"
                                class="input input-sm input-bordered join-item w-64 font-mono text-xs"
                                placeholder="Flow-Hash suchen…"
                                .value=${this._searchQuery}
                                @input=${e => (this._searchQuery = e.target.value)}
                                @keydown=${this._onSearch}
                            />
                            <button class="btn btn-sm btn-ghost border border-base-content/30 hover:border-base-content/50 join-item" @click=${this._onSearch}>↵</button>
                        </div>
                    </div>

                    <div class="flex-none absolute left-1/2 -translate-x-1/2">
                        <a
                            href="https://github.com/wundii/flowcrafter"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="btn btn-ghost btn-sm gap-2 text-base-content/50 hover:text-base-content hover:bg-transparent"
                        >
                            <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path
                                    d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"
                                />
                            </svg>
                            wundii/flowcrafter
                        </a>
                    </div>
                    <div class="flex items-center gap-2">
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
                        <button class="btn btn-ghost btn-sm btn-square" title="Verbindung bearbeiten" @click=${this._onEditConnection}>
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
                                />
                            </svg>
                        </button>

                        <!-- Change password -->
                        <button class="btn btn-ghost btn-sm btn-square" title="Passwort ändern" @click=${this._openPwModal}>
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
                                        this.selectedSource = null
                                        this.selectedFlowHash = null
                                    }}
                                >
                                    ${tab === 'flows' ? 'Flows' : 'Exceptions'}
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
                              <form method="dialog" class="modal-backdrop">
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

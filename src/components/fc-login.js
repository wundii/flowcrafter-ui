import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { auth } from '../services/auth.js'
import { logoIcon } from '../assets/logo.js'

export class FcLogin extends BaseElement {
    static properties = {
        _mode: { state: true }, // 'login' | 'setup'
        _error: { state: true },
        _loading: { state: true },
        _password: { state: true },
        _confirm: { state: true },
    }

    constructor() {
        super()
        this._mode = 'loading'
        this._error = null
        this._loading = false
        this._password = ''
        this._confirm = ''
    }

    async connectedCallback() {
        super.connectedCallback()
        const s = await auth.status()
        if (s.error) {
            this._error = s.error
            this._mode = 'error'
        } else {
            this._mode = s.hasPassword ? 'login' : 'setup'
        }
    }

    async _onSubmit(e) {
        e.preventDefault()
        this._error = null
        this._loading = true

        try {
            if (this._mode === 'setup') {
                if (this._password.length < 6) {
                    this._error = 'Passwort muss mindestens 6 Zeichen lang sein.'
                    return
                }
                if (this._password !== this._confirm) {
                    this._error = 'Passwörter stimmen nicht überein.'
                    return
                }
                const res = await auth.setup(this._password)
                if (res.error) {
                    this._error = res.error
                    return
                }
                this._dispatchAuth()
            } else {
                const res = await auth.login(this._password)
                if (res.error) {
                    this._error = res.error
                    return
                }
                this._dispatchAuth()
            }
        } finally {
            this._loading = false
            this._password = ''
            this._confirm = ''
        }
    }

    _dispatchAuth() {
        this.dispatchEvent(new CustomEvent('authenticated', { bubbles: true, composed: true }))
    }

    render() {
        if (this._mode === 'loading')
            return html`
                <div class="min-h-screen bg-base-100 flex items-center justify-center">
                    <span class="loading loading-spinner loading-lg"></span>
                </div>
            `

        if (this._mode === 'error')
            return html`
                <div class="min-h-screen bg-base-100 flex items-center justify-center p-4">
                    <div class="alert alert-error max-w-sm">
                        <span>${this._error}</span>
                        <button
                            class="btn btn-sm btn-ghost"
                            @click=${() => {
                                this._mode = 'loading'
                                this.connectedCallback()
                            }}
                        >
                            ↻ Retry
                        </button>
                    </div>
                </div>
            `

        const isSetup = this._mode === 'setup'

        return html`
            <div class="min-h-screen bg-base-100 flex items-center justify-center p-4">
                <div class="w-full max-w-sm">
                    <!-- Logo -->
                    <div class="text-center mb-8">
                        <div class="mb-3">${logoIcon(48)}</div>
                        <h1 class="text-2xl font-bold tracking-tight">FlowCrafter UI</h1>
                        <p class="text-sm text-base-content/40 mt-1">
                            ${isSetup ? 'Lege ein Passwort fest, um fortzufahren.' : 'Bitte melde dich an.'}
                        </p>
                    </div>

                    <!-- Card -->
                    <div class="card bg-base-200 border border-base-300">
                        <div class="card-body gap-4">
                            <h2 class="card-title text-base">${isSetup ? 'Passwort festlegen' : 'Anmelden'}</h2>

                            <form @submit=${this._onSubmit} class="flex flex-col gap-3">
                                <div class="form-control">
                                    <label class="label py-1">
                                        <span class="label-text text-xs">Passwort</span>
                                    </label>
                                    <input
                                        type="password"
                                        class="input input-bordered input-sm"
                                        placeholder="••••••••"
                                        autocomplete="${isSetup ? 'new-password' : 'current-password'}"
                                        .value=${this._password}
                                        @input=${e => {
                                            this._password = e.target.value
                                            this._error = null
                                        }}
                                        ?disabled=${this._loading}
                                        required
                                    />
                                </div>

                                ${isSetup
                                    ? html`
                                          <div class="form-control">
                                              <label class="label py-1">
                                                  <span class="label-text text-xs">Passwort wiederholen</span>
                                              </label>
                                              <input
                                                  type="password"
                                                  class="input input-bordered input-sm"
                                                  placeholder="••••••••"
                                                  autocomplete="new-password"
                                                  .value=${this._confirm}
                                                  @input=${e => {
                                                      this._confirm = e.target.value
                                                      this._error = null
                                                  }}
                                                  ?disabled=${this._loading}
                                                  required
                                              />
                                          </div>
                                      `
                                    : ''}
                                ${this._error
                                    ? html`
                                          <div class="alert alert-error py-2 px-3 text-xs">
                                              <span>${this._error}</span>
                                          </div>
                                      `
                                    : ''}

                                <button type="submit" class="btn btn-primary btn-sm mt-1" ?disabled=${this._loading}>
                                    ${this._loading
                                        ? html`<span class="loading loading-spinner loading-xs"></span>`
                                        : isSetup
                                          ? 'Passwort speichern'
                                          : 'Anmelden'}
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        `
    }
}

customElements.define('fc-login', FcLogin)

import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { connection } from '../services/connection.js'

export class FcServiceSetup extends BaseElement {
    static properties = {
        _url: { state: true },
        _secret: { state: true },
        _error: { state: true },
        _loading: { state: true },
    }

    constructor() {
        super()
        this._url = connection.getUrl()
        this._secret = connection.getSecret()
        this._error = null
        this._loading = false
    }

    async _onSubmit(e) {
        e.preventDefault()
        const url = this._url.trim()
        if (!url) {
            this._error = 'Bitte eine URI eingeben.'
            return
        }

        this._error = null
        this._loading = true

        try {
            const result = await connection.ping(url, this._secret.trim())
            if (result.ok) {
                const saved = await connection.save(url, this._secret.trim())
                if (!saved) {
                    this._error = 'Verbindung konnte nicht gespeichert werden.'
                    return
                }
                this.dispatchEvent(new CustomEvent('connected', { bubbles: true, composed: true }))
            } else if (result.error === '401') {
                this._error = 'Zugriff verweigert (401). Bitte Secret prüfen.'
            } else {
                this._error = 'Service nicht erreichbar. Bitte URI prüfen.'
            }
        } finally {
            this._loading = false
        }
    }

    render() {
        const isEdit = connection.isConfigured()

        return html`
            <div class="min-h-screen bg-base-100 flex items-center justify-center p-4">
                <div class="w-full max-w-sm">
                    <div class="text-center mb-8">
                        <div class="text-4xl mb-3">⚡</div>
                        <h1 class="text-2xl font-bold tracking-tight">FlowCrafter UI</h1>
                        <p class="text-sm text-base-content/40 mt-1">
                            ${isEdit ? 'Verbindung bearbeiten.' : 'Verbinde dich mit dem FlowCrafter Service.'}
                        </p>
                    </div>

                    <div class="card bg-base-200 border border-base-300">
                        <div class="card-body gap-4">
                            <h2 class="card-title text-base">Service-Verbindung</h2>

                            <form @submit=${this._onSubmit} class="flex flex-col gap-3">
                                <div class="form-control">
                                    <label class="label py-1">
                                        <span class="label-text text-xs">Service URI</span>
                                    </label>
                                    <input
                                        type="url"
                                        class="input input-bordered input-sm font-mono"
                                        placeholder="http://localhost:8000"
                                        .value=${this._url}
                                        @input=${e => {
                                            this._url = e.target.value
                                            this._error = null
                                        }}
                                        ?disabled=${this._loading}
                                        required
                                        autofocus
                                    />
                                </div>

                                <div class="form-control">
                                    <label class="label py-1">
                                        <span class="label-text text-xs">Secret <span class="text-base-content/40">(optional)</span></span>
                                    </label>
                                    <input
                                        type="password"
                                        class="input input-bordered input-sm font-mono"
                                        placeholder="••••••••"
                                        autocomplete="off"
                                        .value=${this._secret}
                                        @input=${e => {
                                            this._secret = e.target.value
                                            this._error = null
                                        }}
                                        ?disabled=${this._loading}
                                    />
                                </div>

                                ${this._error
                                    ? html`
                                          <div class="alert alert-error py-2 px-3 text-xs">
                                              <span>${this._error}</span>
                                          </div>
                                      `
                                    : ''}

                                <div class="flex gap-2 mt-1">
                                    ${isEdit
                                        ? html`
                                              <button
                                                  type="button"
                                                  class="btn btn-ghost btn-sm flex-1"
                                                  ?disabled=${this._loading}
                                                  @click=${() =>
                                                      this.dispatchEvent(
                                                          new CustomEvent('cancel', { bubbles: true, composed: true })
                                                      )}
                                              >
                                                  Abbrechen
                                              </button>
                                          `
                                        : ''}
                                    <button type="submit" class="btn btn-primary btn-sm flex-1" ?disabled=${this._loading}>
                                        ${this._loading
                                            ? html`<span class="loading loading-spinner loading-xs"></span>`
                                            : 'Verbinden'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        `
    }
}

customElements.define('fc-service-setup', FcServiceSetup)

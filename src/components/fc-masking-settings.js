import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { masking } from '../services/masking.js'

export class FcMaskingSettings extends BaseElement {
    static properties = {
        _rules: { state: true },
        _newField: { state: true },
        _loading: { state: true },
    }

    constructor() {
        super()
        this._rules = []
        this._newField = ''
        this._loading = true
    }

    async connectedCallback() {
        super.connectedCallback()
        await this._loadRules()
    }

    async _loadRules() {
        this._loading = true
        const saved = await masking.loadRules()
        if (saved && saved.length > 0) {
            this._rules = saved
        } else {
            this._rules = [...masking.DEFAULT_RULES]
        }
        this._loading = false
    }

    async _save() {
        await masking.saveRules(this._rules)
    }

    _toggleRule(index) {
        this._rules = this._rules.map((r, i) => (i === index ? { ...r, enabled: !r.enabled } : r))
        this._save()
    }

    _removeRule(index) {
        this._rules = this._rules.filter((_, i) => i !== index)
        this._save()
    }

    _addRule() {
        const field = this._newField.trim()
        if (!field) return
        if (this._rules.some(r => r.field.toLowerCase() === field.toLowerCase())) return
        this._rules = [...this._rules, { field, enabled: true, isDefault: false }]
        this._newField = ''
        this._save()
    }

    _onKeydown(e) {
        if (e.key === 'Enter') this._addRule()
    }

    render() {
        if (this._loading) {
            return html`<div class="flex items-center justify-center p-8">
                <span class="loading loading-spinner loading-md"></span>
            </div>`
        }

        const defaultRules = this._rules.filter(r => r.isDefault)
        const customRules = this._rules.filter(r => !r.isDefault)

        return html`
            <p class="text-sm text-base-content/60 mb-5">
                Felder, deren Name einen der folgenden Begriffe enthält, werden in Message-Ausgaben automatisch maskiert. Der Abgleich
                erfolgt case-insensitive.
            </p>

            <!-- Add new rule -->
            <div class="flex gap-2 mb-6">
                <input
                    type="text"
                    class="input input-sm input-bordered flex-1"
                    placeholder="Neues Feld hinzufügen (z.B. username, age, ...)"
                    .value=${this._newField}
                    @input=${e => (this._newField = e.target.value)}
                    @keydown=${this._onKeydown}
                />
                <button class="btn btn-sm btn-primary" @click=${this._addRule} ?disabled=${!this._newField.trim()}>Hinzufügen</button>
            </div>

            <!-- Custom rules -->
            ${customRules.length > 0
                ? html`
                      <div class="mb-6">
                          <h3 class="text-sm font-semibold text-base-content/50 uppercase tracking-wide mb-3">Eigene Regeln</h3>
                          <div class="flex flex-wrap gap-2">
                              ${customRules.map(rule => {
                                  const idx = this._rules.indexOf(rule)
                                  return html`
                                      <div
                                          class="badge badge-lg gap-2 ${rule.enabled
                                              ? 'badge-primary'
                                              : 'badge-ghost opacity-50'} cursor-pointer select-none"
                                          @click=${() => this._toggleRule(idx)}
                                      >
                                          ${rule.field}
                                          <button
                                              class="btn btn-ghost btn-xs px-0 hover:text-error"
                                              @click=${e => {
                                                  e.stopPropagation()
                                                  this._removeRule(idx)
                                              }}
                                          >
                                              ✕
                                          </button>
                                      </div>
                                  `
                              })}
                          </div>
                      </div>
                  `
                : ''}

            <!-- Default rules -->
            <div>
                <h3 class="text-sm font-semibold text-base-content/50 uppercase tracking-wide mb-3">Standard-Regeln</h3>
                <div class="flex flex-wrap gap-2">
                    ${defaultRules.map(rule => {
                        const idx = this._rules.indexOf(rule)
                        return html`
                            <div
                                class="badge badge-lg ${rule.enabled
                                    ? 'badge-neutral'
                                    : 'badge-ghost opacity-50'} cursor-pointer select-none"
                                @click=${() => this._toggleRule(idx)}
                                title="${rule.enabled ? 'Klicken zum Deaktivieren' : 'Klicken zum Aktivieren'}"
                            >
                                ${rule.field}
                            </div>
                        `
                    })}
                </div>
                <p class="text-xs text-base-content/40 mt-2">Klicken zum Aktivieren/Deaktivieren</p>
            </div>
        `
    }
}

customElements.define('fc-masking-settings', FcMaskingSettings)

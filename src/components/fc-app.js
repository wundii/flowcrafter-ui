import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import './fc-schema-list.js'
import './fc-flow-list.js'
import './fc-flow-detail.js'
import './fc-exception-list.js'

const TABS = ['flows', 'exceptions']

export class FcApp extends BaseElement {
  static properties = {
    activeTab:        { state: true },
    selectedSource:   { state: true },   // schema level
    selectedFlowHash: { state: true },   // flow detail level
  }

  constructor() {
    super()
    this.activeTab        = 'flows'
    this.selectedSource   = null
    this.selectedFlowHash = null
  }

  _onSchemaSelected(e) {
    this.selectedSource   = e.detail.source
    this.selectedFlowHash = null
  }

  _onFlowSelected(e) {
    this.activeTab        = 'flows'
    this.selectedFlowHash = e.detail.hash
  }

  _onFlowLoaded(e) {
    if (!this.selectedSource) this.selectedSource = e.detail.source
  }

  _onBackToSchema() {
    this.selectedSource   = null
    this.selectedFlowHash = null
  }

  _onBackToList() {
    this.selectedFlowHash = null
  }

  _breadcrumb() {
    if (this.activeTab !== 'flows') return ''

    const crumbs = [
      { label: 'Schemas', action: this._onBackToSchema },
    ]
    if (this.selectedSource) {
      crumbs.push({
        label:  this.selectedSource.split('\\').pop(),
        action: this._onBackToList,
      })
    }
    if (this.selectedFlowHash) {
      crumbs.push({ label: this.selectedFlowHash.slice(0, 10) + '…', action: null })
    }

    return html`
      <div class="px-4 pt-2 pb-0 flex items-center gap-1 text-xs text-base-content/40">
        ${crumbs.map((c, i) => html`
          ${i > 0 ? html`<span>/</span>` : ''}
          ${c.action
            ? html`<button class="hover:text-base-content/70 transition-colors" @click=${c.action}>${c.label}</button>`
            : html`<span class="text-base-content/70">${c.label}</span>`}
        `)}
      </div>
    `
  }

  _renderContent() {
    if (this.activeTab === 'flows') {
      if (this.selectedFlowHash) {
        return html`
          <fc-flow-detail
            .hash=${this.selectedFlowHash}
            @back=${this._onBackToList}
          ></fc-flow-detail>
        `
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
      return html`
        <fc-schema-list @schema-selected=${this._onSchemaSelected}></fc-schema-list>
      `
    }
    return html`<fc-exception-list></fc-exception-list>`
  }

  render() {
    return html`
      <div class="min-h-screen bg-base-100">
        <div class="navbar bg-base-200 shadow-sm px-4">
          <div class="flex-1">
            <span class="text-xl font-bold tracking-tight">⚡ FlowCrafter UI</span>
          </div>
        </div>

        <div class="px-4 pt-4">
          <div role="tablist" class="tabs tabs-border">
            ${TABS.map(tab => html`
              <a
                role="tab"
                class="tab ${this.activeTab === tab ? 'tab-active' : ''}"
                @click=${() => {
                  this.activeTab        = tab
                  this.selectedSource   = null
                  this.selectedFlowHash = null
                }}
              >
                ${tab === 'flows' ? 'Flows' : 'Exceptions'}
              </a>
            `)}
          </div>
        </div>

        ${this._breadcrumb()}

        <main class="p-4" @flow-selected=${this._onFlowSelected} @flow-loaded=${this._onFlowLoaded}>
          ${this._renderContent()}
        </main>
      </div>
    `
  }
}

customElements.define('fc-app', FcApp)

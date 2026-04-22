import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'
import { renderApiError } from '../utils/error.js'
import { skeletonTypeGrid } from '../utils/skeleton.js'
import { timeEl } from '../utils/time.js'
import './fc-tooltip.js'

export class FcTypeList extends BaseElement {
    static properties = {
        _activeGroup: { state: true },
        _sortAsc: { state: true },
        error: { state: true },
        loading: { state: true },
        schemas: { state: true },
    }

    constructor() {
        super()
        this._activeGroup = null
        this._sortAsc = true
        this.error = null
        this.loading = true
        this.schemas = []
    }

    connectedCallback() {
        super.connectedCallback()
        this._load()
    }

    async _load() {
        this.loading = true
        this.error = null
        try {
            const from = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
            const to = new Date().toISOString()
            this.schemas = await api.getFlowTypes({ from, to })
        } catch (err) {
            this.error = err
        } finally {
            this.loading = false
        }
    }

    _groupMap() {
        const map = new Map()
        for (const s of this.schemas) {
            if (s.group) {
                if (!map.has(s.group)) map.set(s.group, [])
                map.get(s.group).push(s)
            }
        }
        return map
    }

    _ungrouped() {
        const dir = this._sortAsc ? 1 : -1
        return this.schemas.filter(s => !s.group).sort((a, b) => dir * a.prefix.localeCompare(b.prefix))
    }

    _sortedInGroup(items) {
        const dir = this._sortAsc ? 1 : -1
        return [...items].sort((a, b) => dir * a.prefix.localeCompare(b.prefix))
    }

    _onSelect(schema) {
        this.dispatchEvent(
            new CustomEvent('schema-selected', {
                detail: { prefix: schema.prefix },
                bubbles: true,
                composed: true,
            })
        )
    }

    _renderSchemaCard(schema) {
        const hasFailed = schema.successRate !== null && schema.successRate < 95
        const hasRuns = schema.total > 0
        const rateColor =
            schema.successRate === null
                ? 'text-base-content/30'
                : schema.successRate === 100
                  ? 'text-success'
                  : schema.successRate >= 95
                    ? 'text-success/60'
                    : schema.successRate >= 85
                      ? 'text-warning'
                      : schema.successRate >= 70
                        ? 'text-warning/70'
                        : schema.successRate >= 50
                          ? 'text-error/60'
                          : schema.successRate >= 30
                            ? 'text-error/80'
                            : 'text-error'

        const borderClass = hasFailed ? 'border-error/25 hover:border-error/30' : 'border-base-300 hover:border-primary/30'
        const gradientClass = hasFailed ? 'from-error/5' : 'from-primary/5'
        const iconClass = hasFailed ? 'bg-error/10 text-error' : 'bg-primary/10 text-primary'

        return html`
            <div
                class="rounded-box border bg-base-200 cursor-pointer hover:shadow-md transition-all duration-200 flex flex-col group ${borderClass}"
                @click=${() => this._onSelect(schema)}
            >
                <!-- Card header with gradient -->
                <div class="px-4 pt-4 pb-3 bg-gradient-to-br ${gradientClass} via-transparent to-transparent">
                    <div class="flex items-start gap-2.5">
                        <div class="w-8 h-8 rounded-lg ${iconClass} flex items-center justify-center shrink-0 mt-0.5">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 3M21 7.5H7.5"
                                />
                            </svg>
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="font-bold text-sm leading-tight truncate" title="${schema.prefix}">${schema.prefix}</div>
                            <div class="text-xs text-base-content/35 mt-1 font-mono">
                                ${schema.lastTime ? timeEl(schema.lastTime) : '–'}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Stats row -->
                <div class="grid grid-cols-3 divide-x divide-base-300/50 text-center py-3 flex-1 border-t border-base-300/50">
                    <div class="px-2">
                        <div class="text-2xl font-bold text-base-content/80">${schema.total}</div>
                        <div class="text-xs text-base-content/40 mt-0.5">Runs</div>
                    </div>
                    <div class="px-2">
                        <div class="text-2xl font-bold ${hasFailed ? 'text-error' : 'text-base-content/20'}">${schema.failed}</div>
                        <div class="text-xs text-base-content/40 mt-0.5">Fehler</div>
                    </div>
                    <div class="px-2">
                        <div class="text-2xl font-bold ${rateColor}">${hasRuns ? html`${schema.successRate}%` : html`—`}</div>
                        <div class="text-xs text-base-content/40 mt-0.5">OK-Rate</div>
                    </div>
                </div>
            </div>
        `
    }

    _renderGroupCard(groupName, items) {
        const count = items.length
        const sorted = this._sortedInGroup(items)

        return html`
            <div
                class="rounded-box border border-base-300 bg-base-200 hover:border-primary/30 hover:shadow-md transition-all duration-200 flex flex-col cursor-pointer group"
                @click=${() => {
                    this._activeGroup = groupName
                }}
            >
                <div class="px-4 pt-4 pb-3 bg-gradient-to-br from-primary/5 via-transparent to-transparent flex-1">
                    <div class="flex items-start gap-2.5">
                        <div class="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v8.25A2.25 2.25 0 0 0 4.5 16.5h15a2.25 2.25 0 0 0 2.25-2.25V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
                                />
                            </svg>
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="font-bold text-sm leading-tight truncate">${groupName}</div>
                            <div class="text-xs text-base-content/35 mt-1">
                                <span class="badge badge-xs badge-ghost">${count}</span>
                                Flow${count !== 1 ? 's' : ''}
                            </div>
                            <div class="mt-2 flex flex-col gap-1">
                                ${sorted.slice(0, 5).map(s => {
                                    const rateColor =
                                        s.successRate === null
                                            ? 'text-base-content/25'
                                            : s.successRate === 100
                                              ? 'text-success/70'
                                              : s.successRate >= 85
                                                ? 'text-warning/70'
                                                : 'text-error/70'
                                    return html`
                                        <div class="flex items-center justify-between gap-2 min-w-0">
                                            <div class="text-[11px] text-base-content/40 truncate font-mono">${s.prefix}</div>
                                            <div class="flex items-center gap-1.5 shrink-0">
                                                <span class="text-[10px] text-base-content/30">${s.total}</span>
                                                <span class="text-[10px] font-semibold ${rateColor}"
                                                    >${s.successRate !== null ? s.successRate + '%' : '—'}</span
                                                >
                                            </div>
                                        </div>
                                    `
                                })}
                                ${sorted.length > 5 ? html`<div class="text-[11px] text-base-content/30">…</div>` : ''}
                            </div>
                        </div>
                        <svg
                            class="w-4 h-4 text-base-content/20 group-hover:text-primary/40 transition-colors shrink-0 mt-1"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            viewBox="0 0 24 24"
                        >
                            <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                    </div>
                </div>
            </div>
        `
    }

    _renderToolbar(showBack = false) {
        return html`
            <div class="flex items-center justify-between mb-4">
                <div class="flex items-center gap-2">
                    ${showBack
                        ? html`
                              <button
                                  class="btn btn-sm btn-ghost border border-base-content/30 hover:border-base-content/50 gap-1.5"
                                  @click=${() => (this._activeGroup = null)}
                              >
                                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                      <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                                  </svg>
                                  Zurück
                              </button>
                              <span class="font-semibold text-sm">${this._activeGroup}</span>
                          `
                        : html`
                              <span class="text-sm text-base-content/60">
                                  <span class="font-semibold">${this.schemas.length}</span>
                                  Flow${this.schemas.length !== 1 ? 's' : ''}
                                  <span class="text-base-content/40 ml-1">— Runs der letzten 14 Tage</span>
                              </span>
                          `}
                </div>
                <div class="flex items-center gap-1">
                    <fc-tooltip
                        position="bottom"
                        text=${this._sortAsc ? 'A → Z' : 'Z → A'}
                        .content=${html`
                            <button
                                class="btn btn-sm btn-ghost btn-circle border border-base-content/30 hover:border-base-content/50"
                                @click=${() => (this._sortAsc = !this._sortAsc)}
                            >
                                <svg
                                    class="w-3.5 h-3.5 transition-transform ${this._sortAsc ? '' : 'rotate-180'}"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    viewBox="0 0 24 24"
                                >
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M3 4h13M3 8h9M3 12h5m4 0l4-4m0 0l4 4m-4-4v12" />
                                </svg>
                            </button>
                        `}
                    ></fc-tooltip>
                    <fc-tooltip
                        position="bottom"
                        text="Neu laden"
                        .content=${html`
                            <button
                                class="btn btn-sm btn-ghost btn-circle border border-base-content/30 hover:border-base-content/50"
                                @click=${() => this._load()}
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
        `
    }

    render() {
        if (this.loading) return skeletonTypeGrid()

        if (this.error) return renderApiError(this.error, { compact: true, retry: this._load })

        if (this.schemas.length === 0) return html`<div class="alert alert-info"><span>Keine Types gefunden.</span></div>`

        // Group view
        if (this._activeGroup !== null) {
            const groupMap = this._groupMap()
            const items = this._sortedInGroup(groupMap.get(this._activeGroup) ?? [])
            return html`
                ${this._renderToolbar(true)}
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                    ${items.map(s => this._renderSchemaCard(s))}
                </div>
            `
        }

        // Root view
        const groupMap = this._groupMap()
        const sortedGroups = [...groupMap.entries()].sort(([a], [b]) => a.localeCompare(b))
        const ungrouped = this._ungrouped()

        return html`
            ${this._renderToolbar(false)}
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                ${sortedGroups.map(([name, items]) => this._renderGroupCard(name, items))} ${ungrouped.map(s => this._renderSchemaCard(s))}
            </div>
        `
    }
}

customElements.define('fc-type-list', FcTypeList)

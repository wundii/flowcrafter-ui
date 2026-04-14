import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'
import { renderApiError } from '../utils/error.js'
import { formatDuration } from '../utils/duration.js'
import { unsafeSVG } from 'lit/directives/unsafe-svg.js'
import './fc-info-box.js'
import './fc-json-editor.js'
import './fc-source-viewer.js'

// ─── Layout constants ─────────────────────────────────────────────────────────
const NODE_W = 220
const HEADER_H = 28
const PORT_ROW_H = 26
const PORT_PAD_V = 5
const PORT_R = 5
const COL_GAP = 90
const ROW_GAP = 12
const PAD_X = 36
const PAD_Y = 32
const LONG_EDGE_AREA = 40 // extra canvas space at top for arced long edges
const TIMING_ROW_H = 16 // height of the per-stub timing row shown below the header

// ─── Node sizing ──────────────────────────────────────────────────────────────
function nodeHeight(stub, withTimingRow = false) {
    return (
        HEADER_H +
        (withTimingRow ? TIMING_ROW_H : 0) +
        PORT_PAD_V * 2 +
        Math.max(stub.messages.length, stub.returnTypes.length, 1) * PORT_ROW_H
    )
}

function portAreaH(stub) {
    return Math.max(stub.messages.length, stub.returnTypes.length, 1) * PORT_ROW_H
}

function inputPortY(stub, i, withTimingRow = false) {
    const n = stub.messages.length || 1
    const slotH = portAreaH(stub) / n
    return HEADER_H + (withTimingRow ? TIMING_ROW_H : 0) + PORT_PAD_V + i * slotH + slotH / 2
}

function outputPortY(stub, j, withTimingRow = false) {
    const n = stub.returnTypes.length || 1
    const slotH = portAreaH(stub) / n
    return HEADER_H + (withTimingRow ? TIMING_ROW_H : 0) + PORT_PAD_V + j * slotH + slotH / 2
}

// ─── Status ───────────────────────────────────────────────────────────────────
function getNodeStatus(src, flowMessages, flowExceptions, flowResults) {
    if (flowExceptions.some(e => e.stubSource === src)) return 'error'
    const stubResults = flowResults.filter(r => r.stubSource === src)
    if (stubResults.length > 0 && stubResults.some(r => r.result === false)) return 'rejected'
    const msgs = flowMessages.filter(m => m.stubSource === src)
    if (msgs.some(m => m.messageType === 'finish')) return 'success'
    if (msgs.some(m => m.messageType === 'process')) return 'running'
    if (msgs.some(m => m.messageType === 'wait')) return 'waiting'
    return 'idle'
}

const STATUS = {
    success: { color: '#22c55e', label: '✓', bg: 'rgba(34,197,94,0.10)' },
    rejected: { color: '#f97316', label: '✗', bg: 'rgba(249,115,22,0.10)' },
    error: { color: '#ef4444', label: '✕', bg: 'rgba(239,68,68,0.10)' },
    running: { color: '#3b82f6', label: '▷', bg: 'rgba(59,130,246,0.10)' },
    waiting: { color: '#eab308', label: '…', bg: 'rgba(234,179,8,0.10)' },
    idle: { color: '#4b5563', label: '○', bg: 'rgba(75,85,99,0.08)' },
}

const DIFF_STATUS = {
    added: { color: '#22c55e', label: '+', bg: 'rgba(34,197,94,0.12)' },
    changed: { color: '#f97316', label: '~', bg: 'rgba(249,115,22,0.12)' },
    messageDrift: { color: '#eab308', label: '!', bg: 'rgba(234,179,8,0.12)' },
    unchanged: { color: '#4b5563', label: '○', bg: 'rgba(75,85,99,0.08)' },
}

const MSG_COLOR = { finish: '#22c55e', process: '#3b82f6', wait: '#eab308' }

// ─── Graph layout ─────────────────────────────────────────────────────────────
function buildLayout(stubs, withTimingRow = false) {
    const stubMap = Object.fromEntries(stubs.map(s => [s.source, s]))
    const adjList = Object.fromEntries(stubs.map(s => [s.source, []]))
    const edges = []

    for (const from of stubs) {
        from.returnTypes.forEach((rt, outIdx) => {
            for (const to of stubs) {
                if (to.source === from.source) continue
                const inIdx = to.messages.indexOf(rt)
                if (inIdx >= 0) {
                    adjList[from.source].push(to.source)
                    edges.push({
                        from: from.source,
                        to: to.source,
                        outIdx,
                        inIdx,
                        messageClass: rt,
                    })
                }
            }
        })
    }

    // Longest-path column assignment via BFS from init stub
    const col = {}
    const initStub = stubs.find(s => s.messageEnum === 'init')
    if (initStub) {
        const queue = [[initStub.source, 0]]
        while (queue.length) {
            const [src, c] = queue.shift()
            col[src] = Math.max(col[src] ?? 0, c)
            for (const next of adjList[src]) queue.push([next, c + 1])
        }
    }
    for (const s of stubs) {
        if (!(s.source in col)) col[s.source] = 0
    }

    const byCol = {}
    for (const [src, c] of Object.entries(col)) {
        ;(byCol[c] = byCol[c] ?? []).push(src)
    }
    const numCols = Object.keys(byCol).length

    // Check if any edge spans more than 1 column (needs top routing space)
    const hasLongEdge = edges.some(e => (col[e.to] ?? 0) - (col[e.from] ?? 0) > 1)
    const topOffset = hasLongEdge ? LONG_EDGE_AREA : 0

    const positions = {}
    let svgH = 0
    for (let c = 0; c < numCols; c++) {
        let y = PAD_Y + topOffset
        for (const src of byCol[c] ?? []) {
            positions[src] = { x: PAD_X + c * (NODE_W + COL_GAP), y }
            y += nodeHeight(stubMap[src], withTimingRow) + ROW_GAP
        }
        svgH = Math.max(svgH, y - ROW_GAP + PAD_Y)
    }
    const svgW = PAD_X * 2 + numCols * NODE_W + (numCols - 1) * COL_GAP

    return { edges, positions, svgW, svgH, stubMap, colOf: col, topOffset }
}

// ─── Theme colors ─────────────────────────────────────────────────────────────
function getThemeColors() {
    const cs = getComputedStyle(document.documentElement)
    return {
        bg1: cs.getPropertyValue('--color-base-100').trim(),
        bg2: cs.getPropertyValue('--color-base-200').trim(),
        content: cs.getPropertyValue('--color-base-content').trim(),
    }
}

// ─── SVG string builder ───────────────────────────────────────────────────────
function buildSvgString(
    edges,
    positions,
    stubs,
    stubMap,
    flowMessages,
    flowExceptions,
    flowResults,
    colOf,
    topOffset,
    bgColor,
    bg2Color,
    withTimingRow = false
) {
    const statusOf = src => getNodeStatus(src, flowMessages, flowExceptions, flowResults)
    const colorOf = src => STATUS[statusOf(src)].color

    const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    const bezierNormal = (x1, y1, x2, y2) => {
        const t = Math.min(Math.abs(x2 - x1) * 0.55, 180)
        return `M ${x1} ${y1} C ${x1 + t} ${y1}, ${x2 - t} ${y2}, ${x2} ${y2}`
    }

    const bezierLong = (x1, y1, x2, y2) => {
        const yTop = topOffset / 2
        const xWp1 = x1 + COL_GAP
        const xWp2 = x2 - COL_GAP
        const t = COL_GAP / 2
        return [
            `M ${x1} ${y1}`,
            `C ${x1 + t} ${y1}, ${xWp1 - t} ${yTop}, ${xWp1} ${yTop}`,
            `L ${xWp2} ${yTop}`,
            `C ${xWp2 + t} ${yTop}, ${x2 - t} ${y2}, ${x2} ${y2}`,
        ].join(' ')
    }

    const parts = []

    parts.push('<defs>')
    for (const [key, val] of Object.entries(STATUS)) {
        parts.push(`<marker id="arr-${key}" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <polygon points="0 0,8 3,0 6" fill="${esc(val.color)}" fill-opacity="0.85"/>
    </marker>`)
    }
    parts.push('</defs>')

    for (const e of edges) {
        const fp = positions[e.from],
            tp = positions[e.to]
        if (!fp || !tp) continue
        const x1 = fp.x + NODE_W,
            y1 = fp.y + outputPortY(stubMap[e.from], e.outIdx, withTimingRow)
        const x2 = tp.x,
            y2 = tp.y + inputPortY(stubMap[e.to], e.inIdx, withTimingRow)
        const colSpan = (colOf[e.to] ?? 0) - (colOf[e.from] ?? 0)
        const isLong = colSpan > 1
        const d = isLong ? bezierLong(x1, y1, x2, y2) : bezierNormal(x1, y1, x2, y2)
        const st = statusOf(e.from)
        const col = STATUS[st].color
        const run = st === 'success' || st === 'error'

        parts.push(`<path d="${esc(d)}"
      stroke="${esc(col)}" stroke-width="${run ? 2 : 1.5}"
      stroke-opacity="${run ? 0.85 : 0.3}"
      stroke-dasharray="${run ? 'none' : '6 4'}"
      fill="none" marker-end="url(#arr-${st})"/>`)

        if (run) {
            parts.push(`<path d="${esc(d)}"
        stroke="${esc(col)}" stroke-width="2" stroke-opacity="0.3"
        stroke-dasharray="8 12" fill="none" class="fc-edge-flow"/>`)
        }
    }

    for (const stub of stubs) {
        const pos = positions[stub.source]
        const col = colorOf(stub.source)
        for (let i = 0; i < stub.messages.length; i++) {
            parts.push(`<circle cx="${pos.x}" cy="${pos.y + inputPortY(stub, i, withTimingRow)}"
        r="${PORT_R}" fill="${esc(bg2Color)}" stroke="${esc(col)}" stroke-width="2"/>`)
        }
        for (let j = 0; j < stub.returnTypes.length; j++) {
            parts.push(`<circle cx="${pos.x + NODE_W}" cy="${pos.y + outputPortY(stub, j, withTimingRow)}"
        r="${PORT_R}" fill="${esc(bg2Color)}" stroke="${esc(col)}" stroke-width="2"/>`)
        }
    }

    return parts.join('\n')
}

// ─── CSS animation (once) ─────────────────────────────────────────────────────
let animInjected = false
function injectAnimation() {
    if (animInjected) return
    const s = document.createElement('style')
    s.textContent = `
    @keyframes fc-flow { from { stroke-dashoffset: 20; } to { stroke-dashoffset: 0; } }
    .fc-edge-flow { animation: fc-flow 0.6s linear infinite; }
    .fc-node { transition: box-shadow 0.15s, filter 0.15s; }
    .fc-node:hover { filter: brightness(1.15); }
  `
    document.head.appendChild(s)
    animInjected = true
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const short = fqn => fqn?.split('\\').pop() ?? fqn
const fmtDate = iso => new Date(iso).toLocaleString('de-DE', { timeStyle: 'medium', dateStyle: 'short' })
const fmtJson = (obj, max = 30) => {
    const s = JSON.stringify(obj)
    return s.length > max ? s.slice(0, max) + '…' : s
}

// ─── Component ────────────────────────────────────────────────────────────────
export class FcFlowGraph extends BaseElement {
    static properties = {
        _diffTooltip: { state: true }, // { x, y, source, diff } | null
        _excTooltip: { state: true }, // { x, y, exc } | null
        _modalMsg: { state: true }, // { stubSource, messageClass, payload, valid }
        _observerRunning: { state: true },
        _sendError: { state: true },
        _sending: { state: true },
        _stubSelection: { state: true }, // { stubs: [{source, checked}], queued: bool } | null
        _stubSource: { state: true },
        _stubSourceCurrent: { state: true },
        _stubSourceError: { state: true },
        _stubSourceName: { state: true },
        _tooltip: { state: true }, // { x, y, label, data } | null
        flow: { type: Object },
        messageSchemas: { type: Object }, // { [fqClassName]: { [propName]: typeString } } — optional, only passed from devtool
        priorRuns: { type: Array }, // all runs up to and including the selected run (oldest first)
        readonly: { type: Boolean },
        runExceptions: { type: Array }, // overrides flow.flowExceptions for a specific run
        runId: { type: String },
        runMessages: { type: Array }, // overrides flow.flowMessages for a specific run
        runResults: { type: Array }, // overrides flow.flowResults for a specific run
        selectedStub: { state: true },
        stubDiff: { type: Object }, // { [source]: { status: 'added'|'changed'|'unchanged', changes: {messages:{added,removed},returnTypes:{added,removed}} } }
    }

    constructor() {
        super()
        this._diffTooltip = null
        this._diffTooltipTimer = null
        this._excTooltip = null
        this._excTooltipTimer = null
        this._modalMsg = null
        this._observerRunning = false
        this._sendError = null
        this._sending = false
        this._stubSelection = null
        this._stubSource = null
        this._stubSourceCurrent = true
        this._stubSourceError = null
        this._stubSourceName = null
        this._tooltip = null
        this.flow = null
        this.priorRuns = null
        this.readonly = false
        this.runExceptions = null
        this.runId = null
        this.runMessages = null
        this.runResults = null
        this.selectedStub = null
        this.stubDiff = null
        injectAnimation()
    }

    _showTooltip(e, label, messageSource, data) {
        if (!data) return
        clearTimeout(this._tooltipTimer)
        const hostRect = this.getBoundingClientRect()
        const elRect = e.currentTarget.getBoundingClientRect()
        const tooltipWidth = 360
        const xLeft = elRect.left - hostRect.left
        const alignRight = xLeft + tooltipWidth > hostRect.width
        this._tooltip = {
            x: alignRight ? hostRect.width - (elRect.right - hostRect.left) : xLeft,
            alignRight,
            y: elRect.bottom - hostRect.top + 6,
            label,
            messageSource,
            data,
        }
    }

    _hideTooltip() {
        this._tooltipTimer = setTimeout(() => (this._tooltip = null), 150)
    }

    _onTooltipEnter() {
        clearTimeout(this._tooltipTimer)
    }

    _openModal(stubSource, messageClass, msgData) {
        this._modalMsg = {
            stubSource,
            messageClass,
            payload: msgData?.message !== null && msgData?.message !== undefined ? JSON.stringify(msgData.message, null, 2) : '{}',
            valid: true,
        }
        api.getInfo()
            .then(info => {
                this._observerRunning = (info?.workers?.length ?? 0) > 0
            })
            .catch(() => {
                this._observerRunning = false
            })
        this.updateComplete.then(() => {
            this.querySelector('#fc-stub-input-modal')?.showModal()
        })
    }

    _closeModal() {
        this.querySelector('#fc-stub-input-modal')?.close()
        this._modalMsg = null
        this._sendError = null
    }

    async _openSourceModal(stubSource, stubHash) {
        if (this.readonly) {
            this.dispatchEvent(new CustomEvent('source-requested', { detail: { source: stubSource }, bubbles: true, composed: true }))
            return
        }
        this._stubSource = null
        this._stubSourceCurrent = true
        this._stubSourceError = null
        this._stubSourceName = stubSource
        try {
            const data = stubHash ? await api.getStubSourceByHash(stubHash) : await api.getStubSource(stubSource)
            this._stubSource = data.source ?? ''
            this._stubSourceCurrent = data.current !== false
            this.updateComplete.then(() => {
                this.querySelector('#fc-stub-source-modal')?.showModal()
            })
        } catch (err) {
            if (err.message.includes('404')) {
                this._stubSourceError = `${stubSource} ist nicht mehr verfügbar.`
            } else {
                this._stubSourceError = err
            }
            this.updateComplete.then(() => {
                this.querySelector('#fc-stub-source-modal')?.showModal()
            })
        }
    }

    _closeSourceModal() {
        this.querySelector('#fc-stub-source-modal')?.close()
        this._stubSource = null
        this._stubSourceCurrent = true
        this._stubSourceError = null
        this._stubSourceName = null
    }

    _onEditorChange(e) {
        this._modalMsg = { ...this._modalMsg, payload: e.detail.value, valid: e.detail.valid }
    }

    _getStubsForMessageSource(messageClass) {
        const stubs = this.flow?.flowSchema?.stubs ?? []
        return stubs.filter(s => s.messages.includes(messageClass))
    }

    async _onSend(queued = false) {
        if (!this._modalMsg?.valid || this._sending) return

        const targetStubs = this._getStubsForMessageSource(this._modalMsg.messageClass)
        if (targetStubs.length > 1) {
            this._stubSelection = {
                stubs: targetStubs.map(s => ({ source: s.source, checked: true })),
                queued,
            }
            this.updateComplete.then(() => {
                this.querySelector('#fc-stub-selection-modal')?.showModal()
            })
            return
        }

        await this._executeSend(queued)
    }

    async _executeSend(queued = false, includeStubs = []) {
        this._sending = true
        this._sendError = null
        try {
            const message = JSON.parse(this._modalMsg.payload)
            let runtimeHash = null
            if (queued) {
                await api.queueFlow(this.flow.flowHash, this._modalMsg.messageClass, message, includeStubs)
            } else {
                const result = await api.runFlow(this.flow.flowHash, this._modalMsg.messageClass, message, includeStubs)
                runtimeHash = result?.runtimeHash ?? null
            }
            this._closeModal()
            this.dispatchEvent(
                new CustomEvent('run-complete', {
                    detail: { queued, runtimeHash },
                    bubbles: true,
                    composed: true,
                })
            )
        } catch (err) {
            this._sendError = err
        } finally {
            this._sending = false
        }
    }

    _toggleStubSelection(index) {
        const stubs = [...this._stubSelection.stubs]
        stubs[index] = { ...stubs[index], checked: !stubs[index].checked }
        this._stubSelection = { ...this._stubSelection, stubs }
    }

    _closeStubSelection() {
        this.querySelector('#fc-stub-selection-modal')?.close()
        this._stubSelection = null
    }

    async _confirmStubSelection() {
        const { queued, stubs } = this._stubSelection
        const includeStubs = stubs.filter(s => s.checked).map(s => s.source)
        this._closeStubSelection()
        await this._executeSend(queued, includeStubs)
    }

    render() {
        if (!this.flow?.flowSchema?.stubs?.length) return html``

        const { stubs } = this.flow.flowSchema
        const flowMessages = this.runMessages ?? this.flow.flowMessages ?? []
        const flowExceptions = this.runExceptions ?? this.flow.flowExceptions ?? []
        const flowResults = this.runResults ?? this.flow.flowResults ?? []

        // Stub timing: read pre-computed timings from the run's flowStubTimings array
        const currentRun = this.runId !== null ? ((this.flow?.flowRuns ?? []).find(r => r.flowRuntimeHash === this.runId) ?? null) : null
        const hasTimings = Array.isArray(currentRun?.flowStubTimings) && currentRun.flowStubTimings.length > 0
        const stubTimingsMap = {}
        if (hasTimings) {
            for (const timing of currentRun.flowStubTimings) {
                stubTimingsMap[timing.stubSource] = timing
            }
        }

        const { edges, positions, svgW, svgH, stubMap, colOf, topOffset } = buildLayout(stubs, hasTimings)

        const statusOf = src => getNodeStatus(src, flowMessages, flowExceptions, flowResults)
        const styleOf = src => {
            if (this.stubDiff?.[src]) return DIFF_STATUS[this.stubDiff[src].status] ?? STATUS[statusOf(src)]
            return STATUS[statusOf(src)]
        }
        const msgsOf = src => flowMessages.filter(m => m.stubSource === src)
        const excsOf = src => flowExceptions.filter(e => e.stubSource === src)
        const ressOf = src => flowResults.filter(r => r.stubSource === src)
        const outgoingOf = rt => flowMessages.find(m => m.messageSource === rt)

        // Accumulated label + color: for stubs without activity in the current run,
        // show the label and color from the most recent prior run that had activity for that stub.
        const accIndicatorOf = src => {
            if (this.priorRuns?.length) {
                for (let i = this.priorRuns.length - 1; i >= 0; i--) {
                    const run = this.priorRuns[i]
                    const hasActivity =
                        run.messages.some(m => m.stubSource === src) ||
                        run.exceptions.some(e => e.stubSource === src) ||
                        run.results.some(r => r.stubSource === src)
                    if (hasActivity) return STATUS[getNodeStatus(src, run.messages, run.exceptions, run.results)]
                }
            }
            return styleOf(src)
        }

        const theme = getThemeColors()
        const svgContent = buildSvgString(
            edges,
            positions,
            stubs,
            stubMap,
            flowMessages,
            flowExceptions,
            flowResults,
            colOf,
            topOffset,
            theme.bg1,
            theme.bg2,
            hasTimings
        )

        const selStub = this.selectedStub ? stubMap[this.selectedStub] : null
        const selMsgs = this.selectedStub ? msgsOf(this.selectedStub) : []
        const selExcs = this.selectedStub ? excsOf(this.selectedStub) : []
        const selRess = this.selectedStub ? ressOf(this.selectedStub) : []

        const primitiveTypes = new Set(['string', 'int', 'float', 'bool', 'array', 'mixed', 'null', 'void', 'never', 'object'])
        const typeColor = type => {
            const base = type.startsWith('?') ? type.slice(1) : type
            if (base === 'string') return 'text-sky-400'
            if (base === 'int' || base === 'float') return 'text-amber-400'
            if (base === 'bool') return 'text-violet-400'
            if (base === 'array') return 'text-orange-400'
            if (!primitiveTypes.has(base)) return 'text-emerald-400'
            return 'text-base-content/40'
        }
        const renderMsgProps = (msgClass, depth, visited) => {
            const props = this.messageSchemas?.[msgClass]
            if (!props || Object.keys(props).length === 0) return ''
            return html`
                <div class="flex flex-col gap-0.5 ${depth > 0 ? 'mt-0.5 ml-3 pl-2 border-l border-base-content/10' : 'mt-1'}">
                    ${Object.entries(props).map(([name, type]) => {
                        const nullable = type.startsWith('?')
                        const base = nullable ? type.slice(1) : type
                        const subClass = base.split('|').find(p => !primitiveTypes.has(p) && this.messageSchemas?.[p])
                        const hasNested = !!subClass && !visited.has(subClass)
                        return html`
                            <span class="text-xs font-mono leading-snug"
                                ><span class="text-base-content/40">${name}</span><span class="text-base-content/20">:</span>${nullable
                                    ? html`<span class="text-base-content/25">?</span>`
                                    : ''}<span class="${typeColor(type)}">${base.split('\\').pop()}</span></span
                            >
                            ${hasNested ? renderMsgProps(subClass, depth + 1, new Set([...visited, subClass])) : ''}
                        `
                    })}
                </div>
            `
        }
        const msgProps = msgClass => renderMsgProps(msgClass, 0, new Set([msgClass]))

        return html`
            <div style="position:relative;">
                <!-- ── Graph canvas ── -->
                <div class="rounded-box border border-base-300 overflow-auto bg-base-200">
                    <div style="position:relative; width:${svgW}px; height:${svgH}px; min-width:100%;">
                        ${stubs.map(stub => {
                            const pos = positions[stub.source]
                            const st = styleOf(stub.source)
                            const msgs = msgsOf(stub.source)
                            const excs = excsOf(stub.source)
                            const ress = ressOf(stub.source)
                            const selected = this.selectedStub === stub.source
                            const nh = nodeHeight(stub, hasTimings)
                            const maxPorts = Math.max(stub.messages.length, stub.returnTypes.length, 1)

                            return html`
                                <div
                                    class="fc-node"
                                    @click=${() => (this.selectedStub = selected ? null : stub.source)}
                                    style="
                     position:absolute; left:${pos.x}px; top:${pos.y}px;
                     width:${NODE_W}px; height:${nh}px;
                     background:${st.bg};
                     border:1.5px solid ${selected ? st.color : st.color + '55'};
                     border-left:5px solid ${st.color};
                     border-radius:10px; cursor:pointer; overflow:hidden;
                     box-shadow:${selected ? `0 0 0 2px ${st.color}44, 0 4px 20px ${st.color}22` : '0 2px 8px rgba(0,0,0,0.4)'};
                   "
                                >
                                    <!-- Header -->
                                    <div
                                        style="height:${HEADER_H}px; display:flex; align-items:center; gap:8px;
                            padding:0 10px; ${hasTimings
                                            ? ''
                                            : `background-image:linear-gradient(to right,transparent 10px,${st.color}33 10px,${st.color}33 calc(100% - 10px),transparent calc(100% - 10px));background-size:100% 1px;background-repeat:no-repeat;background-position:bottom;`}"
                                        @mouseenter=${e => {
                                            clearTimeout(this._diffTooltipTimer)
                                            const elRect = e.currentTarget.getBoundingClientRect()
                                            this._diffTooltip = {
                                                x: elRect.left,
                                                y: elRect.bottom + 6,
                                                source: stub.source,
                                                diff: this.stubDiff?.[stub.source] ?? null,
                                            }
                                        }}
                                        @mouseleave=${() => {
                                            this._diffTooltipTimer = setTimeout(() => (this._diffTooltip = null), 150)
                                        }}
                                    >
                                        <span style="font-size:12px; color:${accIndicatorOf(stub.source).color}; flex-shrink:0;"
                                            >${accIndicatorOf(stub.source).label}</span
                                        >
                                        <span
                                            style="font-weight:700; font-size:11px; color:var(--color-base-content); flex:1;
                               overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"
                                            >${short(stub.source)}</span
                                        >
                                        <span
                                            style="font-size:8px; color:oklch(from var(--color-base-content) l c h / 0.4); text-transform:uppercase;
                               letter-spacing:.06em; flex-shrink:0;"
                                            >${stub.messageEnum}</span
                                        >
                                    </div>

                                    <!-- Timing row -->
                                    ${hasTimings
                                        ? html`
                                              <div
                                                  style="height:${TIMING_ROW_H}px; display:flex; align-items:center;
                                      padding:0 10px; gap:5px;"
                                              >
                                                  <div style="flex:1; height:1px; background:${st.color}33;"></div>
                                                  <span
                                                      style="font-size:9px; font-family:monospace; color:${st.color};
                                      font-weight:600; width:44px; text-align:center; flex-shrink:0; opacity:0.8;"
                                                  >
                                                      ${stubTimingsMap[stub.source]
                                                          ? formatDuration(stubTimingsMap[stub.source].duration)
                                                          : '—'}
                                                  </span>
                                                  <div style="flex:1; height:1px; background:${st.color}33;"></div>
                                              </div>
                                          `
                                        : ''}

                                    <!-- Port rows -->
                                    <div style="padding:${PORT_PAD_V}px 0;">
                                        ${Array.from({ length: maxPorts }, (_, i) => {
                                            const inMsg = stub.messages[i]
                                            const outRt = stub.returnTypes[i]
                                            const slotH = portAreaH(stub) / maxPorts
                                            const inData = inMsg ? msgs.find(m => m.messageSource === inMsg) : null
                                            const outData = outRt ? outgoingOf(outRt) : null
                                            const inColor = inData ? (MSG_COLOR[inData.messageType] ?? '#9ca3af') : '#4b5563'

                                            return html`
                                                <div
                                                    style="height:${slotH}px; display:grid; grid-template-columns:1fr 1fr;
                                  align-items:stretch; gap:4px;"
                                                >
                                                    <!-- IN port -->
                                                    <div
                                                        style="display:flex;flex-direction:column;justify-content:center;
                                    padding-left:20px;padding-right:4px;overflow:hidden;min-width:0;"
                                                    >
                                                        ${inMsg
                                                            ? html`
                                                                  <div
                                                                      style="cursor:${inData ? 'pointer' : 'default'};overflow:hidden;"
                                                                      @mouseenter=${inData
                                                                          ? e =>
                                                                                this._showTooltip(
                                                                                    e,
                                                                                    short(inMsg),
                                                                                    inData.messageSource,
                                                                                    inData.message
                                                                                )
                                                                          : null}
                                                                      @mouseleave=${this._hideTooltip}
                                                                  >
                                                                      <span
                                                                          style="font-size:10px;color:${inColor};font-weight:600;
                                         font-family:monospace;white-space:nowrap;
                                         overflow:hidden;text-overflow:ellipsis;display:block;"
                                                                          title="${inMsg}"
                                                                          >${short(inMsg)}</span
                                                                      >
                                                                      <span
                                                                          style="font-size:9px;color:oklch(from var(--color-base-content) l c h / 0.45);font-family:monospace;
                                         white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;"
                                                                      >
                                                                          ${inData ? fmtJson(inData.message) : '—'}
                                                                      </span>
                                                                  </div>
                                                              `
                                                            : ''}
                                                    </div>

                                                    <!-- OUT port content -->
                                                    <div
                                                        style="display:flex;flex-direction:column;justify-content:center;
                                    padding-right:12px;overflow:hidden;height:100%;min-width:0;"
                                                    >
                                                        ${i === 0 && excs.length > 0
                                                            ? html`
                                                                  <div
                                                                      style="cursor:pointer;overflow:hidden;"
                                                                      @mouseenter=${e => {
                                                                          clearTimeout(this._excTooltipTimer)
                                                                          const hostRect = this.getBoundingClientRect()
                                                                          const elRect = e.currentTarget.getBoundingClientRect()
                                                                          const tooltipWidth = 360
                                                                          const xLeft = elRect.left - hostRect.left
                                                                          const alignRight = xLeft + tooltipWidth > hostRect.width
                                                                          this._excTooltip = {
                                                                              x: alignRight
                                                                                  ? hostRect.width - (elRect.right - hostRect.left)
                                                                                  : xLeft,
                                                                              alignRight,
                                                                              y: elRect.bottom - hostRect.top + 6,
                                                                              exc: excs[0],
                                                                          }
                                                                      }}
                                                                      @mouseleave=${() => {
                                                                          this._excTooltipTimer = setTimeout(
                                                                              () => (this._excTooltip = null),
                                                                              150
                                                                          )
                                                                      }}
                                                                  >
                                                                      <span
                                                                          style="font-size:10px;color:#ef4444;font-weight:600;
                                         font-family:monospace;white-space:nowrap;
                                         overflow:hidden;text-overflow:ellipsis;text-align:right;display:block;"
                                                                          >✕ Exception</span
                                                                      >
                                                                      <span
                                                                          style="font-size:9px;color:#ef4444;opacity:0.7;
                                         white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right;display:block;"
                                                                      >
                                                                          ${excs[0].message.length > 28
                                                                              ? excs[0].message.slice(0, 28) + '…'
                                                                              : excs[0].message}
                                                                      </span>
                                                                  </div>
                                                              `
                                                            : i === 0 && ress.length > 0
                                                              ? html`
                                                                    <span
                                                                        style="font-size:10px;color:${ress[0].result
                                                                            ? '#22c55e'
                                                                            : '#f97316'};font-weight:600;
                                         font-family:monospace;white-space:nowrap;
                                         overflow:hidden;text-overflow:ellipsis;text-align:right;"
                                                                        >${ress[0].result ? 'true' : 'false'}</span
                                                                    >
                                                                    <span
                                                                        style="font-size:9px;color:${ress[0].result
                                                                            ? '#22c55e'
                                                                            : '#f97316'};opacity:0.7;
                                         white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right;"
                                                                    >
                                                                        Ergebnis
                                                                    </span>
                                                                `
                                                              : outRt
                                                                ? html`
                                                                      <div
                                                                          style="cursor:${outData ? 'pointer' : 'default'};overflow:hidden;"
                                                                          @mouseenter=${outData
                                                                              ? e =>
                                                                                    this._showTooltip(
                                                                                        e,
                                                                                        short(outRt),
                                                                                        outData.messageSource,
                                                                                        outData.message
                                                                                    )
                                                                              : null}
                                                                          @mouseleave=${this._hideTooltip}
                                                                      >
                                                                          <span
                                                                              style="font-size:10px;color:#6b7280;font-weight:600;
                                         font-family:monospace;white-space:nowrap;
                                         overflow:hidden;text-overflow:ellipsis;display:block;text-align:left;"
                                                                              title="${outRt}"
                                                                              >${short(outRt)}</span
                                                                          >
                                                                          <span
                                                                              style="font-size:9px;color:oklch(from var(--color-base-content) l c h / 0.45);font-family:monospace;
                                         white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;"
                                                                          >
                                                                              ${outData ? fmtJson(outData.message) : '—'}
                                                                          </span>
                                                                      </div>
                                                                  `
                                                                : ''}
                                                    </div>
                                                </div>
                                            `
                                        })}
                                    </div>
                                </div>
                            `
                        })}

                        <!-- SVG overlay -->
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="${svgW}"
                            height="${svgH}"
                            style="position:absolute;top:0;left:0;overflow:visible;pointer-events:none;"
                        >
                            ${unsafeSVG(svgContent)}
                        </svg>
                    </div>
                </div>

                <!-- ── Diff tooltip ── -->
                ${this._diffTooltip
                    ? html`
                          <div
                              style="position:fixed; left:${this._diffTooltip.x}px; top:${this._diffTooltip.y}px; z-index:9999;"
                              class="w-96 rounded-box border border-base-300 bg-base-100 shadow-lg p-4"
                              @mouseenter=${() => clearTimeout(this._diffTooltipTimer)}
                              @mouseleave=${() => {
                                  this._diffTooltipTimer = setTimeout(() => (this._diffTooltip = null), 150)
                              }}
                          >
                              <div class="bg-base-200 -mx-4 -mt-4 px-4 py-3 rounded-t-box flex items-baseline gap-2 mb-3">
                                  <span
                                      class="text-xs font-semibold uppercase tracking-wider shrink-0"
                                      style="color:${DIFF_STATUS[this._diffTooltip.diff?.status]?.color ?? 'var(--color-base-content)'}"
                                  >
                                      ${this._diffTooltip.diff === null
                                          ? short(this._diffTooltip.source)
                                          : this._diffTooltip.diff.status === 'added'
                                            ? 'Neu hinzugefügt'
                                            : this._diffTooltip.diff.status === 'unchanged'
                                              ? 'Aktuell'
                                              : this._diffTooltip.diff.status === 'messageDrift'
                                                ? 'Nachrichtenstruktur geändert'
                                                : 'Schema geändert'}
                                  </span>
                                  <span class="text-xs text-base-content/40 font-normal normal-case tracking-normal font-mono truncate"
                                      >${this._diffTooltip.source}</span
                                  >
                              </div>
                              ${this._diffTooltip.diff.status === 'added'
                                  ? ''
                                  : this._diffTooltip.diff.status === 'unchanged'
                                    ? html`
                                          <div class="space-y-1.5 text-xs text-base-content/70">
                                              <div class="flex gap-2">
                                                  <span class="text-success shrink-0">✓</span>
                                                  <span>Stub entspricht dem gespeicherten Schema</span>
                                              </div>
                                              <div class="flex gap-2">
                                                  <span class="text-success shrink-0">✓</span>
                                                  <span>Input- und Output-Messages unverändert</span>
                                              </div>
                                          </div>
                                      `
                                    : this._diffTooltip.diff.status === 'messageDrift' && this._diffTooltip.diff.changes?.properties?.length
                                      ? html`
                                            ${this._diffTooltip.diff.changes.properties.map(p => {
                                                const mainClass = p.class.split('\\').pop()
                                                const allClasses = [
                                                    ...new Set([
                                                        ...Object.keys(p.livePropertyNames ?? {}),
                                                        ...Object.keys(p.storedPropertyNames ?? {}),
                                                    ]),
                                                ].sort((a, b) => (a === mainClass ? -1 : b === mainClass ? 1 : 0))

                                                const renderPropCell = prop => {
                                                    if (!prop) return html`<span class="text-base-content/30">—</span>`
                                                    const colonIdx = prop.indexOf(':')
                                                    if (colonIdx === -1) return html`${prop}`
                                                    return html`${prop.slice(0, colonIdx)}<span class="text-base-content/30"
                                                            >${prop.slice(colonIdx)}</span
                                                        >`
                                                }

                                                const renderTable = (cls, liveArr, storedArr) => {
                                                    const liveSet = new Set(liveArr)
                                                    const storedSet = new Set(storedArr)
                                                    return html`
                                                        <div class="mb-2">
                                                            <div
                                                                class="text-[10px] uppercase tracking-wider mb-1 ${cls === mainClass
                                                                    ? 'text-base-content/60 font-semibold'
                                                                    : 'text-base-content/30'}"
                                                            >
                                                                ${cls}
                                                            </div>
                                                            <table class="w-full text-[10px] font-mono border-collapse">
                                                                <thead>
                                                                    <tr>
                                                                        <th
                                                                            class="text-left text-base-content/40 font-semibold pb-0.5 pr-3 w-1/2"
                                                                            style="border-bottom:1px solid rgba(75,85,99,0.2)"
                                                                        >
                                                                            Alt
                                                                        </th>
                                                                        <th
                                                                            class="text-left text-base-content/40 font-semibold pb-0.5 w-1/2"
                                                                            style="border-bottom:1px solid rgba(75,85,99,0.2)"
                                                                        >
                                                                            Neu
                                                                        </th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    ${Array.from({
                                                                        length: Math.max(storedArr.length, liveArr.length),
                                                                    }).map((_, i) => {
                                                                        const storedProp = storedArr[i]
                                                                        const liveProp = liveArr[i]
                                                                        const removed =
                                                                            storedProp &&
                                                                            !storedSet.has(liveProp) &&
                                                                            !liveSet.has(storedProp)
                                                                        const added =
                                                                            liveProp && !liveSet.has(storedProp) && !storedSet.has(liveProp)
                                                                        return html`
                                                                            <tr>
                                                                                <td
                                                                                    class="py-0.5 pr-3 break-all align-top"
                                                                                    style="color:${removed ? '#f97316' : 'inherit'}"
                                                                                >
                                                                                    ${renderPropCell(storedProp)}
                                                                                </td>
                                                                                <td
                                                                                    class="py-0.5 break-all align-top"
                                                                                    style="color:${added ? '#22c55e' : 'inherit'}"
                                                                                >
                                                                                    ${renderPropCell(liveProp)}
                                                                                </td>
                                                                            </tr>
                                                                        `
                                                                    })}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    `
                                                }

                                                return html`${allClasses.map(cls =>
                                                    renderTable(cls, p.livePropertyNames?.[cls] ?? [], p.storedPropertyNames?.[cls] ?? [])
                                                )}`
                                            })}
                                        `
                                      : this._diffTooltip.diff.changes
                                        ? html`
                                              ${this._diffTooltip.diff.changes.messages.added.length
                                                  ? html`<div class="mb-1">
                                                        <span class="text-[10px] text-base-content/40 uppercase tracking-wider"
                                                            >Input +</span
                                                        >
                                                        ${this._diffTooltip.diff.changes.messages.added.map(
                                                            m =>
                                                                html`<div class="text-xs font-mono text-success truncate ml-1">
                                                                    + ${m.split('\\').pop()}
                                                                </div>`
                                                        )}
                                                    </div>`
                                                  : ''}
                                              ${this._diffTooltip.diff.changes.messages.removed.length
                                                  ? html`<div class="mb-1">
                                                        <span class="text-[10px] text-base-content/40 uppercase tracking-wider"
                                                            >Input −</span
                                                        >
                                                        ${this._diffTooltip.diff.changes.messages.removed.map(
                                                            m =>
                                                                html`<div class="text-xs font-mono text-error truncate ml-1">
                                                                    − ${m.split('\\').pop()}
                                                                </div>`
                                                        )}
                                                    </div>`
                                                  : ''}
                                              ${this._diffTooltip.diff.changes.returnTypes.added.length
                                                  ? html`<div class="mb-1">
                                                        <span class="text-[10px] text-base-content/40 uppercase tracking-wider"
                                                            >Output +</span
                                                        >
                                                        ${this._diffTooltip.diff.changes.returnTypes.added.map(
                                                            m =>
                                                                html`<div class="text-xs font-mono text-success truncate ml-1">
                                                                    + ${m.split('\\').pop()}
                                                                </div>`
                                                        )}
                                                    </div>`
                                                  : ''}
                                              ${this._diffTooltip.diff.changes.returnTypes.removed.length
                                                  ? html`<div>
                                                        <span class="text-[10px] text-base-content/40 uppercase tracking-wider"
                                                            >Output −</span
                                                        >
                                                        ${this._diffTooltip.diff.changes.returnTypes.removed.map(
                                                            m =>
                                                                html`<div class="text-xs font-mono text-error truncate ml-1">
                                                                    − ${m.split('\\').pop()}
                                                                </div>`
                                                        )}
                                                    </div>`
                                                  : ''}
                                          `
                                        : ''}
                          </div>
                      `
                    : ''}

                <!-- ── Message tooltip ── -->
                ${this._tooltip
                    ? html`
                          <div
                              style="position:absolute; ${this._tooltip.alignRight
                                  ? `right:${this._tooltip.x}px`
                                  : `left:${this._tooltip.x}px`}; top:${this._tooltip.y}px;
                           z-index:50; max-width:360px;"
                              @mouseenter=${() => this._onTooltipEnter()}
                              @mouseleave=${() => this._hideTooltip()}
                          >
                              <fc-info-box
                                  title="${this._tooltip.label}"
                                  subtitle="${this._tooltip.messageSource}"
                                  .content=${html`<pre
                                      class="text-xs font-mono text-base-content/90 whitespace-pre-wrap overflow-auto max-h-48"
                                  >
${JSON.stringify(this._tooltip.data, null, 2)}</pre
                                  >`}
                              ></fc-info-box>
                          </div>
                      `
                    : ''}

                <!-- ── Exception tooltip ── -->
                ${this._excTooltip
                    ? html`
                          <div
                              style="position:absolute; ${this._excTooltip.alignRight
                                  ? `right:${this._excTooltip.x}px`
                                  : `left:${this._excTooltip.x}px`}; top:${this._excTooltip.y}px;
                           z-index:50; max-width:360px;"
                              @mouseenter=${() => clearTimeout(this._excTooltipTimer)}
                              @mouseleave=${() => {
                                  this._excTooltipTimer = setTimeout(() => (this._excTooltip = null), 150)
                              }}
                          >
                              <div class="rounded-box border border-base-300 bg-base-100 shadow-lg">
                                  <div class="bg-base-200 px-4 py-3 rounded-t-box">
                                      <span class="text-xs font-semibold uppercase tracking-wider text-error">Exception</span>
                                  </div>
                                  <div class="px-4 py-3 space-y-2">
                                      <div class="text-xs font-semibold text-base-content/80 break-words">
                                          ${this._excTooltip.exc.message}
                                      </div>
                                      <div class="font-mono text-[10px] text-base-content/40">
                                          ${this._excTooltip.exc.file}:${this._excTooltip.exc.line}
                                      </div>
                                  </div>
                              </div>
                          </div>
                      `
                    : ''}

                <!-- ── Detail panel ── -->
                ${selStub
                    ? html`
                          <div class="mt-3 rounded-box border border-base-300 bg-base-200">
                              <div class="p-4 border-b border-base-300 flex items-center justify-between">
                                  <div>
                                      <span class="font-semibold text-sm">${short(selStub.source)}</span>
                                      <span class="font-mono text-xs text-base-content/40 ml-2 mr-2">${selStub.source}</span>
                                      ${(() => {
                                          const firstMsg = selMsgs[0]
                                          const stubHash = firstMsg?.stubHash
                                          return html`<button
                                              class="btn btn-xs btn-outline btn-info"
                                              title="Stub Source anzeigen"
                                              @click=${() => this._openSourceModal(selStub.source, stubHash)}
                                          >
                                              <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                                  <path
                                                      stroke-linecap="round"
                                                      stroke-linejoin="round"
                                                      d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                                                  />
                                              </svg>
                                              Source
                                          </button>`
                                      })()}
                                  </div>
                                  <div class="flex items-center gap-1">
                                      <button class="btn btn-xs btn-ghost" @click=${() => (this.selectedStub = null)}>✕</button>
                                  </div>
                              </div>

                              <div class="p-4 grid md:grid-cols-2 gap-6">
                                  <div>
                                      <div class="text-xs font-semibold uppercase tracking-wide text-base-content/50 mb-3">
                                          ↓ Eingehende Messages
                                      </div>
                                      ${selStub.messages.length === 0
                                          ? html`<p class="text-xs text-base-content/30 italic">keine</p>`
                                          : selStub.messages.map(msgClass => {
                                                const received = selMsgs.filter(m => m.messageSource === msgClass)
                                                return html`
                                                    <div class="mb-3">
                                                        <div class="flex items-center gap-2 mb-1">
                                                            <span class="font-mono text-xs font-semibold text-base-content/60">
                                                                ${short(msgClass)}
                                                            </span>
                                                            ${!this.readonly && received.length > 0
                                                                ? html`<button
                                                                      class="btn btn-xs btn-outline btn-primary"
                                                                      title="Message-Input editieren"
                                                                      @click=${() => this._openModal(selStub.source, msgClass, received[0])}
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
                                                                              d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"
                                                                          />
                                                                          <path
                                                                              stroke-linecap="round"
                                                                              stroke-linejoin="round"
                                                                              d="M19.5 7.125L18 8.625"
                                                                          />
                                                                      </svg>
                                                                      Editieren
                                                                  </button>`
                                                                : ''}
                                                        </div>
                                                        ${msgProps(msgClass)}
                                                        ${received.length === 0
                                                            ? !this.readonly
                                                                ? html`<div class="text-xs text-base-content/30 italic px-2">
                                                                      nicht empfangen
                                                                  </div>`
                                                                : ''
                                                            : received.map(
                                                                  m => html`
                                                                      <div class="rounded-lg bg-base-300 p-3 mb-1">
                                                                          <div class="flex items-center gap-2 mb-2">
                                                                              <span
                                                                                  class="badge badge-xs leading-none ${m.messageType ===
                                                                                  'finish'
                                                                                      ? 'badge-success'
                                                                                      : m.messageType === 'process'
                                                                                        ? 'badge-info'
                                                                                        : 'badge-warning'}"
                                                                                  >${m.messageType}</span
                                                                              >
                                                                              <span class="text-xs text-base-content/40"
                                                                                  >${fmtDate(m.time)}</span
                                                                              >
                                                                              <button
                                                                                  class="btn btn-ghost btn-xs px-1 ml-auto text-base-content/30 hover:text-base-content/70"
                                                                                  title="Inhalt kopieren"
                                                                                  @click=${() =>
                                                                                      navigator.clipboard.writeText(
                                                                                          JSON.stringify(m.message, null, 2)
                                                                                      )}
                                                                              >
                                                                                  <svg
                                                                                      class="w-3 h-3"
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
                                                                          </div>
                                                                          <pre
                                                                              class="text-xs font-mono text-base-content/80 whitespace-pre-wrap overflow-auto"
                                                                          >
${JSON.stringify(m.message, null, 2)}</pre
                                                                          >
                                                                      </div>
                                                                  `
                                                              )}
                                                    </div>
                                                `
                                            })}
                                  </div>

                                  <div>
                                      ${selExcs.length
                                          ? html`
                                                <div class="text-xs font-semibold uppercase tracking-wide text-error mb-3">
                                                    ✕ Exceptions
                                                </div>
                                                ${selExcs.map(
                                                    ex => html`
                                                        <div
                                                            class="rounded-box bg-error/80 border border-error text-error-content text-xs mb-2 p-3"
                                                        >
                                                            <div class="min-w-0 w-full overflow-hidden">
                                                                <div class="font-semibold mb-1">${ex.message}</div>
                                                                <div class="opacity-60">${ex.file}:${ex.line}</div>
                                                                <details class="mt-2">
                                                                    <summary class="cursor-pointer opacity-50">Stacktrace</summary>
                                                                    <pre
                                                                        class="mt-1 text-xs overflow-auto whitespace-pre-wrap opacity-70 max-h-48 bg-base-200 text-base-content rounded p-1"
                                                                    >
${ex.traceString}</pre
                                                                    >
                                                                </details>
                                                            </div>
                                                        </div>
                                                    `
                                                )}
                                            `
                                          : selRess.length
                                            ? html`
                                                  <div class="text-xs font-semibold uppercase tracking-wide text-base-content/50 mb-3">
                                                      ↑ Ausgehend
                                                  </div>
                                                  ${selRess.map(
                                                      r => html`
                                                          <div class="flex items-center gap-2 mb-3">
                                                              <span class="font-mono text-xs font-semibold text-base-content/60"
                                                                  >Ergebnis</span
                                                              >
                                                          </div>
                                                          <div
                                                              class="rounded-lg p-3 mb-2 text-xs"
                                                              style="background:${r.result
                                                                  ? 'rgba(34,197,94,0.10)'
                                                                  : 'rgba(249,115,22,0.10)'}; border:1px solid ${r.result
                                                                  ? 'rgba(34,197,94,0.3)'
                                                                  : 'rgba(249,115,22,0.3)'};"
                                                          >
                                                              <div class="flex items-center gap-2">
                                                                  <span
                                                                      class="badge badge-xs leading-none"
                                                                      style="background:${r.result
                                                                          ? '#00d390'
                                                                          : '#f97316'}; color:#004c39; border:none;"
                                                                      >${r.result ? 'true' : 'false'}</span
                                                                  >
                                                                  <span class="text-base-content/40">${fmtDate(r.time)}</span>
                                                              </div>
                                                          </div>
                                                      `
                                                  )}
                                              `
                                            : html`
                                                  <div class="text-xs font-semibold uppercase tracking-wide text-base-content/50 mb-3">
                                                      ↑ Ausgehende Messages
                                                  </div>
                                                  ${selStub.returnTypes.length === 0
                                                      ? html`<p class="text-xs text-base-content/30 italic">
                                                            Terminal-Stub (keine Ausgabe)
                                                        </p>`
                                                      : selStub.returnTypes.map(rt => {
                                                            const outData = outgoingOf(rt)
                                                            return html`
                                                                <div class="mb-3">
                                                                    <div class="flex items-center gap-2 mb-1">
                                                                        <span class="font-mono text-xs font-semibold text-base-content/60"
                                                                            >${short(rt)}</span
                                                                        >
                                                                    </div>
                                                                    ${msgProps(rt)}
                                                                    ${outData
                                                                        ? html`<div class="rounded-lg bg-base-300 p-3 mb-1">
                                                                              <div class="flex items-center gap-2 mb-2">
                                                                                  <span
                                                                                      class="badge badge-xs leading-none ${outData.messageType ===
                                                                                      'finish'
                                                                                          ? 'badge-success'
                                                                                          : outData.messageType === 'process'
                                                                                            ? 'badge-info'
                                                                                            : 'badge-warning'}"
                                                                                      >${outData.messageType}</span
                                                                                  >
                                                                                  <span class="text-xs text-base-content/40"
                                                                                      >${fmtDate(outData.time)}</span
                                                                                  >
                                                                                  <button
                                                                                      class="btn btn-ghost btn-xs px-1 ml-auto text-base-content/30 hover:text-base-content/70"
                                                                                      title="Inhalt kopieren"
                                                                                      @click=${() =>
                                                                                          navigator.clipboard.writeText(
                                                                                              JSON.stringify(outData.message, null, 2)
                                                                                          )}
                                                                                  >
                                                                                      <svg
                                                                                          class="w-3 h-3"
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
                                                                              </div>
                                                                              <pre
                                                                                  class="text-xs font-mono text-base-content/80 whitespace-pre-wrap overflow-auto"
                                                                              >
${JSON.stringify(outData.message, null, 2)}</pre
                                                                              >
                                                                          </div>`
                                                                        : !this.readonly
                                                                          ? html`<div class="text-xs text-base-content/30 italic px-2">
                                                                                nicht gesendet
                                                                            </div>`
                                                                          : ''}
                                                                </div>
                                                            `
                                                        })}
                                              `}
                                  </div>
                              </div>
                          </div>
                      `
                    : ''}

                <!-- ── Stub Input Modal ── -->
                <dialog id="fc-stub-input-modal" class="modal">
                    ${this._modalMsg
                        ? html`
                              <div class="modal-box w-[95vw] max-w-[95vw] h-[90vh] max-h-[90vh] p-0 flex flex-col overflow-hidden">
                                  <!-- Header -->
                                  <div
                                      class="bg-gradient-to-br from-primary/10 via-secondary/5 to-transparent px-5 pt-4 pb-3 flex-shrink-0"
                                  >
                                      <div class="flex items-start justify-between">
                                          <div class="flex items-start gap-3">
                                              <div
                                                  class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5"
                                              >
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
                                                          d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
                                                      />
                                                  </svg>
                                              </div>
                                              <div>
                                                  <div class="flex items-center gap-2">
                                                      <h3 class="font-bold text-base leading-tight">Message-Input editieren</h3>
                                                      ${this.flow?.isExecutable === false
                                                          ? html`<span
                                                                class="badge badge-sm border-slate-500/50 bg-slate-600/40 text-slate-300 leading-none"
                                                                >Nicht ausführbar</span
                                                            >`
                                                          : ''}
                                                  </div>
                                                  <div class="flex items-center gap-3 mt-1 flex-wrap">
                                                      <span
                                                          class="font-mono text-xs text-base-content/50"
                                                          title="${this._modalMsg.messageClass}"
                                                      >
                                                          ${this._modalMsg.messageClass}
                                                      </span>
                                                      <span class="text-base-content/30 text-xs">·</span>
                                                      <span class="text-xs text-base-content/40">
                                                          Stub:
                                                          <span class="font-mono">${short(this._modalMsg.stubSource)}</span>
                                                      </span>
                                                  </div>
                                              </div>
                                          </div>
                                          <div class="flex items-center gap-1 mt-0.5 flex-shrink-0">
                                              <button
                                                  class="btn btn-ghost btn-sm"
                                                  title="JSON kopieren"
                                                  @click=${() => navigator.clipboard.writeText(this._modalMsg.payload)}
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
                                              <button class="btn btn-sm btn-ghost btn-square btn-circle" @click=${this._closeModal}>
                                                  ✕
                                              </button>
                                          </div>
                                      </div>
                                  </div>

                                  <!-- Editor (fills remaining space) -->
                                  <div class="flex-1 overflow-hidden relative">
                                      <fc-json-editor
                                          .value=${this._modalMsg.payload}
                                          .search=${true}
                                          @change=${this._onEditorChange}
                                          style="display:block; height:100%; overflow:hidden;"
                                      ></fc-json-editor>
                                  </div>

                                  <!-- Status bar -->
                                  <div
                                      class="flex items-center gap-2 px-4 py-2 border-t border-base-300 flex-shrink-0
                        text-xs font-mono bg-base-200"
                                  >
                                      ${this._modalMsg.valid
                                          ? html`<span class="text-success">● JSON valid</span>`
                                          : html`<span class="text-error">● JSON invalid — Fehler siehe Markierungen</span>`}
                                  </div>

                                  <!-- Footer -->
                                  <div class="flex items-center justify-between px-5 py-3 border-t border-base-300 flex-shrink-0">
                                      <div class="flex-1 mr-4">
                                          ${this._sendError
                                              ? renderApiError(this._sendError, { compact: true })
                                              : html`<span class="text-xs text-base-content/30 font-mono"
                                                    >${this.flow?.flowHash ?? ''}</span
                                                >`}
                                      </div>
                                      <div class="flex gap-2 flex-shrink-0">
                                          <button class="btn btn-ghost btn-sm" @click=${this._closeModal} ?disabled=${this._sending}>
                                              Abbrechen
                                          </button>
                                          <button
                                              class="btn btn-outline btn-sm"
                                              ?disabled=${!this._modalMsg?.valid ||
                                              this._sending ||
                                              !this._observerRunning ||
                                              this.flow?.isExecutable === false}
                                              title=${this.flow?.isExecutable === false
                                                  ? 'Flow ist nicht ausführbar'
                                                  : this._observerRunning
                                                    ? 'In Queue legen'
                                                    : 'Observer ist nicht aktiv'}
                                              @click=${() => this._onSend(true)}
                                          >
                                              ${this._sending ? html`<span class="loading loading-spinner loading-xs"></span>` : ''} In
                                              Queue
                                          </button>
                                          <button
                                              class="btn btn-primary btn-sm"
                                              ?disabled=${!this._modalMsg?.valid || this._sending || this.flow?.isExecutable === false}
                                              title=${this.flow?.isExecutable === false ? 'Flow ist nicht ausführbar' : ''}
                                              @click=${() => this._onSend(false)}
                                          >
                                              ${this._sending ? html`<span class="loading loading-spinner loading-xs"></span>` : ''} Direkt
                                              ausführen
                                          </button>
                                      </div>
                                  </div>
                              </div>

                              <form method="dialog" class="modal-backdrop backdrop-blur-sm">
                                  <button @click=${this._closeModal}>close</button>
                              </form>
                          `
                        : ''}
                </dialog>

                <!-- ── Stub Source Modal ── -->
                <dialog id="fc-stub-source-modal" class="modal">
                    <div class="modal-box w-[95vw] max-w-[95vw] h-[90vh] max-h-[90vh] p-0 flex flex-col overflow-hidden">
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
                                        <h3 class="font-bold text-base leading-tight font-mono truncate">${this._stubSourceName ?? ''}</h3>
                                        ${this._stubSourceCurrent === false
                                            ? html`<span
                                                  class="badge badge-outline border-base-content/40 text-base-content/60 badge-sm mt-1"
                                                  >archiviert</span
                                              >`
                                            : ''}
                                    </div>
                                </div>
                                <div class="flex items-center gap-1">
                                    ${this._stubSource !== null
                                        ? html`<button
                                              class="btn btn-sm btn-ghost btn-square btn-circle text-base-content/30 hover:text-base-content/70"
                                              title="Quellcode kopieren"
                                              @click=${() => navigator.clipboard.writeText(this._stubSource)}
                                          >
                                              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                                              </svg>
                                          </button>`
                                        : ''}
                                    <button class="btn btn-sm btn-ghost btn-square btn-circle" @click=${() => this._closeSourceModal()}>
                                        ✕
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="flex-1 overflow-hidden">
                            ${this._stubSource !== null
                                ? html`<fc-source-viewer class="block h-full" .value=${this._stubSource}></fc-source-viewer>`
                                : this._stubSourceError
                                  ? html`<div class="p-4">${renderApiError(this._stubSourceError)}</div>`
                                  : html`<div class="p-4 text-base-content/40 text-sm">Loading...</div>`}
                        </div>
                    </div>
                    <form method="dialog" class="modal-backdrop backdrop-blur-sm">
                        <button @click=${() => this._closeSourceModal()}>close</button>
                    </form>
                </dialog>

                <!-- ── Stub Selection Modal ── -->
                <dialog id="fc-stub-selection-modal" class="modal">
                    ${this._stubSelection
                        ? html`
                              <div class="modal-box max-w-lg p-0 flex flex-col overflow-hidden">
                                  <!-- Header -->
                                  <div
                                      class="bg-gradient-to-br from-primary/10 via-secondary/5 to-transparent px-5 pt-4 pb-3 flex-shrink-0"
                                  >
                                      <div class="flex items-start justify-between">
                                          <div class="flex items-start gap-3">
                                              <div
                                                  class="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5"
                                              >
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
                                                          d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                                      />
                                                  </svg>
                                              </div>
                                              <div>
                                                  <h3 class="font-bold text-base leading-tight">Stub-Auswahl</h3>
                                                  <p class="text-xs text-base-content/50 mt-1">
                                                      Die Message-Source wird von mehreren Stubs verwendet. Bitte wähle die Stubs aus, die
                                                      ausgeführt werden sollen:
                                                  </p>
                                              </div>
                                          </div>
                                          <div class="flex items-center gap-1 mt-0.5 flex-shrink-0">
                                              <button
                                                  class="btn btn-sm btn-ghost btn-square btn-circle"
                                                  @click=${() => this._closeStubSelection()}
                                              >
                                                  ✕
                                              </button>
                                          </div>
                                      </div>
                                  </div>

                                  <!-- Stub list -->
                                  <div class="flex flex-col gap-2 px-5 py-4">
                                      ${this._stubSelection.stubs.map(
                                          (s, i) => html`
                                              <label class="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-base-200">
                                                  <input
                                                      type="checkbox"
                                                      class="checkbox checkbox-sm checkbox-primary"
                                                      .checked=${s.checked}
                                                      @change=${() => this._toggleStubSelection(i)}
                                                  />
                                                  <span class="font-mono text-sm">${short(s.source)}</span>
                                              </label>
                                          `
                                      )}
                                  </div>

                                  <!-- Footer -->
                                  <div class="flex justify-end gap-2 px-5 py-3 border-t border-base-300 flex-shrink-0">
                                      <button class="btn btn-ghost btn-sm" @click=${() => this._closeStubSelection()}>Abbrechen</button>
                                      <button
                                          class="btn btn-primary btn-sm"
                                          ?disabled=${!this._stubSelection.stubs.some(s => s.checked)}
                                          @click=${() => this._confirmStubSelection()}
                                      >
                                          Bestätigen
                                      </button>
                                  </div>
                              </div>
                              <form method="dialog" class="modal-backdrop backdrop-blur-sm">
                                  <button @click=${() => this._closeStubSelection()}>close</button>
                              </form>
                          `
                        : ''}
                </dialog>
            </div>
        `
    }
}

customElements.define('fc-flow-graph', FcFlowGraph)

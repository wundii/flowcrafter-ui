import { html } from 'lit'
import { BaseElement } from '../base-element.js'
import { api } from '../services/api.js'
import { masking } from '../services/masking.js'
import { renderApiError } from '../utils/error.js'
import { formatDuration } from '../utils/duration.js'
import { unsafeSVG } from 'lit/directives/unsafe-svg.js'
import './fc-info-box.js'
import './fc-json-editor.js'
import './fc-source-viewer.js'
import './fc-tooltip.js'

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
const TIMING_ROW_H = 16 // height of the per-step timing row shown below the header
const PROJ_HEADER_H = 28 // projection node header (handler class title)
const PROJ_ROW_H = 16 // height per registered projection message row
const PROJ_PAD_Y = 8 // vertical padding inside the projection node body

// ─── Node sizing ──────────────────────────────────────────────────────────────
const NODE_PAD_BOTTOM = 6
function nodeHeight(step, withTimingRow = false) {
    return (
        HEADER_H +
        (withTimingRow ? TIMING_ROW_H : 0) +
        PORT_PAD_V * 2 +
        Math.max(step.messages.length, step.returnTypes.length, 1) * PORT_ROW_H +
        NODE_PAD_BOTTOM
    )
}

function portAreaH(step) {
    return Math.max(step.messages.length, step.returnTypes.length, 1) * PORT_ROW_H
}

function inputPortY(step, i, withTimingRow = false) {
    const n = step.messages.length || 1
    const slotH = portAreaH(step) / n
    return HEADER_H + (withTimingRow ? TIMING_ROW_H : 0) + PORT_PAD_V + i * slotH + slotH / 2
}

function outputPortY(step, j, withTimingRow = false) {
    const n = step.returnTypes.length || 1
    const slotH = portAreaH(step) / n
    return HEADER_H + (withTimingRow ? TIMING_ROW_H : 0) + PORT_PAD_V + j * slotH + slotH / 2
}

// ─── Status ───────────────────────────────────────────────────────────────────
function getNodeStatus(src, flowMessages, flowExceptions, flowResults) {
    if (flowExceptions.some(e => e.stepSource === src)) return 'error'
    const stepResults = flowResults.filter(r => r.stepSource === src)
    if (stepResults.length > 0 && stepResults.some(r => r.result === false)) return 'rejected'
    const msgs = flowMessages.filter(m => m.stepSource === src)
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
function buildLayout(steps, withTimingRow = false) {
    const stepMap = Object.fromEntries(steps.map(s => [s.source, s]))
    const adjList = Object.fromEntries(steps.map(s => [s.source, []]))
    const edges = []

    for (const from of steps) {
        from.returnTypes.forEach((rt, outIdx) => {
            for (const to of steps) {
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

    // Longest-path column assignment via BFS from init step
    const col = {}
    const initStep = steps.find(s => s.messageEnum === 'init')
    if (initStep) {
        const queue = [[initStep.source, 0]]
        while (queue.length) {
            const [src, c] = queue.shift()
            col[src] = Math.max(col[src] ?? 0, c)
            for (const next of adjList[src]) queue.push([next, c + 1])
        }
    }
    for (const s of steps) {
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

    const inEdges = {}
    for (const e of edges) {
        ;(inEdges[e.to] = inEdges[e.to] ?? []).push(e)
    }

    const positions = {}
    let svgH = 0
    for (let c = 0; c < numCols; c++) {
        const colSteps = byCol[c] ?? []
        const x = PAD_X + c * (NODE_W + COL_GAP)

        if (c === 0 || colSteps.every(src => !inEdges[src]?.some(e => positions[e.from]))) {
            let y = PAD_Y + topOffset
            for (const src of colSteps) {
                positions[src] = { x, y }
                y += nodeHeight(stepMap[src], withTimingRow) + ROW_GAP
            }
            svgH = Math.max(svgH, y - ROW_GAP + PAD_Y)
        } else {
            const desired = colSteps.map(src => {
                const incoming = (inEdges[src] ?? []).filter(e => positions[e.from])
                if (incoming.length === 0) return { src, y: PAD_Y + topOffset }
                const e = incoming[0]
                const predPos = positions[e.from]
                const outY = predPos.y + outputPortY(stepMap[e.from], e.outIdx, withTimingRow)
                const inY = inputPortY(stepMap[src], e.inIdx, withTimingRow)
                return { src, y: outY - inY }
            })
            desired.sort((a, b) => a.y - b.y)

            let minY = PAD_Y + topOffset
            for (const d of desired) {
                const y = Math.max(d.y, minY)
                positions[d.src] = { x, y }
                minY = y + nodeHeight(stepMap[d.src], withTimingRow) + ROW_GAP
            }
            svgH = Math.max(svgH, minY - ROW_GAP + PAD_Y)
        }
    }
    const svgW = PAD_X * 2 + numCols * NODE_W + (numCols - 1) * COL_GAP

    return { edges, positions, svgW, svgH, stepMap, colOf: col, topOffset }
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
    steps,
    stepMap,
    flowMessages,
    flowExceptions,
    flowResults,
    colOf,
    topOffset,
    bgColor,
    bg2Color,
    withTimingRow = false,
    highlightMessageClass = null
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
        parts.push(`<marker id="arr-${key}" markerWidth="8" markerHeight="6" refX="1" refY="3" orient="auto">
      <polygon points="0 0,8 3,0 6" fill="${esc(val.color)}" fill-opacity="0.85"/>
    </marker>`)
    }
    parts.push(`<marker id="arr-proj" markerWidth="8" markerHeight="6" refX="1" refY="3" orient="auto">
      <polygon points="0 0,8 3,0 6" fill="#a855f7"/>
    </marker>`)
    parts.push('</defs>')

    for (const e of edges) {
        const fp = positions[e.from],
            tp = positions[e.to]
        if (!fp || !tp) continue
        const x1 = fp.x + NODE_W,
            y1 = fp.y + outputPortY(stepMap[e.from], e.outIdx, withTimingRow)
        const x2 = tp.x - 14,
            y2 = tp.y + inputPortY(stepMap[e.to], e.inIdx, withTimingRow)
        const colSpan = (colOf[e.to] ?? 0) - (colOf[e.from] ?? 0)
        const isLong = colSpan > 1
        const d = isLong ? bezierLong(x1, y1, x2, y2) : bezierNormal(x1, y1, x2, y2)
        const st = statusOf(e.from)
        const col = STATUS[st].color
        const run = st === 'success' || st === 'error'
        const hl = highlightMessageClass !== null && e.messageClass === highlightMessageClass
        const strokeCol = hl ? '#a855f7' : col

        parts.push(`<path d="${esc(d)}"
      stroke="${esc(strokeCol)}" stroke-width="${run ? 2 : 1.5}"
      stroke-opacity="${hl ? 0.95 : run ? 0.85 : 0.3}"
      stroke-dasharray="${run ? 'none' : '6 4'}"
      fill="none" marker-end="url(#${hl ? 'arr-proj' : `arr-${st}`})"/>`)

        if (run) {
            parts.push(`<path d="${esc(d)}"
        stroke="${esc(strokeCol)}" stroke-width="2" stroke-opacity="0.3"
        stroke-dasharray="8 12" fill="none" class="fc-edge-flow"/>`)
        }
    }

    for (const step of steps) {
        const pos = positions[step.source]
        const col = colorOf(step.source)
        for (let i = 0; i < step.messages.length; i++) {
            parts.push(`<circle cx="${pos.x}" cy="${pos.y + inputPortY(step, i, withTimingRow)}"
        r="${PORT_R}" fill="${esc(bg2Color)}" stroke="${esc(col)}" stroke-width="2"/>`)
        }
        for (let j = 0; j < step.returnTypes.length; j++) {
            parts.push(`<circle cx="${pos.x + NODE_W}" cy="${pos.y + outputPortY(step, j, withTimingRow)}"
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
    @keyframes fc-proj-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
    .fc-proj-pulse { animation: fc-proj-pulse 2.5s ease-in-out infinite; }
    .fc-proj-node { transition: filter 0.15s; }
    .fc-proj-node:hover { filter: brightness(1.15); }
    @keyframes fc-proj-ring { 0% { box-shadow: 0 0 0 0 rgba(168,85,247,0.3); } 70% { box-shadow: 0 0 0 6px rgba(168,85,247,0); } 100% { box-shadow: 0 0 0 0 rgba(168,85,247,0); } }
    .fc-proj-node:hover .fc-proj-outer { animation: fc-proj-ring 1.5s ease-out; }
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
        _projTooltip: { state: true }, // { x, y, alignRight, rows } | null
        _projHighlight: { state: true }, // messageClass of the hovered projection row | null
        _retryTooltip: { state: true }, // { x, y, retries } | null
        _modalMsg: { state: true }, // { stepSource, messageClass, payload, valid }
        _observerRunning: { state: true },
        _sendError: { state: true },
        _sending: { state: true },
        _stepSelection: { state: true }, // { steps: [{source, checked}], queued: bool } | null
        _stepSource: { state: true },
        _stepSourceCurrent: { state: true },
        _stepSourceError: { state: true },
        _stepSourceName: { state: true },
        _tooltip: { state: true }, // { x, y, label, data } | null
        flow: { type: Object },
        messageSchemas: { type: Object }, // { [fqClassName]: { [propName]: typeString } } — optional, only passed from devtool
        projectionHandler: { type: String }, // FQCN of projection handler class, if registered for this flow type
        projectionMessageMethods: { type: Object }, // { [messageSource]: methodName } bound via #[FlowProjectionMessage]
        priorRuns: { type: Array }, // all runs up to and including the selected run (oldest first)
        readonly: { type: Boolean },
        showStepConfig: { type: Boolean },
        runExceptions: { type: Array }, // overrides flow.flowExceptions for a specific run
        runId: { type: String },
        runMessages: { type: Array }, // overrides flow.flowMessages for a specific run
        runResults: { type: Array }, // overrides flow.flowResults for a specific run
        runRetries: { type: Array }, // FlowRetry[] for the selected run
        selectedStep: { state: true },
        stepDiff: { type: Object }, // { [source]: { status: 'added'|'changed'|'unchanged', changes: {messages:{added,removed},returnTypes:{added,removed}} } }
    }

    constructor() {
        super()
        this._diffTooltip = null
        this._diffTooltipTimer = null
        this._excTooltip = null
        this._excTooltipTimer = null
        this._projTooltip = null
        this._projTooltipTimer = null
        this._projHighlight = null
        this._maskingRules = null
        this._modalMsg = null
        this._observerRunning = false
        this._revealedBlocks = new Set()
        this._sendError = null
        this._sending = false
        this._stepSelection = null
        this._stepSource = null
        this._stepSourceCurrent = true
        this._stepSourceError = null
        this._stepSourceName = null
        this._tooltip = null
        this.flow = null
        this.projectionHandler = null
        this.projectionMessageMethods = null
        this.priorRuns = null
        this.readonly = false
        this.showStepConfig = false
        this.runExceptions = null
        this.runId = null
        this.runMessages = null
        this.runResults = null
        this.runRetries = null
        this._retryTooltip = null
        this._retryTooltipTimer = null
        this.selectedStep = null
        this.stepDiff = null
        injectAnimation()
        this._loadMaskingRules()
    }

    async _loadMaskingRules() {
        this._maskingRules = await masking.loadRules()
        this.requestUpdate()
    }

    _toggleReveal(blockId) {
        if (this._revealedBlocks.has(blockId)) {
            this._revealedBlocks.delete(blockId)
        } else {
            this._revealedBlocks.add(blockId)
        }
        this.requestUpdate()
    }

    _maskMessage(msg, blockId) {
        if (!this._maskingRules || this._revealedBlocks.has(blockId)) return msg
        return masking.maskObject(msg, this._maskingRules)
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

    _showProjTooltip(e, rows) {
        clearTimeout(this._projTooltipTimer)
        const hostRect = this.getBoundingClientRect()
        const elRect = e.currentTarget.getBoundingClientRect()
        const tooltipWidth = 360
        const xLeft = elRect.left - hostRect.left
        const alignRight = xLeft + tooltipWidth > hostRect.width
        this._projTooltip = {
            x: alignRight ? hostRect.width - (elRect.right - hostRect.left) : xLeft,
            alignRight,
            y: elRect.bottom - hostRect.top + 6,
            rows,
        }
    }

    _hideProjTooltip() {
        this._projTooltipTimer = setTimeout(() => {
            this._projTooltip = null
            this._projHighlight = null
        }, 150)
    }

    _onTooltipEnter() {
        clearTimeout(this._tooltipTimer)
    }

    _openModal(stepSource, messageClass, msgData) {
        const originalMessage = msgData?.message ?? {}
        const maskedMessage = this._maskingRules ? masking.maskObject(originalMessage, this._maskingRules) : originalMessage
        const steps = this.flow?.flowSchema?.steps ?? []
        const stepMeta = steps.find(s => s.source === stepSource)
        const targetCount = steps.filter(s => s.messages.includes(messageClass)).length
        this._modalMsg = {
            stepSource,
            messageClass,
            payload: JSON.stringify(maskedMessage, null, 2),
            originalMessage,
            revealed: false,
            valid: true,
            runOnce: stepMeta?.runOnce ?? false,
            multiTarget: targetCount > 1,
        }
        api.getInfo()
            .then(info => {
                this._observerRunning = (info?.workers?.length ?? 0) > 0
            })
            .catch(() => {
                this._observerRunning = false
            })
        this.updateComplete.then(() => {
            this.querySelector('#fc-step-input-modal')?.showModal()
        })
    }

    _toggleModalReveal() {
        if (!this._modalMsg) return
        const revealed = !this._modalMsg.revealed
        const payload = revealed
            ? JSON.stringify(this._modalMsg.originalMessage, null, 2)
            : JSON.stringify(
                  this._maskingRules
                      ? masking.maskObject(this._modalMsg.originalMessage, this._maskingRules)
                      : this._modalMsg.originalMessage,
                  null,
                  2
              )
        this._modalMsg = { ...this._modalMsg, revealed, payload }
    }

    _closeModal() {
        this.querySelector('#fc-step-input-modal')?.close()
        this._modalMsg = null
        this._sendError = null
    }

    async _openSourceModal(stepSource, stepHash) {
        if (this.readonly) {
            this.dispatchEvent(new CustomEvent('source-requested', { detail: { source: stepSource }, bubbles: true, composed: true }))
            return
        }
        this._stepSource = null
        this._stepSourceCurrent = true
        this._stepSourceError = null
        this._stepSourceName = stepSource
        try {
            const data = stepHash ? await api.getStepSourceByHash(stepHash) : await api.getStepSource(stepSource)
            this._stepSource = data.source ?? ''
            this._stepSourceCurrent = data.current !== false
            this.updateComplete.then(() => {
                this.querySelector('#fc-step-source-modal')?.showModal()
            })
        } catch (err) {
            if (err.message.includes('404')) {
                this._stepSourceError = `${stepSource} ist nicht mehr verfügbar.`
            } else {
                this._stepSourceError = err
            }
            this.updateComplete.then(() => {
                this.querySelector('#fc-step-source-modal')?.showModal()
            })
        }
    }

    async _openProjectionSourceModal(className) {
        this._stepSource = null
        this._stepSourceCurrent = true
        this._stepSourceError = null
        this._stepSourceName = className
        try {
            const data = await api.getProjectionHandlerSource(className)
            this._stepSource = data.source ?? ''
            this._stepSourceCurrent = data.current !== false
            this.updateComplete.then(() => {
                this.querySelector('#fc-step-source-modal')?.showModal()
            })
        } catch (err) {
            if (err.message.includes('404')) {
                this._stepSourceError = `${className} ist nicht mehr verfügbar.`
            } else {
                this._stepSourceError = err
            }
            this.updateComplete.then(() => {
                this.querySelector('#fc-step-source-modal')?.showModal()
            })
        }
    }

    _closeSourceModal() {
        this.querySelector('#fc-step-source-modal')?.close()
        this._stepSource = null
        this._stepSourceCurrent = true
        this._stepSourceError = null
        this._stepSourceName = null
    }

    _onEditorChange(e) {
        this._modalMsg = { ...this._modalMsg, payload: e.detail.value, valid: e.detail.valid }
    }

    _getStepsForMessageSource(messageClass) {
        const steps = this.flow?.flowSchema?.steps ?? []
        return steps.filter(s => s.messages.includes(messageClass))
    }

    async _onSend(queued = false) {
        if (!this._modalMsg?.valid || this._sending) return

        const targetSteps = this._getStepsForMessageSource(this._modalMsg.messageClass)
        if (targetSteps.length > 1) {
            const flowMessages = this.runMessages ?? this.flow?.flowMessages ?? []
            this._stepSelection = {
                steps: targetSteps.map(s => {
                    const executed = s.runOnce && flowMessages.some(m => m.stepSource === s.source && m.messageType === 'finish')
                    return { source: s.source, checked: !executed, disabled: executed }
                }),
                queued,
            }
            this.updateComplete.then(() => {
                this.querySelector('#fc-step-selection-modal')?.showModal()
            })
            return
        }

        await this._executeSend(queued)
    }

    async _executeSend(queued = false, includeSteps = []) {
        this._sending = true
        this._sendError = null
        try {
            let message = JSON.parse(this._modalMsg.payload)
            if (!this._modalMsg.revealed && this._maskingRules) {
                message = masking.mergeWithOriginal(message, this._modalMsg.originalMessage, this._maskingRules)
            }
            let runtimeHash = null
            if (queued) {
                await api.queueFlow(this.flow.flowHash, this._modalMsg.messageClass, message, includeSteps)
            } else {
                const result = await api.runFlow(this.flow.flowHash, this._modalMsg.messageClass, message, includeSteps)
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

    _toggleStepSelection(index) {
        const steps = [...this._stepSelection.steps]
        steps[index] = { ...steps[index], checked: !steps[index].checked }
        this._stepSelection = { ...this._stepSelection, steps }
    }

    _closeStepSelection() {
        this.querySelector('#fc-step-selection-modal')?.close()
        this._stepSelection = null
    }

    async _confirmStepSelection() {
        const { queued, steps } = this._stepSelection
        const includeSteps = steps.filter(s => s.checked).map(s => s.source)
        this._closeStepSelection()
        await this._executeSend(queued, includeSteps)
    }

    render() {
        if (!this.flow?.flowSchema?.steps?.length) return html``

        const { steps } = this.flow.flowSchema
        const flowMessages = this.runMessages ?? this.flow.flowMessages ?? []
        const flowExceptions = this.runExceptions ?? this.flow.flowExceptions ?? []
        const flowResults = this.runResults ?? this.flow.flowResults ?? []
        const flowRetries = this.runRetries ?? this.flow.flowRetries ?? []

        const retriesByStep = {}
        for (const r of flowRetries) {
            ;(retriesByStep[r.stepSource] = retriesByStep[r.stepSource] ?? []).push(r)
        }

        // Step timing: read pre-computed timings from the run's flowStepTimings array
        const currentRun = this.runId !== null ? ((this.flow?.flowRuns ?? []).find(r => r.flowRuntimeHash === this.runId) ?? null) : null
        const hasTimings = Array.isArray(currentRun?.flowStepTimings) && currentRun.flowStepTimings.length > 0
        const stepTimingsMap = {}
        if (hasTimings) {
            for (const timing of currentRun.flowStepTimings) {
                stepTimingsMap[timing.stepSource] = timing
            }
        }

        const layout = buildLayout(steps, hasTimings)
        const { edges, positions, stepMap, colOf, topOffset, svgW } = layout
        let { svgH } = layout

        // Projection: the handler binds methods to message sources via
        // #[FlowProjectionMessage]. Render a single node directly under the init
        // step — title = handler class, body = list of registered messages.
        const projMethods = this.projectionMessageMethods ?? {}
        const projSources = Object.keys(projMethods)
        const hasProjection = Boolean(this.projectionHandler) && projSources.length > 0

        let projNode = null
        if (hasProjection) {
            const initStep = steps.find(s => s.messageEnum === 'init') ?? steps[0]
            const initPos = initStep ? positions[initStep.source] : null
            if (initPos) {
                const rows = projSources.map(ms => ({ method: projMethods[ms], messageClass: ms }))
                const height = PROJ_HEADER_H + rows.length * PROJ_ROW_H + PROJ_PAD_Y * 2
                const y = initPos.y + nodeHeight(initStep, hasTimings) + ROW_GAP
                projNode = { x: initPos.x, y, w: NODE_W, h: height, rows }
                svgH = Math.max(svgH, y + height + PAD_Y)
            }
        }

        const statusOf = src => getNodeStatus(src, flowMessages, flowExceptions, flowResults)
        const styleOf = src => {
            if (this.stepDiff?.[src]) return DIFF_STATUS[this.stepDiff[src].status] ?? STATUS[statusOf(src)]
            return STATUS[statusOf(src)]
        }
        const msgsOf = src => flowMessages.filter(m => m.stepSource === src)
        const excsOf = src => flowExceptions.filter(e => e.stepSource === src)
        const ressOf = src => flowResults.filter(r => r.stepSource === src)
        const outgoingOf = rt => flowMessages.find(m => m.messageSource === rt)

        // Accumulated label + color: for steps without activity in the current run,
        // show the label and color from the most recent prior run that had activity for that step.
        const accIndicatorOf = src => {
            if (this.priorRuns?.length) {
                for (let i = this.priorRuns.length - 1; i >= 0; i--) {
                    const run = this.priorRuns[i]
                    const hasActivity =
                        run.messages.some(m => m.stepSource === src) ||
                        run.exceptions.some(e => e.stepSource === src) ||
                        run.results.some(r => r.stepSource === src)
                    if (hasActivity) return STATUS[getNodeStatus(src, run.messages, run.exceptions, run.results)]
                }
            }
            return styleOf(src)
        }

        const theme = getThemeColors()
        const svgContent = buildSvgString(
            edges,
            positions,
            steps,
            stepMap,
            flowMessages,
            flowExceptions,
            flowResults,
            colOf,
            topOffset,
            theme.bg1,
            theme.bg2,
            hasTimings,
            this._projHighlight
        )

        const selStep = this.selectedStep ? stepMap[this.selectedStep] : null
        const selMsgs = this.selectedStep ? msgsOf(this.selectedStep) : []
        const selExcs = this.selectedStep ? excsOf(this.selectedStep) : []
        const selRess = this.selectedStep ? ressOf(this.selectedStep) : []

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
                        ${steps.map(step => {
                            const pos = positions[step.source]
                            const st = styleOf(step.source)
                            const msgs = msgsOf(step.source)
                            const excs = excsOf(step.source)
                            const ress = ressOf(step.source)
                            const stepRetries = retriesByStep[step.source] ?? []
                            const selected = this.selectedStep === step.source
                            const nh = nodeHeight(step, hasTimings)
                            const maxPorts = Math.max(step.messages.length, step.returnTypes.length, 1)

                            return html`
                                <div
                                    class="fc-node"
                                    @click=${() => (this.selectedStep = selected ? null : step.source)}
                                    style="
                     position:absolute; left:${pos.x}px; top:${pos.y}px;
                     width:${NODE_W}px; height:${nh}px;
                     background:${st.bg};
                     border:1.5px solid ${selected ? st.color : st.color + '55'};
                     border-left:5px solid ${st.color};
                     border-radius:10px; cursor:pointer; overflow:${stepRetries.length > 0 || (this.showStepConfig && step.retries > 0)
                                        ? 'visible'
                                        : 'hidden'};
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
                                            if (!this.showStepConfig) return
                                            clearTimeout(this._diffTooltipTimer)
                                            const elRect = e.currentTarget.getBoundingClientRect()
                                            this._diffTooltip = {
                                                x: elRect.left,
                                                y: elRect.bottom + 6,
                                                source: step.source,
                                                diff: this.stepDiff?.[step.source] ?? null,
                                            }
                                        }}
                                        @mouseleave=${() => {
                                            this._diffTooltipTimer = setTimeout(() => (this._diffTooltip = null), 150)
                                        }}
                                    >
                                        <span style="font-size:12px; color:${accIndicatorOf(step.source).color}; flex-shrink:0;"
                                            >${accIndicatorOf(step.source).label}</span
                                        >
                                        <span
                                            style="font-weight:700; font-size:11px; color:var(--color-base-content); flex:1;
                               overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"
                                            >${short(step.source)}</span
                                        >
                                        ${step.runOnce
                                            ? html`<svg
                                                  viewBox="0 0 24 24"
                                                  fill="none"
                                                  stroke="#a5b4fc"
                                                  stroke-width="2.5"
                                                  style="width:11px;height:11px;flex-shrink:0;"
                                              >
                                                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                                  <path d="M7 11V7a5 5 0 0110 0v4" />
                                              </svg>`
                                            : ''}
                                        <span
                                            style="font-size:8px; color:oklch(from var(--color-base-content) l c h / 0.4); text-transform:uppercase;
                               letter-spacing:.06em; flex-shrink:0;"
                                            >${step.messageEnum}</span
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
                                                      ${stepTimingsMap[step.source]
                                                          ? formatDuration(stepTimingsMap[step.source].duration)
                                                          : '—'}
                                                  </span>
                                                  <div style="flex:1; height:1px; background:${st.color}33;"></div>
                                              </div>
                                          `
                                        : ''}

                                    <!-- Port rows -->
                                    <div style="padding:${PORT_PAD_V}px 0;">
                                        ${Array.from({ length: maxPorts }, (_, i) => {
                                            const inMsg = step.messages[i]
                                            const outRt = step.returnTypes[i]
                                            const slotH = portAreaH(step) / maxPorts
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

                                    <!-- Step config badge (devtool only) -->
                                    ${this.showStepConfig && step.retries > 0 && stepRetries.length === 0 && flowMessages.length === 0
                                        ? html`
                                              <div
                                                  style="position:absolute; bottom:-9px; left:50%; transform:translateX(-50%);
                                                      display:flex; align-items:center; gap:3px;
                                                      background:#374151; color:#fff; border:1.5px solid #6b7280;
                                                      border-radius:8px; padding:1px 7px; font-size:9px; font-weight:700;
                                                      font-family:monospace; white-space:nowrap; z-index:2;
                                                      box-shadow:0 1px 4px rgba(0,0,0,0.2);"
                                              >
                                                  <svg
                                                      viewBox="0 0 24 24"
                                                      fill="none"
                                                      stroke="currentColor"
                                                      stroke-width="3"
                                                      style="width:10px;height:10px;"
                                                  >
                                                      <path
                                                          stroke-linecap="round"
                                                          stroke-linejoin="round"
                                                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                                      />
                                                  </svg>
                                                  ${step.retries} × ${step.delay}ms
                                              </div>
                                          `
                                        : ''}

                                    <!-- Retry badge -->
                                    ${stepRetries.length > 0
                                        ? html`
                                              <div
                                                  style="position:absolute; bottom:-9px; left:50%; transform:translateX(-50%);
                                                      display:flex; align-items:center; gap:3px;
                                                      background:#ea580c; color:#fff; border:1.5px solid #9a3412;
                                                      border-radius:8px; padding:1px 7px; font-size:9px; font-weight:700;
                                                      font-family:monospace; white-space:nowrap; z-index:2;
                                                      box-shadow:0 1px 4px rgba(234,88,12,0.4);"
                                                  @mouseenter=${e => {
                                                      e.stopPropagation()
                                                      clearTimeout(this._retryTooltipTimer)
                                                      const hostRect = this.getBoundingClientRect()
                                                      const elRect = e.currentTarget.getBoundingClientRect()
                                                      this._retryTooltip = {
                                                          x: elRect.left - hostRect.left + elRect.width / 2,
                                                          y: elRect.bottom - hostRect.top + 6,
                                                          retries: stepRetries,
                                                          stepSource: step.source,
                                                          hasException: excs.length > 0,
                                                          hasWarning: ress.some(r => r.result === false),
                                                      }
                                                  }}
                                                  @mouseleave=${() => {
                                                      this._retryTooltipTimer = setTimeout(() => (this._retryTooltip = null), 150)
                                                  }}
                                              >
                                                  <svg
                                                      viewBox="0 0 24 24"
                                                      fill="none"
                                                      stroke="currentColor"
                                                      stroke-width="3"
                                                      style="width:10px;height:10px;"
                                                  >
                                                      <path
                                                          stroke-linecap="round"
                                                          stroke-linejoin="round"
                                                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                                      />
                                                  </svg>
                                                  ${stepRetries.length}
                                              </div>
                                          `
                                        : ''}
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

                        ${projNode
                            ? html`
                                  <div
                                      class="fc-proj-node"
                                      style="
                                          position:absolute; left:${projNode.x}px; top:${projNode.y}px;
                                          width:${projNode.w}px; height:${projNode.h}px;
                                          cursor:pointer; overflow:visible; pointer-events:auto; z-index:4;
                                      "
                                      @click=${() => this._openProjectionSourceModal(this.projectionHandler)}
                                      @mouseenter=${e => this._showProjTooltip(e, projNode.rows)}
                                      @mouseleave=${() => this._hideProjTooltip()}
                                  >
                                      <div
                                          class="fc-proj-outer"
                                          style="position:absolute; inset:0; border:1.5px solid rgba(168,85,247,0.25); border-radius:12px;"
                                      ></div>
                                      <div
                                          style="
                                          position:absolute; inset:4px;
                                          background:rgba(168,85,247,0.06);
                                          border:1.5px solid rgba(168,85,247,0.45);
                                          border-left:4px solid rgba(168,85,247,0.5);
                                          border-radius:8px;
                                          box-shadow:inset 0 0 12px rgba(168,85,247,0.06), 0 2px 8px rgba(0,0,0,0.4), 0 0 20px rgba(168,85,247,0.05);
                                          display:flex; flex-direction:column;
                                          padding:8px 12px 8px 14px;
                                          overflow:hidden;
                                      "
                                      >
                                          <div style="display:flex; align-items:center; gap:7px; margin-bottom:5px;">
                                              <svg
                                                  class="fc-proj-pulse"
                                                  style="width:14px; height:14px; flex-shrink:0; color:rgba(168,85,247,0.75);"
                                                  viewBox="0 0 24 24"
                                                  fill="none"
                                                  stroke="currentColor"
                                                  stroke-width="2"
                                              >
                                                  <path
                                                      stroke-linecap="round"
                                                      stroke-linejoin="round"
                                                      d="M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0l4.179 2.25L12 17.25 6.429 14.25m5.571 3v4.5m0 0l-5.571-3m5.571 3l5.571-3"
                                                  />
                                              </svg>
                                              <span
                                                  style="font-weight:700; font-size:11px; color:var(--color-base-content); flex:1;
                                                      overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"
                                                  >${short(this.projectionHandler)}</span
                                              >
                                          </div>
                                          <div style="display:flex; flex-direction:column; gap:2px; padding-left:21px; overflow:hidden;">
                                              ${projNode.rows.map(
                                                  row => html`
                                                      <div
                                                          style="display:flex; align-items:baseline; gap:6px; white-space:nowrap; overflow:hidden;"
                                                      >
                                                          <span
                                                              style="font-size:9px; font-weight:600; font-family:monospace; color:#a855f7; flex-shrink:0;"
                                                              >${row.method}</span
                                                          >
                                                          <span
                                                              style="font-size:9px; font-family:monospace; color:var(--color-base-content); opacity:0.4;
                                                                  overflow:hidden; text-overflow:ellipsis;"
                                                              >${short(row.messageClass)}</span
                                                          >
                                                      </div>
                                                  `
                                              )}
                                          </div>
                                      </div>
                                  </div>
                              `
                            : ''}
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
                              <div class="bg-base-200 -mx-4 -mt-4 px-4 py-3 rounded-t-box flex items-baseline gap-2 mb-0">
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
                                  ${this._diffTooltip.diff !== null &&
                                  this._diffTooltip.diff.status !== 'added' &&
                                  this._diffTooltip.diff.status !== 'messageDrift'
                                      ? html`<span
                                            class="text-xs text-base-content/40 font-normal normal-case tracking-normal font-mono truncate"
                                            >${this._diffTooltip.source}</span
                                        >`
                                      : ''}
                              </div>
                              ${!this._diffTooltip.diff
                                  ? html`<span class="text-xs font-mono"
                                        >${(() => {
                                            const s = this._diffTooltip.source
                                            const i = s.lastIndexOf('\\')
                                            return i === -1
                                                ? html`<span class="text-base-content/80">${s}</span>`
                                                : html`<span class="text-base-content/40 break-all">${s.slice(0, i + 1)}</span><wbr /><span
                                                          class="text-base-content/80"
                                                          >${s.slice(i + 1)}</span
                                                      >`
                                        })()}</span
                                    >`
                                  : this._diffTooltip.diff.status === 'added'
                                    ? html`<span class="text-xs font-mono"
                                          >${(() => {
                                              const s = this._diffTooltip.source
                                              const i = s.lastIndexOf('\\')
                                              return i === -1
                                                  ? html`<span class="text-base-content/80">${s}</span>`
                                                  : html`<span class="text-base-content/40 break-all">${s.slice(0, i + 1)}</span
                                                        ><wbr /><span class="text-base-content/80">${s.slice(i + 1)}</span>`
                                          })()}</span
                                      >`
                                    : this._diffTooltip.diff.status === 'unchanged'
                                      ? html`
                                            <div class="space-y-1.5 text-xs text-base-content/70">
                                                <div class="flex gap-2">
                                                    <span class="text-success shrink-0">✓</span>
                                                    <span>Step entspricht dem gespeicherten Schema</span>
                                                </div>
                                                <div class="flex gap-2">
                                                    <span class="text-success shrink-0">✓</span>
                                                    <span>Input- und Output-Messages unverändert</span>
                                                </div>
                                            </div>
                                        `
                                      : this._diffTooltip.diff.status === 'messageDrift' &&
                                          this._diffTooltip.diff.changes?.properties?.length
                                        ? html`
                                              <span class="text-xs font-mono mt-1.5 mb-2 inline-block"
                                                  >${(() => {
                                                      const s = this._diffTooltip.source
                                                      const i = s.lastIndexOf('\\')
                                                      return i === -1
                                                          ? html`<span class="text-base-content/80">${s}</span>`
                                                          : html`<span class="text-base-content/40 break-all">${s.slice(0, i + 1)}</span
                                                                ><wbr /><span class="text-base-content/80">${s.slice(i + 1)}</span>`
                                                  })()}</span
                                              >
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
                                                                              liveProp &&
                                                                              !liveSet.has(storedProp) &&
                                                                              !storedSet.has(liveProp)
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
${JSON.stringify(this._maskingRules ? masking.maskObject(this._tooltip.data, this._maskingRules) : this._tooltip.data, null, 2)}</pre
                                  >`}
                              ></fc-info-box>
                          </div>
                      `
                    : ''}

                <!-- ── Projection tooltip ── -->
                ${this._projTooltip
                    ? html`
                          <div
                              style="position:absolute; ${this._projTooltip.alignRight
                                  ? `right:${this._projTooltip.x}px`
                                  : `left:${this._projTooltip.x}px`}; top:${this._projTooltip.y}px;
                           z-index:50; max-width:360px;"
                              @mouseenter=${() => clearTimeout(this._projTooltipTimer)}
                              @mouseleave=${() => this._hideProjTooltip()}
                          >
                              <div class="rounded-box border border-base-300 bg-base-100 shadow-lg">
                                  <div class="bg-base-200 px-4 py-3 rounded-t-box flex items-baseline gap-2">
                                      <span class="text-xs font-semibold uppercase tracking-wider shrink-0" style="color:#a855f7;"
                                          >Projection</span
                                      >
                                      <span class="text-xs text-base-content/40 font-normal font-mono truncate"
                                          >${short(this.projectionHandler)}</span
                                      >
                                  </div>
                                  <div class="px-2 py-2">
                                      ${this._projTooltip.rows.map(
                                          row => html`
                                              <div
                                                  class="flex items-baseline gap-3 px-2 py-1 rounded transition-colors cursor-default hover:bg-base-200"
                                                  @mouseenter=${() => (this._projHighlight = row.messageClass)}
                                                  @mouseleave=${() => (this._projHighlight = null)}
                                              >
                                                  <span
                                                      class="text-xs font-mono font-semibold whitespace-nowrap"
                                                      style="color:#a855f7; flex:0 0 auto; min-width:96px;"
                                                      >${row.method}</span
                                                  >
                                                  <span class="text-xs font-mono text-base-content/70 break-all"
                                                      >${short(row.messageClass)}</span
                                                  >
                                              </div>
                                          `
                                      )}
                                  </div>
                              </div>
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

                <!-- ── Retry tooltip ── -->
                ${this._retryTooltip
                    ? html`
                          <div
                              style="position:absolute; left:${this._retryTooltip.x}px; top:${this._retryTooltip.y}px;
                                  transform:translateX(-50%); z-index:50; max-width:320px;"
                              @mouseenter=${() => clearTimeout(this._retryTooltipTimer)}
                              @mouseleave=${() => {
                                  this._retryTooltipTimer = setTimeout(() => (this._retryTooltip = null), 150)
                              }}
                          >
                              <div class="rounded-box border border-base-300 bg-base-100 shadow-lg">
                                  <div class="bg-base-200 px-4 py-2 rounded-t-box flex items-center gap-2">
                                      <svg
                                          viewBox="0 0 24 24"
                                          fill="none"
                                          stroke="#ea580c"
                                          stroke-width="2.5"
                                          style="width:12px;height:12px;"
                                      >
                                          <path
                                              stroke-linecap="round"
                                              stroke-linejoin="round"
                                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                          />
                                      </svg>
                                      <span class="text-xs font-semibold" style="color:#ea580c;">
                                          ${this._retryTooltip.retries.length} Retry${this._retryTooltip.retries.length > 1 ? 's' : ''}
                                      </span>
                                  </div>
                                  <div class="px-4 py-2">
                                      <table class="w-full">
                                          ${this._retryTooltip.retries.map(
                                              r => html`
                                                  <tr>
                                                      <td
                                                          class="text-[10px] font-mono text-base-content/40 pr-3 py-0.5 align-top whitespace-nowrap"
                                                      >
                                                          #${r.attempt}
                                                      </td>
                                                      <td class="text-[10px] text-base-content/70 py-0.5 break-words">${r.message}</td>
                                                      <td
                                                          class="text-[10px] font-mono text-base-content/30 pl-3 py-0.5 align-top whitespace-nowrap"
                                                      >
                                                          ${r.time ? new Date(r.time).toLocaleTimeString('de-DE') : ''}
                                                      </td>
                                                  </tr>
                                              `
                                          )}
                                          ${!this._retryTooltip.hasException
                                              ? html`
                                                    <tr>
                                                        <td
                                                            class="text-[10px] font-mono pr-3 py-0.5 align-top whitespace-nowrap"
                                                            style="color:${this._retryTooltip.hasWarning ? '#f97316' : '#22c55e'};"
                                                        >
                                                            #${this._retryTooltip.retries.length + 1}
                                                        </td>
                                                        <td
                                                            class="text-[10px] font-semibold py-0.5"
                                                            style="color:${this._retryTooltip.hasWarning ? '#f97316' : '#22c55e'};"
                                                        >
                                                            ${this._retryTooltip.hasWarning ? 'Warning' : 'Success'}
                                                        </td>
                                                        <td></td>
                                                    </tr>
                                                `
                                              : ''}
                                      </table>
                                  </div>
                              </div>
                          </div>
                      `
                    : ''}

                <!-- ── Detail panel ── -->
                ${selStep
                    ? html`
                          <div class="mt-3 rounded-box border border-base-300 bg-base-200">
                              <div class="p-4 border-b border-base-300 flex items-center justify-between">
                                  <div>
                                      <span class="font-semibold text-sm">${short(selStep.source)}</span>
                                      <span class="font-mono text-xs text-base-content/40 ml-2 mr-2">${selStep.source}</span>
                                      ${(() => {
                                          const firstMsg = selMsgs[0]
                                          const stepHash = firstMsg?.stepHash
                                          return html`<fc-tooltip
                                              text="Step Source anzeigen"
                                              .content=${html`
                                                  <button
                                                      class="btn btn-xs btn-outline btn-info"
                                                      @click=${() => this._openSourceModal(selStep.source, stepHash)}
                                                  >
                                                      <svg
                                                          class="w-3 h-3"
                                                          fill="none"
                                                          stroke="currentColor"
                                                          stroke-width="2"
                                                          viewBox="0 0 24 24"
                                                      >
                                                          <path
                                                              stroke-linecap="round"
                                                              stroke-linejoin="round"
                                                              d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                                                          />
                                                      </svg>
                                                      Source
                                                  </button>
                                              `}
                                          ></fc-tooltip>`
                                      })()}
                                  </div>
                                  <div class="flex items-center gap-1">
                                      <button class="btn btn-xs btn-ghost" @click=${() => (this.selectedStep = null)}>✕</button>
                                  </div>
                              </div>

                              <div class="p-4 grid md:grid-cols-2 gap-6">
                                  <div>
                                      <div class="text-xs font-semibold uppercase tracking-wide text-base-content/50 mb-3">
                                          ↓ Eingehende Messages
                                      </div>
                                      ${selStep.messages.length === 0
                                          ? html`<p class="text-xs text-base-content/30 italic">keine</p>`
                                          : selStep.messages.map(msgClass => {
                                                const received = selMsgs.filter(m => m.messageSource === msgClass)
                                                return html`
                                                    <div class="mb-3">
                                                        <div class="flex items-center gap-2 mb-1">
                                                            <span class="font-mono text-xs font-semibold text-base-content/60">
                                                                ${short(msgClass)}
                                                            </span>
                                                            ${!this.readonly && received.length > 0
                                                                ? html`<fc-tooltip
                                                                      text="Message-Input editieren"
                                                                      .content=${html`
                                                                          <button
                                                                              class="btn btn-xs btn-outline btn-primary"
                                                                              @click=${() =>
                                                                                  this._openModal(selStep.source, msgClass, received[0])}
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
                                                                          </button>
                                                                      `}
                                                                  ></fc-tooltip>`
                                                                : ''}
                                                        </div>
                                                        ${msgProps(msgClass)}
                                                        ${received.length === 0
                                                            ? !this.readonly
                                                                ? html`<div class="text-xs text-base-content/30 italic px-2">
                                                                      nicht empfangen
                                                                  </div>`
                                                                : ''
                                                            : (() => {
                                                                  const blockId = `${selStep.source}::${msgClass}`
                                                                  const revealed = this._revealedBlocks.has(blockId)
                                                                  return html`
                                                                      ${received.map(
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
                                                                                      <fc-tooltip
                                                                                          class="ml-auto"
                                                                                          text="${revealed
                                                                                              ? 'Sensible Daten maskieren'
                                                                                              : 'Sensible Daten anzeigen'}"
                                                                                          .content=${html`
                                                                                              <button
                                                                                                  class="btn btn-ghost btn-xs px-1 ${revealed
                                                                                                      ? 'text-warning'
                                                                                                      : 'text-base-content/30 hover:text-base-content/70'}"
                                                                                                  @click=${() =>
                                                                                                      this._toggleReveal(blockId)}
                                                                                              >
                                                                                                  <svg
                                                                                                      class="w-4 h-4 ${revealed
                                                                                                          ? ''
                                                                                                          : 'hidden'}"
                                                                                                      fill="none"
                                                                                                      stroke="currentColor"
                                                                                                      stroke-width="1.5"
                                                                                                      viewBox="0 0 24 24"
                                                                                                      xmlns="http://www.w3.org/2000/svg"
                                                                                                  >
                                                                                                      <path
                                                                                                          stroke-linecap="round"
                                                                                                          stroke-linejoin="round"
                                                                                                          d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                                                                                                      />
                                                                                                      <circle cx="12" cy="12" r="3" />
                                                                                                  </svg>
                                                                                                  <svg
                                                                                                      class="w-4 h-4 ${revealed
                                                                                                          ? 'hidden'
                                                                                                          : ''}"
                                                                                                      fill="none"
                                                                                                      stroke="currentColor"
                                                                                                      stroke-width="1.5"
                                                                                                      viewBox="0 0 24 24"
                                                                                                      xmlns="http://www.w3.org/2000/svg"
                                                                                                  >
                                                                                                      <path
                                                                                                          stroke-linecap="round"
                                                                                                          stroke-linejoin="round"
                                                                                                          d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
                                                                                                      />
                                                                                                  </svg>
                                                                                              </button>
                                                                                          `}
                                                                                      ></fc-tooltip>
                                                                                      <fc-tooltip
                                                                                          text="Inhalt kopieren"
                                                                                          .content=${html`
                                                                                              <button
                                                                                                  class="btn btn-ghost btn-xs px-1 text-base-content/30 hover:text-base-content/70"
                                                                                                  @click=${() =>
                                                                                                      navigator.clipboard.writeText(
                                                                                                          JSON.stringify(
                                                                                                              this._maskMessage(
                                                                                                                  m.message,
                                                                                                                  blockId
                                                                                                              ),
                                                                                                              null,
                                                                                                              2
                                                                                                          )
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
                                                                                          `}
                                                                                      ></fc-tooltip>
                                                                                  </div>
                                                                                  <pre
                                                                                      class="text-xs font-mono text-base-content/80 whitespace-pre-wrap overflow-auto"
                                                                                  >
${JSON.stringify(this._maskMessage(m.message, blockId), null, 2)}</pre
                                                                                  >
                                                                              </div>
                                                                          `
                                                                      )}
                                                                  `
                                                              })()}
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
                                                  ${selStep.returnTypes.length === 0
                                                      ? html`<p class="text-xs text-base-content/30 italic">
                                                            Terminal-Step (keine Ausgabe)
                                                        </p>`
                                                      : selStep.returnTypes.map(rt => {
                                                            const outData = outgoingOf(rt)
                                                            const outBlockId = `${selStep.source}::out::${rt}`
                                                            const outRevealed = this._revealedBlocks.has(outBlockId)
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
                                                                                  <fc-tooltip
                                                                                      class="ml-auto"
                                                                                      text="${outRevealed
                                                                                          ? 'Sensible Daten maskieren'
                                                                                          : 'Sensible Daten anzeigen'}"
                                                                                      .content=${html`
                                                                                          <button
                                                                                              class="btn btn-ghost btn-xs px-1 ${outRevealed
                                                                                                  ? 'text-warning'
                                                                                                  : 'text-base-content/30 hover:text-base-content/70'}"
                                                                                              @click=${() => this._toggleReveal(outBlockId)}
                                                                                          >
                                                                                              <svg
                                                                                                  class="w-4 h-4 ${outRevealed
                                                                                                      ? ''
                                                                                                      : 'hidden'}"
                                                                                                  fill="none"
                                                                                                  stroke="currentColor"
                                                                                                  stroke-width="1.5"
                                                                                                  viewBox="0 0 24 24"
                                                                                                  xmlns="http://www.w3.org/2000/svg"
                                                                                              >
                                                                                                  <path
                                                                                                      stroke-linecap="round"
                                                                                                      stroke-linejoin="round"
                                                                                                      d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                                                                                                  />
                                                                                                  <circle cx="12" cy="12" r="3" />
                                                                                              </svg>
                                                                                              <svg
                                                                                                  class="w-4 h-4 ${outRevealed
                                                                                                      ? 'hidden'
                                                                                                      : ''}"
                                                                                                  fill="none"
                                                                                                  stroke="currentColor"
                                                                                                  stroke-width="1.5"
                                                                                                  viewBox="0 0 24 24"
                                                                                                  xmlns="http://www.w3.org/2000/svg"
                                                                                              >
                                                                                                  <path
                                                                                                      stroke-linecap="round"
                                                                                                      stroke-linejoin="round"
                                                                                                      d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
                                                                                                  />
                                                                                              </svg>
                                                                                          </button>
                                                                                      `}
                                                                                  ></fc-tooltip>
                                                                                  <fc-tooltip
                                                                                      text="Inhalt kopieren"
                                                                                      .content=${html`
                                                                                          <button
                                                                                              class="btn btn-ghost btn-xs px-1 text-base-content/30 hover:text-base-content/70"
                                                                                              @click=${() =>
                                                                                                  navigator.clipboard.writeText(
                                                                                                      JSON.stringify(
                                                                                                          this._maskMessage(
                                                                                                              outData.message,
                                                                                                              outBlockId
                                                                                                          ),
                                                                                                          null,
                                                                                                          2
                                                                                                      )
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
                                                                                      `}
                                                                                  ></fc-tooltip>
                                                                              </div>
                                                                              <pre
                                                                                  class="text-xs font-mono text-base-content/80 whitespace-pre-wrap overflow-auto"
                                                                              >
${JSON.stringify(this._maskMessage(outData.message, outBlockId), null, 2)}</pre
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

                <!-- ── Step Input Modal ── -->
                <dialog id="fc-step-input-modal" class="modal">
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
                                                      <span class="font-mono text-xs text-base-content/50">
                                                          ${this._modalMsg.messageClass}
                                                      </span>
                                                      <span class="text-base-content/30 text-xs">·</span>
                                                      <span class="text-xs text-base-content/40">
                                                          Step:
                                                          <span class="font-mono">${short(this._modalMsg.stepSource)}</span>
                                                      </span>
                                                  </div>
                                              </div>
                                          </div>
                                          <div class="flex items-center gap-1 mt-0.5 flex-shrink-0">
                                              <button
                                                  class="btn btn-ghost btn-sm ${this._modalMsg.revealed ? 'text-warning' : ''}"
                                                  title="${this._modalMsg.revealed
                                                      ? 'Sensible Daten maskieren'
                                                      : 'Sensible Daten anzeigen'}"
                                                  @click=${() => this._toggleModalReveal()}
                                              >
                                                  <svg
                                                      class="w-4 h-4 ${this._modalMsg.revealed ? '' : 'hidden'}"
                                                      fill="none"
                                                      stroke="currentColor"
                                                      stroke-width="1.5"
                                                      viewBox="0 0 24 24"
                                                      xmlns="http://www.w3.org/2000/svg"
                                                  >
                                                      <path
                                                          stroke-linecap="round"
                                                          stroke-linejoin="round"
                                                          d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                                                      />
                                                      <circle cx="12" cy="12" r="3" />
                                                  </svg>
                                                  <svg
                                                      class="w-4 h-4 ${this._modalMsg.revealed ? 'hidden' : ''}"
                                                      fill="none"
                                                      stroke="currentColor"
                                                      stroke-width="1.5"
                                                      viewBox="0 0 24 24"
                                                      xmlns="http://www.w3.org/2000/svg"
                                                  >
                                                      <path
                                                          stroke-linecap="round"
                                                          stroke-linejoin="round"
                                                          d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
                                                      />
                                                  </svg>
                                              </button>
                                              <button
                                                  class="btn btn-ghost btn-sm"
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
                                              this.flow?.isExecutable === false ||
                                              (this._modalMsg?.runOnce && !this._modalMsg?.multiTarget)}
                                              title=${this._modalMsg?.runOnce && !this._modalMsg?.multiTarget
                                                  ? 'Run-Once Step — kann nicht erneut ausgeführt werden'
                                                  : this.flow?.isExecutable === false
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
                                              ?disabled=${!this._modalMsg?.valid ||
                                              this._sending ||
                                              this.flow?.isExecutable === false ||
                                              (this._modalMsg?.runOnce && !this._modalMsg?.multiTarget)}
                                              title=${this._modalMsg?.runOnce && !this._modalMsg?.multiTarget
                                                  ? 'Run-Once Step — kann nicht erneut ausgeführt werden'
                                                  : this.flow?.isExecutable === false
                                                    ? 'Flow ist nicht ausführbar'
                                                    : ''}
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

                <!-- ── Step Source Modal ── -->
                <dialog id="fc-step-source-modal" class="modal">
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
                                        <h3 class="font-bold text-base leading-tight font-mono truncate">${this._stepSourceName ?? ''}</h3>
                                        ${this._stepSourceCurrent === false
                                            ? html`<span
                                                  class="badge badge-outline border-base-content/40 text-base-content/60 badge-sm mt-1"
                                                  >archiviert</span
                                              >`
                                            : ''}
                                    </div>
                                </div>
                                <div class="flex items-center gap-1">
                                    ${this._stepSource !== null
                                        ? html`<button
                                              class="btn btn-sm btn-ghost btn-square btn-circle text-base-content/30 hover:text-base-content/70"
                                              title="Quellcode kopieren"
                                              @click=${() => navigator.clipboard.writeText(this._stepSource)}
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
                            ${this._stepSource !== null
                                ? html`<fc-source-viewer class="block h-full" .value=${this._stepSource}></fc-source-viewer>`
                                : this._stepSourceError
                                  ? html`<div class="p-4">${renderApiError(this._stepSourceError)}</div>`
                                  : html`<div class="p-4 text-base-content/40 text-sm">Loading...</div>`}
                        </div>
                    </div>
                    <form method="dialog" class="modal-backdrop backdrop-blur-sm">
                        <button @click=${() => this._closeSourceModal()}>close</button>
                    </form>
                </dialog>

                <!-- ── Step Selection Modal ── -->
                <dialog id="fc-step-selection-modal" class="modal">
                    ${this._stepSelection
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
                                                  <h3 class="font-bold text-base leading-tight">Step-Auswahl</h3>
                                                  <p class="text-xs text-base-content/50 mt-1">
                                                      Die Message-Source wird von mehreren Steps verwendet. Bitte wähle die Steps aus, die
                                                      ausgeführt werden sollen:
                                                  </p>
                                              </div>
                                          </div>
                                          <div class="flex items-center gap-1 mt-0.5 flex-shrink-0">
                                              <button
                                                  class="btn btn-sm btn-ghost btn-square btn-circle"
                                                  @click=${() => this._closeStepSelection()}
                                              >
                                                  ✕
                                              </button>
                                          </div>
                                      </div>
                                  </div>

                                  <!-- Step list -->
                                  <div class="flex flex-col gap-2 px-5 py-4">
                                      ${this._stepSelection.steps.map(
                                          (s, i) => html`
                                              <label
                                                  class="flex items-center gap-3 p-2 rounded-lg ${s.disabled
                                                      ? 'opacity-50 cursor-not-allowed'
                                                      : 'cursor-pointer hover:bg-base-200'}"
                                              >
                                                  <input
                                                      type="checkbox"
                                                      class="checkbox checkbox-sm checkbox-primary"
                                                      .checked=${s.checked}
                                                      ?disabled=${s.disabled}
                                                      @change=${() => this._toggleStepSelection(i)}
                                                  />
                                                  <span class="font-mono text-sm">${short(s.source)}</span>
                                                  ${s.disabled
                                                      ? html`<svg
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            stroke="#a5b4fc"
                                                            stroke-width="2.5"
                                                            class="w-3.5 h-3.5 flex-shrink-0"
                                                        >
                                                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                                            <path d="M7 11V7a5 5 0 0110 0v4" />
                                                        </svg>`
                                                      : ''}
                                              </label>
                                          `
                                      )}
                                  </div>

                                  <!-- Footer -->
                                  <div class="flex justify-end gap-2 px-5 py-3 border-t border-base-300 flex-shrink-0">
                                      <button class="btn btn-ghost btn-sm" @click=${() => this._closeStepSelection()}>Abbrechen</button>
                                      <button
                                          class="btn btn-primary btn-sm"
                                          ?disabled=${!this._stepSelection.steps.some(s => s.checked)}
                                          @click=${() => this._confirmStepSelection()}
                                      >
                                          Bestätigen
                                      </button>
                                  </div>
                              </div>
                              <form method="dialog" class="modal-backdrop backdrop-blur-sm">
                                  <button @click=${() => this._closeStepSelection()}>close</button>
                              </form>
                          `
                        : ''}
                </dialog>
            </div>
        `
    }
}

customElements.define('fc-flow-graph', FcFlowGraph)

import { html } from 'lit'
import { unsafeSVG } from 'lit/directives/unsafe-svg.js'
import { BaseElement } from '../base-element.js'
import './fc-json-editor.js'

// ─── Layout constants ─────────────────────────────────────────────────────────
const NODE_W = 270
const HEADER_H = 40
const PORT_ROW_H = 38
const PORT_PAD_V = 10
const PORT_R = 6
const COL_GAP = 130
const ROW_GAP = 24
const PAD_X = 50
const PAD_Y = 44
const LONG_EDGE_AREA = 54 // extra canvas space at top for arced long edges

// ─── Node sizing ──────────────────────────────────────────────────────────────
function nodeHeight(stub) {
    return HEADER_H + PORT_PAD_V * 2 + Math.max(stub.messages.length, stub.returnTypes.length, 1) * PORT_ROW_H
}

function portAreaH(stub) {
    return Math.max(stub.messages.length, stub.returnTypes.length, 1) * PORT_ROW_H
}

function inputPortY(stub, i) {
    const n = stub.messages.length || 1
    const slotH = portAreaH(stub) / n
    return HEADER_H + PORT_PAD_V + i * slotH + slotH / 2
}

function outputPortY(stub, j) {
    const n = stub.returnTypes.length || 1
    const slotH = portAreaH(stub) / n
    return HEADER_H + PORT_PAD_V + j * slotH + slotH / 2
}

// ─── Status ───────────────────────────────────────────────────────────────────
function getNodeStatus(src, flowMessages, flowExceptions) {
    if (flowExceptions.some(e => e.stubSource === src)) return 'error'
    const msgs = flowMessages.filter(m => m.stubSource === src)
    if (msgs.some(m => m.messageType === 'finish')) return 'success'
    if (msgs.some(m => m.messageType === 'process')) return 'running'
    if (msgs.some(m => m.messageType === 'wait')) return 'waiting'
    return 'idle'
}

const STATUS = {
    success: { color: '#22c55e', label: '✓', bg: 'rgba(34,197,94,0.10)' },
    error: { color: '#ef4444', label: '✕', bg: 'rgba(239,68,68,0.10)' },
    running: { color: '#3b82f6', label: '▷', bg: 'rgba(59,130,246,0.10)' },
    waiting: { color: '#eab308', label: '…', bg: 'rgba(234,179,8,0.10)' },
    idle: { color: '#4b5563', label: '○', bg: 'rgba(75,85,99,0.08)' },
}

const MSG_COLOR = { finish: '#22c55e', process: '#3b82f6', wait: '#eab308' }

// ─── Graph layout ─────────────────────────────────────────────────────────────
function buildLayout(stubs) {
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
            y += nodeHeight(stubMap[src]) + ROW_GAP
        }
        svgH = Math.max(svgH, y - ROW_GAP + PAD_Y)
    }
    const svgW = PAD_X * 2 + numCols * NODE_W + (numCols - 1) * COL_GAP

    return { edges, positions, svgW, svgH, stubMap, colOf: col, topOffset }
}

// ─── SVG string builder ───────────────────────────────────────────────────────
function buildSvgString(edges, positions, stubs, stubMap, flowMessages, flowExceptions, colOf, topOffset) {
    const statusOf = src => getNodeStatus(src, flowMessages, flowExceptions)
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
            y1 = fp.y + outputPortY(stubMap[e.from], e.outIdx)
        const x2 = tp.x,
            y2 = tp.y + inputPortY(stubMap[e.to], e.inIdx)
        const colSpan = (colOf[e.to] ?? 0) - (colOf[e.from] ?? 0)
        const isLong = colSpan > 1
        const d = isLong ? bezierLong(x1, y1, x2, y2) : bezierNormal(x1, y1, x2, y2)
        const mx = (x1 + x2) / 2
        const my = isLong ? topOffset / 2 : (y1 + y2) / 2
        const st = statusOf(e.from)
        const col = STATUS[st].color
        const run = st === 'success' || st === 'error'
        const lbl = e.messageClass.split('\\').pop()

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

        parts.push(`<rect x="${mx - 44}" y="${my - 10}" width="88" height="16" rx="4"
      fill="#0f1117" fill-opacity="0.8"/>`)
        parts.push(`<text x="${mx}" y="${my + 4}"
      text-anchor="middle" font-size="10" font-family="monospace"
      fill="${esc(col)}" fill-opacity="${run ? 0.9 : 0.5}">${esc(lbl)}</text>`)
    }

    for (const stub of stubs) {
        const pos = positions[stub.source]
        const col = colorOf(stub.source)
        for (let i = 0; i < stub.messages.length; i++) {
            parts.push(`<circle cx="${pos.x}" cy="${pos.y + inputPortY(stub, i)}"
        r="${PORT_R}" fill="#1e2330" stroke="${esc(col)}" stroke-width="2"/>`)
        }
        for (let j = 0; j < stub.returnTypes.length; j++) {
            parts.push(`<circle cx="${pos.x + NODE_W}" cy="${pos.y + outputPortY(stub, j)}"
        r="${PORT_R}" fill="#1e2330" stroke="${esc(col)}" stroke-width="2"/>`)
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
        flow: { type: Object },
        runMessages: { type: Array }, // overrides flow.flowMessages for a specific run
        runExceptions: { type: Array }, // overrides flow.flowExceptions for a specific run
        selectedStub: { state: true },
        _modalMsg: { state: true }, // { stubSource, messageClass, payload }
    }

    constructor() {
        super()
        this.flow = null
        this.runMessages = null
        this.runExceptions = null
        this.selectedStub = null
        this._modalMsg = null
        injectAnimation()
    }

    _openModal(stubSource, messageClass, msgData) {
        this._modalMsg = {
            stubSource,
            messageClass,
            payload: msgData?.message !== null && msgData?.message !== undefined ? JSON.stringify(msgData.message, null, 2) : '{}',
            valid: true,
        }
        this.updateComplete.then(() => {
            this.querySelector('#fc-stub-input-modal')?.showModal()
        })
    }

    _closeModal() {
        this.querySelector('#fc-stub-input-modal')?.close()
        this._modalMsg = null
    }

    _onEditorChange(e) {
        this._modalMsg = { ...this._modalMsg, payload: e.detail.value, valid: e.detail.valid }
    }

    render() {
        if (!this.flow?.flowSchema?.stubs?.length) return html``

        const { stubs } = this.flow.flowSchema
        const flowMessages = this.runMessages ?? this.flow.flowMessages ?? []
        const flowExceptions = this.runExceptions ?? this.flow.flowExceptions ?? []

        const { edges, positions, svgW, svgH, stubMap, colOf, topOffset } = buildLayout(stubs)

        const statusOf = src => getNodeStatus(src, flowMessages, flowExceptions)
        const styleOf = src => STATUS[statusOf(src)]
        const msgsOf = src => flowMessages.filter(m => m.stubSource === src)
        const excsOf = src => flowExceptions.filter(e => e.stubSource === src)
        const outgoingOf = rt => flowMessages.find(m => m.messageSource === rt)

        const svgContent = buildSvgString(edges, positions, stubs, stubMap, flowMessages, flowExceptions, colOf, topOffset)

        const selStub = this.selectedStub ? stubMap[this.selectedStub] : null
        const selMsgs = this.selectedStub ? msgsOf(this.selectedStub) : []
        const selExcs = this.selectedStub ? excsOf(this.selectedStub) : []

        return html`
            <!-- ── Graph canvas ── -->
            <div class="rounded-box border border-base-300 overflow-auto" style="background:#0f1117;">
                <div style="position:relative; width:${svgW}px; height:${svgH}px; min-width:100%;">
                    ${stubs.map(stub => {
                        const pos = positions[stub.source]
                        const st = styleOf(stub.source)
                        const msgs = msgsOf(stub.source)
                        const excs = excsOf(stub.source)
                        const selected = this.selectedStub === stub.source
                        const nh = nodeHeight(stub)
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
                            padding:0 10px; border-bottom:1px solid ${st.color}33;"
                                >
                                    <span style="font-size:15px; color:${st.color}; flex-shrink:0;">${st.label}</span>
                                    <span
                                        style="font-weight:700; font-size:13px; color:#f3f4f6; flex:1;
                               overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"
                                        title="${stub.source}"
                                        >${short(stub.source)}</span
                                    >
                                    <span
                                        style="font-size:9px; color:#6b7280; text-transform:uppercase;
                               letter-spacing:.06em; flex-shrink:0;"
                                        >${stub.messageEnum}</span
                                    >
                                    ${excs.length
                                        ? html` <span style="font-size:10px;color:#ef4444;font-weight:700;flex-shrink:0;">
                                              ${excs.length}✕
                                          </span>`
                                        : ''}
                                </div>

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
                                    padding-left:20px;padding-right:4px;overflow:hidden;"
                                                >
                                                    ${inMsg
                                                        ? html`
                                                              <span
                                                                  style="font-size:11px;color:${inColor};font-weight:600;
                                         font-family:monospace;white-space:nowrap;
                                         overflow:hidden;text-overflow:ellipsis;"
                                                                  title="${inMsg}"
                                                                  >${short(inMsg)}</span
                                                              >
                                                              <span
                                                                  style="font-size:10px;color:#6b7280;font-family:monospace;
                                         white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
                                                                  title="${inData ? JSON.stringify(inData.message) : ''}"
                                                              >
                                                                  ${inData ? fmtJson(inData.message) : '—'}
                                                              </span>
                                                          `
                                                        : ''}
                                                </div>

                                                <!-- OUT port content -->
                                                <div
                                                    style="display:flex;flex-direction:column;justify-content:center;
                                    align-items:flex-end;padding-right:12px;overflow:hidden;height:100%;"
                                                >
                                                    ${i === 0 && excs.length > 0
                                                        ? html`
                                                              <span
                                                                  style="font-size:11px;color:#ef4444;font-weight:600;
                                         font-family:monospace;white-space:nowrap;
                                         overflow:hidden;text-overflow:ellipsis;"
                                                                  title="${excs[0].message}"
                                                                  >✕ Exception</span
                                                              >
                                                              <span
                                                                  style="font-size:10px;color:#ef4444;opacity:0.7;
                                         white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
                                                                  title="${excs[0].message}"
                                                              >
                                                                  ${excs[0].message.length > 28
                                                                      ? excs[0].message.slice(0, 28) + '…'
                                                                      : excs[0].message}
                                                              </span>
                                                          `
                                                        : outRt
                                                          ? html`
                                                                <span
                                                                    style="font-size:11px;color:#6b7280;font-weight:600;
                                         font-family:monospace;white-space:nowrap;
                                         overflow:hidden;text-overflow:ellipsis;"
                                                                    title="${outRt}"
                                                                    >${short(outRt)}</span
                                                                >
                                                                <span
                                                                    style="font-size:10px;color:#6b7280;font-family:monospace;
                                         white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
                                                                    title="${outData ? JSON.stringify(outData.message) : ''}"
                                                                >
                                                                    ${outData ? fmtJson(outData.message) : '—'}
                                                                </span>
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

            <!-- ── Detail panel ── -->
            ${selStub
                ? html`
                      <div class="mt-3 rounded-box border border-base-300 bg-base-200">
                          <div class="p-4 border-b border-base-300 flex items-center justify-between">
                              <div>
                                  <span class="font-semibold text-sm">${short(selStub.source)}</span>
                                  <span class="font-mono text-xs text-base-content/40 ml-2">${selStub.source}</span>
                              </div>
                              <button class="btn btn-xs btn-ghost" @click=${() => (this.selectedStub = null)}>✕</button>
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
                                                        <button
                                                            class="btn btn-xs btn-ghost btn-square opacity-50 hover:opacity-100"
                                                            title="Message-Input editieren"
                                                            @click=${() => this._openModal(selStub.source, msgClass, received[0])}
                                                        >
                                                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                                                <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                                                                <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 7.125L18 8.625" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                    ${received.length === 0
                                                        ? html`<div class="text-xs text-base-content/30 italic px-2">nicht empfangen</div>`
                                                        : received.map(
                                                              m => html`
                                                                  <div class="rounded-lg bg-base-300 p-3 mb-1">
                                                                      <div class="flex items-center gap-2 mb-2">
                                                                          <span
                                                                              class="badge badge-xs ${m.messageType === 'finish'
                                                                                  ? 'badge-success'
                                                                                  : m.messageType === 'process'
                                                                                    ? 'badge-info'
                                                                                    : 'badge-warning'}"
                                                                              >${m.messageType}</span
                                                                          >
                                                                          <span class="text-xs text-base-content/40"
                                                                              >${fmtDate(m.time)}</span
                                                                          >
                                                                      </div>
                                                                      <pre
                                                                          class="text-xs font-mono text-base-content/80 whitespace-pre-wrap overflow-auto"
                                                                      >${JSON.stringify(m.message, null, 2)}</pre>
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
                                            <div class="text-xs font-semibold uppercase tracking-wide text-error/70 mb-3">✕ Exceptions</div>
                                            ${selExcs.map(
                                                ex => html`
                                                    <div class="alert alert-error text-xs mb-2 p-3">
                                                        <div class="w-full">
                                                            <div class="font-semibold mb-1">${ex.message}</div>
                                                            <div class="opacity-60">${ex.file}:${ex.line}</div>
                                                            <details class="mt-2">
                                                                <summary class="cursor-pointer opacity-50">Stacktrace</summary>
                                                                <pre
                                                                    class="mt-1 text-xs overflow-auto whitespace-pre-wrap opacity-70 max-h-48"
                                                                >${ex.traceString}</pre>
                                                            </details>
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
                                                ? html`<p class="text-xs text-base-content/30 italic">Terminal-Stub (keine Ausgabe)</p>`
                                                : selStub.returnTypes.map(rt => {
                                                      const outData = outgoingOf(rt)
                                                      return html`
                                                          <div class="mb-3">
                                                              <div class="flex items-center gap-2 mb-1">
                                                                  <span class="font-mono text-xs font-semibold text-base-content/60">${short(rt)}</span>
                                                              </div>
                                                              ${outData
                                                                  ? html`<div class="rounded-lg bg-base-300 p-3 mb-1">
                                                                        <div class="flex items-center gap-2 mb-2">
                                                                            <span class="badge badge-xs ${outData.messageType === 'finish' ? 'badge-success' : outData.messageType === 'process' ? 'badge-info' : 'badge-warning'}">${outData.messageType}</span>
                                                                            <span class="text-xs text-base-content/40">${fmtDate(outData.time)}</span>
                                                                        </div>
                                                                        <pre class="text-xs font-mono text-base-content/80 whitespace-pre-wrap overflow-auto">${JSON.stringify(outData.message, null, 2)}</pre>
                                                                    </div>`
                                                                  : html`<div class="text-xs text-base-content/30 italic px-2">nicht gesendet</div>`}
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
                              <div class="flex items-start justify-between px-5 pt-4 pb-3 border-b border-base-300 flex-shrink-0">
                                  <div>
                                      <h3 class="font-bold text-base leading-tight">Message-Input editieren</h3>
                                      <div class="flex items-center gap-3 mt-1 flex-wrap">
                                          <span class="font-mono text-xs text-base-content/50" title="${this._modalMsg.messageClass}">
                                              ${this._modalMsg.messageClass}
                                          </span>
                                          <span class="text-base-content/30 text-xs">·</span>
                                          <span class="text-xs text-base-content/40">
                                              Stub:
                                              <span class="font-mono">${short(this._modalMsg.stubSource)}</span>
                                          </span>
                                      </div>
                                  </div>
                                  <button class="btn btn-sm btn-ghost btn-square mt-0.5 flex-shrink-0" @click=${this._closeModal}>✕</button>
                              </div>

                              <!-- Editor (fills remaining space) -->
                              <div class="flex-1 overflow-hidden relative">
                                  <fc-json-editor
                                      .value=${this._modalMsg.payload}
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
                                  <span class="text-xs text-base-content/30"> Senden wird in einem späteren Release implementiert. </span>
                                  <div class="flex gap-2">
                                      <button class="btn btn-ghost btn-sm" @click=${this._closeModal}>Abbrechen</button>
                                      <button class="btn btn-primary btn-sm" disabled title="Noch nicht implementiert">Senden</button>
                                  </div>
                              </div>
                          </div>

                          <form method="dialog" class="modal-backdrop">
                              <button @click=${this._closeModal}>close</button>
                          </form>
                      `
                    : ''}
            </dialog>
        `
    }
}

customElements.define('fc-flow-graph', FcFlowGraph)

import { BaseElement } from '../base-element.js'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { php } from '@codemirror/lang-php'
import { oneDark } from '@codemirror/theme-one-dark'

const fitTheme = EditorView.theme({
    '&': {
        height: '100%',
        fontSize: '13px',
        background: 'transparent',
    },
    '.cm-scroller': {
        overflow: 'auto',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    },
    '.cm-content': { padding: '8px 0' },
    '.cm-line': { padding: '0 8px' },
    '.cm-editor': { background: '#1a1d27' },
    '.cm-gutters': { background: '#1a1d27', borderRight: '1px solid #2a2d3a', color: '#4b5563' },
    '.cm-activeLineGutter': { background: '#23273a' },
    '.cm-activeLine': { background: '#23273a' },
    '.cm-selectionBackground': { background: '#3b4261 !important' },
    '.cm-selectionMatch': { background: '#3b4261' },
    '.cm-cursor': { display: 'none' },
    // ─── Search panel styling ─────────────────────────────────────────────────
    '.cm-panels': {
        background: '#1e2130',
        borderTop: '1px solid #2a2d3a',
        color: '#c9d1d9',
    },
    '.cm-search': {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '6px',
        padding: '8px 12px',
    },
    '.cm-search input, .cm-search .cm-textfield': {
        background: '#0d1117',
        border: '1px solid #30363d',
        borderRadius: '6px',
        color: '#c9d1d9',
        fontSize: '12px',
        padding: '3px 8px',
        outline: 'none',
        height: '26px',
    },
    '.cm-search input:focus, .cm-search .cm-textfield:focus': {
        borderColor: '#58a6ff',
        boxShadow: '0 0 0 2px rgba(88,166,255,0.2)',
    },
    '.cm-button': {
        background: '#21262d',
        border: '1px solid #30363d',
        borderRadius: '6px',
        color: '#c9d1d9',
        fontSize: '12px',
        padding: '3px 10px',
        cursor: 'pointer',
        height: '26px',
        lineHeight: '1',
    },
    '.cm-button:hover': {
        background: '#30363d',
        borderColor: '#8b949e',
    },
    '.cm-search label': {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '12px',
        color: '#8b949e',
        cursor: 'pointer',
        userSelect: 'none',
    },
    '.cm-search input[type=checkbox]': {
        border: '1px solid #30363d',
        borderRadius: '3px',
        background: '#0d1117',
        width: '13px',
        height: '13px',
        padding: '0',
        cursor: 'pointer',
    },
    '.cm-search .cm-search-close-button': {
        background: 'transparent',
        border: 'none',
        color: '#8b949e',
        fontSize: '16px',
        padding: '0 4px',
        cursor: 'pointer',
        marginLeft: 'auto',
    },
    '.cm-search .cm-search-close-button:hover': {
        color: '#c9d1d9',
    },
})

/**
 * <fc-source-viewer value="..."></fc-source-viewer>
 *
 * Readonly CodeMirror viewer for PHP source code.
 */
export class FcSourceViewer extends BaseElement {
    static properties = {
        value: { type: String },
    }

    constructor() {
        super()
        this.value = ''
        this._view = null
    }

    connectedCallback() {
        super.connectedCallback()
        requestAnimationFrame(() => this._initEditor())
    }

    disconnectedCallback() {
        super.disconnectedCallback()
        this._view?.destroy()
        this._view = null
    }

    updated(changed) {
        if (changed.has('value') && this._view) {
            const current = this._view.state.doc.toString()
            if (current !== this.value) {
                this._view.dispatch({
                    changes: { from: 0, to: current.length, insert: this.value ?? '' },
                })
            }
        }
    }

    _initEditor() {
        if (this._view || !this.isConnected) return

        const state = EditorState.create({
            doc: this.value ?? '',
            extensions: [basicSetup, EditorState.readOnly.of(true), php(), oneDark, fitTheme, EditorView.lineWrapping],
        })

        this._view = new EditorView({ state, parent: this })
    }

    render() {
        return ''
    }
}

customElements.define('fc-source-viewer', FcSourceViewer)

import { BaseElement } from '../base-element.js'
import { EditorState, Prec } from '@codemirror/state'
import { EditorView, basicSetup } from 'codemirror'
import { json, jsonParseLinter } from '@codemirror/lang-json'
import { keymap } from '@codemirror/view'
import { linter, lintGutter } from '@codemirror/lint'
import { oneDark } from '@codemirror/theme-one-dark'

const noSearchKeymap = Prec.highest(
    keymap.of([
        { key: 'Mod-f', run: () => true },
        { key: 'Mod-h', run: () => true },
        { key: 'Mod-Alt-f', run: () => true },
    ])
)

// ─── Extra theme overrides (fit container, match DaisyUI dark) ────────────────
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
    // Lint gutter + markers
    '.cm-gutter-lint .cm-gutterElement': { padding: '0 4px' },
    '.cm-lintRange-error': {
        backgroundImage: 'none',
        borderBottom: '2px solid #ef4444',
    },
    // Make editor background match modal
    '.cm-editor': { background: '#1a1d27' },
    '.cm-gutters': { background: '#1a1d27', borderRight: '1px solid #2a2d3a', color: '#4b5563' },
    '.cm-activeLineGutter': { background: '#23273a' },
    '.cm-activeLine': { background: '#23273a' },
    '.cm-selectionBackground': { background: '#3b4261 !important' },
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
    '.cm-selectionMatch': {
        background: '#3b4261',
    },
})

/**
 * <fc-json-editor value="..." @change="..."></fc-json-editor>
 *
 * Properties:
 *   value    {string}  — JSON string to display/edit
 *   valid    {boolean} — (readonly, reflects out) whether current content is valid JSON
 *   readonly {boolean} — disables editing
 *   search   {boolean} — enables search/replace panel (Mod-f)
 *
 * Events:
 *   change  — fired on every keystroke, detail: { value, valid }
 */
export class FcJsonEditor extends BaseElement {
    static properties = {
        readonly: { type: Boolean },
        search: { type: Boolean },
        valid: { type: Boolean, reflect: true },
        value: { type: String },
    }

    constructor() {
        super()
        this._skipUpdate = false
        this._view = null
        this.readonly = false
        this.search = false
        this.valid = true
        this.value = '{}'
    }

    // No shadow DOM (inherited from BaseElement), so we render into a plain div
    connectedCallback() {
        super.connectedCallback()
        // defer until the host element is in the DOM
        requestAnimationFrame(() => this._initEditor())
    }

    disconnectedCallback() {
        super.disconnectedCallback()
        this._view?.destroy()
        this._view = null
    }

    // When parent updates the `value` prop, push it into CodeMirror
    updated(changed) {
        if (changed.has('value') && this._view && !this._skipUpdate) {
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

        const updateListener = EditorView.updateListener.of(update => {
            if (!update.docChanged) return
            const text = update.state.doc.toString()
            let valid = true
            try {
                JSON.parse(text)
            } catch {
                valid = false
            }
            this.valid = valid
            this._skipUpdate = true
            this.dispatchEvent(
                new CustomEvent('change', {
                    detail: { value: text, valid },
                    bubbles: true,
                    composed: true,
                })
            )
            this._skipUpdate = false
        })

        const state = EditorState.create({
            doc: this.value ?? '{}',
            extensions: [
                basicSetup,
                ...(!this.search ? [noSearchKeymap] : []),
                ...(this.readonly ? [EditorState.readOnly.of(true)] : []),
                json(),
                linter(jsonParseLinter(), { delay: 300 }),
                lintGutter(),
                oneDark,
                fitTheme,
                updateListener,
                EditorView.lineWrapping,
            ],
        })

        this._view = new EditorView({ state, parent: this })
    }

    // No Lit template needed — CodeMirror mounts directly into `this`
    render() {
        return ''
    }
}

customElements.define('fc-json-editor', FcJsonEditor)

import { BaseElement } from '../base-element.js'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState }            from '@codemirror/state'
import { json, jsonParseLinter }  from '@codemirror/lang-json'
import { linter, lintGutter }     from '@codemirror/lint'
import { oneDark }                from '@codemirror/theme-one-dark'

// ─── Extra theme overrides (fit container, match DaisyUI dark) ────────────────
const fitTheme = EditorView.theme({
  '&': {
    height:     '100%',
    fontSize:   '13px',
    background: 'transparent',
  },
  '.cm-scroller': {
    overflow:   'auto',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
  '.cm-content': { padding: '8px 0' },
  '.cm-line':    { padding: '0 8px' },
  // Lint gutter + markers
  '.cm-gutter-lint .cm-gutterElement': { padding: '0 4px' },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    borderBottom:    '2px solid #ef4444',
  },
  // Make editor background match modal
  '.cm-editor':             { background: '#1a1d27' },
  '.cm-gutters':            { background: '#1a1d27', borderRight: '1px solid #2a2d3a', color: '#4b5563' },
  '.cm-activeLineGutter':   { background: '#23273a' },
  '.cm-activeLine':         { background: '#23273a' },
  '.cm-selectionBackground':{ background: '#3b4261 !important' },
})

/**
 * <fc-json-editor value="..." @change="..."></fc-json-editor>
 *
 * Properties:
 *   value   {string}  — JSON string to display/edit
 *   valid   {boolean} — (readonly, reflects out) whether current content is valid JSON
 *
 * Events:
 *   change  — fired on every keystroke, detail: { value, valid }
 */
export class FcJsonEditor extends BaseElement {
  static properties = {
    value: { type: String },
    valid: { type: Boolean, reflect: true },
  }

  constructor() {
    super()
    this.value  = '{}'
    this.valid  = true
    this._view  = null
    this._skipUpdate = false
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
      try { JSON.parse(text) } catch { valid = false }
      this.valid = valid
      this._skipUpdate = true
      this.dispatchEvent(new CustomEvent('change', {
        detail: { value: text, valid },
        bubbles: true,
        composed: true,
      }))
      this._skipUpdate = false
    })

    const state = EditorState.create({
      doc: this.value ?? '{}',
      extensions: [
        basicSetup,
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
  render() { return '' }
}

customElements.define('fc-json-editor', FcJsonEditor)

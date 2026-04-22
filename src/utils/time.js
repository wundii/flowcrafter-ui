import { html } from 'lit'
import '../components/fc-time.js'

const DAY_MS = 86400000

export function formatAbsolute(iso) {
    if (!iso) return ''
    return new Date(iso).toLocaleString('de-DE', {
        dateStyle: 'short',
        timeStyle: 'medium',
    })
}

export function isRelative(iso) {
    if (!iso) return false
    const diffMs = Date.now() - new Date(iso).getTime()
    return diffMs >= 0 && diffMs < DAY_MS
}

export function formatRelative(iso) {
    if (!iso) return ''
    if (!isRelative(iso)) return formatAbsolute(iso)
    const diffMins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
    if (diffMins < 1) return 'gerade eben'
    if (diffMins < 60) return `vor ${diffMins} Min.`
    return `vor ${Math.floor(diffMins / 60)} Std.`
}

export function timeEl(iso) {
    if (!iso) return ''
    return html`<fc-time .iso=${iso}></fc-time>`
}

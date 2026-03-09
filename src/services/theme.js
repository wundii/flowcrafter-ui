const KEY = 'fc_theme'

export const theme = {
    get() {
        return localStorage.getItem(KEY) ?? 'dark'
    },

    set(value) {
        localStorage.setItem(KEY, value)
        document.documentElement.setAttribute('data-theme', value)
    },

    toggle() {
        const next = this.get() === 'dark' ? 'light' : 'dark'
        this.set(next)
        return next
    },

    init() {
        document.documentElement.setAttribute('data-theme', this.get())
    },
}

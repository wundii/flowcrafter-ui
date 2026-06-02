const DEFAULT_RULES = [
    // Credentials
    { field: 'password', enabled: true, isDefault: true },
    { field: 'passwort', enabled: true, isDefault: true },
    { field: 'secret', enabled: true, isDefault: true },
    { field: 'token', enabled: true, isDefault: true },
    { field: 'apikey', enabled: true, isDefault: true },
    { field: 'api_key', enabled: true, isDefault: true },
    { field: 'api-key', enabled: true, isDefault: true },
    { field: 'access_token', enabled: true, isDefault: true },
    { field: 'refresh_token', enabled: true, isDefault: true },
    { field: 'auth_token', enabled: true, isDefault: true },
    // PII
    { field: 'email', enabled: true, isDefault: true },
    { field: 'e-mail', enabled: true, isDefault: true },
    { field: 'mail', enabled: true, isDefault: true },
    { field: 'phone', enabled: true, isDefault: true },
    { field: 'telefon', enabled: true, isDefault: true },
    { field: 'telefonnummer', enabled: true, isDefault: true },
    { field: 'mobile', enabled: true, isDefault: true },
    { field: 'handy', enabled: true, isDefault: true },
    { field: 'vorname', enabled: true, isDefault: true },
    { field: 'nachname', enabled: true, isDefault: true },
    { field: 'firstname', enabled: true, isDefault: true },
    { field: 'lastname', enabled: true, isDefault: true },
    { field: 'surname', enabled: true, isDefault: true },
    { field: 'address', enabled: true, isDefault: true },
    { field: 'adresse', enabled: true, isDefault: true },
    { field: 'strasse', enabled: true, isDefault: true },
    { field: 'street', enabled: true, isDefault: true },
]

let _rules = null
const _token = () => localStorage.getItem('fc_token')

async function loadRules() {
    if (_rules) return _rules
    try {
        const res = await fetch('/api/masking-rules', {
            headers: { Authorization: `Bearer ${_token()}` },
        })
        if (res.ok) {
            const data = await res.json()
            if (data.length > 0) {
                _rules = data
                return _rules
            }
        }
    } catch {
        // fallback to defaults
    }
    _rules = [...DEFAULT_RULES]
    return _rules
}

async function saveRules(rules) {
    _rules = rules
    await fetch('/api/masking-rules', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${_token()}`,
        },
        body: JSON.stringify(rules),
    })
}

function invalidateCache() {
    _rules = null
}

function isSensitiveKey(key, rules) {
    const lower = key.toLowerCase()
    return rules.some(r => r.enabled && lower === r.field.toLowerCase())
}

function maskValue(value) {
    if (value === null || value === undefined) return '***'
    if (typeof value === 'object') return '***'
    return '***'
}

function maskObject(obj, rules) {
    if (obj === null || obj === undefined) return obj
    if (Array.isArray(obj)) return obj.map(item => maskObject(item, rules))
    if (typeof obj !== 'object') return obj

    const masked = {}
    for (const [key, value] of Object.entries(obj)) {
        if (isSensitiveKey(key, rules)) {
            masked[key] = maskValue(value)
        } else if (typeof value === 'object' && value !== null) {
            masked[key] = maskObject(value, rules)
        } else {
            masked[key] = value
        }
    }
    return masked
}

function mergeWithOriginal(edited, original, rules) {
    if (edited === null || edited === undefined) return edited
    if (Array.isArray(edited)) {
        return edited.map((item, i) => {
            const orig = Array.isArray(original) ? original[i] : undefined
            return typeof item === 'object' && item !== null ? mergeWithOriginal(item, orig, rules) : item
        })
    }
    if (typeof edited !== 'object') return edited

    const merged = {}
    for (const [key, value] of Object.entries(edited)) {
        if (isSensitiveKey(key, rules) && value === '***') {
            merged[key] = original?.[key] !== undefined ? original[key] : value
        } else if (typeof value === 'object' && value !== null) {
            merged[key] = mergeWithOriginal(value, original?.[key], rules)
        } else {
            merged[key] = value
        }
    }
    return merged
}

export const masking = {
    DEFAULT_RULES,
    loadRules,
    saveRules,
    invalidateCache,
    maskObject,
    mergeWithOriginal,
    isSensitiveKey,
}

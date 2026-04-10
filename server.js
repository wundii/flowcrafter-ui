import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync, mkdirSync, createReadStream } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { scryptSync, randomBytes, timingSafeEqual, createHash, createCipheriv, createDecipheriv } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'

const PORT = Number(process.env.PORT ?? 3000)
const AUTH_FILE = './data/auth.json'
const CONNECTION_FILE = './data/connection.json'
const AI_FILE = './data/ai.json'
const KEY_FILE = './data/.key'
const DIST = join(dirname(fileURLToPath(import.meta.url)), 'dist')

const MIME = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.png': 'image/png',
    '.json': 'application/json',
}

// ─── JSON store ───────────────────────────────────────────────────────────────
function loadDb() {
    if (!existsSync(AUTH_FILE)) return { passwordHash: null, sessions: {} }
    return JSON.parse(readFileSync(AUTH_FILE, 'utf8'))
}

function saveDb(db) {
    mkdirSync(dirname(AUTH_FILE), { recursive: true })
    writeFileSync(AUTH_FILE, JSON.stringify(db, null, 2))
}

// ─── Encryption key ───────────────────────────────────────────────────────────
function loadOrCreateKey() {
    if (existsSync(KEY_FILE)) {
        return Buffer.from(readFileSync(KEY_FILE, 'utf8').trim(), 'hex')
    }
    const key = randomBytes(32)
    mkdirSync(dirname(KEY_FILE), { recursive: true })
    writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 })
    return key
}

function encryptSecret(plaintext) {
    const key = loadOrCreateKey()
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return {
        iv: iv.toString('hex'),
        tag: cipher.getAuthTag().toString('hex'),
        data: encrypted.toString('hex'),
    }
}

function decryptSecret(enc) {
    const key = loadOrCreateKey()
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(enc.iv, 'hex'))
    decipher.setAuthTag(Buffer.from(enc.tag, 'hex'))
    return Buffer.concat([decipher.update(Buffer.from(enc.data, 'hex')), decipher.final()]).toString('utf8')
}

// ─── Connection store ─────────────────────────────────────────────────────────
function loadConnection() {
    if (!existsSync(CONNECTION_FILE)) return { url: null, encryptedSecret: null }
    return JSON.parse(readFileSync(CONNECTION_FILE, 'utf8'))
}

function saveConnection(url, secret) {
    mkdirSync(dirname(CONNECTION_FILE), { recursive: true })
    writeFileSync(CONNECTION_FILE, JSON.stringify({ url, encryptedSecret: secret ? encryptSecret(secret) : null }, null, 2))
}

function clearConnection() {
    if (existsSync(CONNECTION_FILE)) writeFileSync(CONNECTION_FILE, JSON.stringify({ url: null, encryptedSecret: null }, null, 2))
}

// ─── AI config store ─────────────────────────────────────────────────────────
const AI_MODELS = [
    { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
    { id: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
]
const DEFAULT_MODEL = 'claude-sonnet-4-20250514'

function loadAiConfig() {
    if (!existsSync(AI_FILE)) return { provider: null, encryptedApiKey: null, model: null }
    return JSON.parse(readFileSync(AI_FILE, 'utf8'))
}

function saveAiConfig(provider, apiKey, model) {
    mkdirSync(dirname(AI_FILE), { recursive: true })
    const existing = loadAiConfig()
    const validModel = AI_MODELS.some(m => m.id === model) ? model : DEFAULT_MODEL
    const encryptedApiKey = apiKey ? encryptSecret(apiKey) : existing.encryptedApiKey
    writeFileSync(AI_FILE, JSON.stringify({ provider, encryptedApiKey, model: validModel }, null, 2))
}

function clearAiConfig() {
    if (existsSync(AI_FILE)) writeFileSync(AI_FILE, JSON.stringify({ provider: null, encryptedApiKey: null, model: null }, null, 2))
}

// ─── AI analysis ─────────────────────────────────────────────────────────────
const ANALYSIS_SYSTEM_PROMPT = `Du bist ein Experte fuer Workflow- und State-Machine-Analyse fuer FlowCrafter, eine PHP message-driven Workflow-Engine.

Du analysierst Flow-Ausfuehrungsdaten und lieferst konkrete, umsetzbare Erkenntnisse in diesen Kategorien:
- "error": Erkannte oder wahrscheinliche Fehlerquellen
- "warning": Praeventive Warnungen vor moeglichen Problemen
- "performance": Performance-Auffaelligkeiten innerhalb eines flowRuns (Zeitluecken, langsame Stubs, unnoetige Verarbeitung)
- "info": Allgemeine Beobachtungen und Verbesserungsvorschlaege

Ein Flow besteht aus:
- Einem Schema mit Stubs (Prozessoren), die typisierte Messages konsumieren und produzieren
- Messages fliessen zwischen Stubs mit den Zustaenden: WAIT -> PROCESS -> FINISH
- Jede Message hat Zeitstempel, predecessorHash-Ketten und ist an einen flowRuntimeHash (Run) gebunden
- Exceptions werden mit vollstaendigem Stack-Trace erfasst
- FlowResults erfassen boolsche Rueckgabewerte von Stubs. Jeder Stub kann bool|MessageDataInterface|MessageReturnInterface zurueckgeben. Ein FlowResult enthaelt: stubSource, stubHash, result (true/false), flowRuntimeHash. Ein result=false bedeutet, dass der Stub die Verarbeitung abgelehnt hat (Status "rejected"), ist aber KEIN Fehler — der Flow kann trotzdem weiterlaufen
- Pro Flow Instanze koennen mehrere Runs existieren (Wiederausfuehrung mit neuen Messages)
- Jeder Run in einer Flow Instanze wird durch eine Message ausgelöst, diese Message besitzt kein predecessorHash
- WICHTIG: Nur der allererste Run einer Flow-Instanz (zeitlich fruehester) startet mit einer Init-Message (messageEnum:"init") und durchlaeuft den Init-Stub. Alle nachfolgenden Runs können ohne Init-Stub starten — sie setzen den Flow an einer beliebigen Stelle fort (z.B. nach einem Fehler). Das Fehlen des Init-Stubs in einem Folge-Run ist KEIN Fehler und KEINE Auffaelligkeit, sondern gewolltes Verhalten
- Messages in flowMessages sind nicht sortiert
- Mehrere Runs sind normal und gewollt: Ein Run bricht typischerweise ab, wenn ein Stub einen Fehler im eigenen Code hat oder eine externe Abhaengigkeit einen Fehler zurueckliefert. In diesem Fall wird ein neuer Run mit gleicher oder geänderten message gestartet um den Flow fortzusetzen. Das ist erwartetes Verhalten und KEINE Auffaelligkeit.
- includeStubs: Beim Starten eines Runs kann der Benutzer eine Auswahl treffen, welche Stubs ausgefuehrt werden sollen (includeStubs). Wenn eine messageSource von mehreren Stubs konsumiert wird, kann der Benutzer gezielt einzelne Stubs ein- oder ausschliessen. Wenn in einem Run bestimmte Stubs nicht ausgefuehrt wurden obwohl sie laut Schema die Message konsumieren, ist das KEIN Fehler — es kann eine bewusste includeStubs-Auswahl gewesen sein.

Antworte AUSSCHLIESSLICH mit validem JSON in genau dieser Struktur:
{
  "summary": "1-2 Saetze Gesamtbewertung",
  "findings": [
    {
      "category": "error|warning|performance|info",
      "severity": "high|medium|low",
      "title": "Kurzer Titel",
      "description": "Detaillierte Erklaerung mit konkreten Verweisen auf Stubs/Messages",
      "affectedStub": "ClassName oder null"
    }
  ]
}

Du hast Zugriff auf das Tool "get_stub_source", um den PHP-Quellcode einzelner Stubs zu laden. Nutze es, wenn der Quellcode fuer eine fundierte Analyse hilfreich waere (z.B. bei Exceptions, unklarem Verhalten oder Performance-Problemen).

Alle Texte (summary, title, description) muessen auf Deutsch sein.
Wenn es keine Auffaelligkeiten gibt, liefere ein leeres findings-Array.
Verpacke das JSON niemals in Markdown-Code-Bloecke.`

function buildUserPrompt(flowData, runtimeHash) {
    let prompt = `Analyze this flow execution data:\n\n${JSON.stringify(flowData, null, 2)}`
    if (runtimeHash) {
        prompt += `\n\nFocus your analysis especially on the run with flowRuntimeHash: ${runtimeHash}`
    }
    return prompt
}

const ANALYSIS_TOOLS = [
    {
        name: 'get_stub_source',
        description:
            'Laedt den PHP-Quellcode eines Stubs anhand seines stubHash. Nutze dieses Tool, wenn du den Quellcode eines Stubs benoetist um die Analyse zu vertiefen (z.B. bei Fehlern, unklarer Logik oder Performance-Problemen). Der stubHash ist in den Flow-Messages und Exceptions enthalten und ermoeglicht auch den Zugriff auf archivierte Versionen.',
        input_schema: {
            type: 'object',
            properties: {
                stubHash: {
                    type: 'string',
                    description: 'Der stubHash des Stubs (z.B. aus flowMessages[].stubHash oder flowExceptions[].stubHash)',
                },
                className: {
                    type: 'string',
                    description: 'Vollqualifizierter PHP-Klassenname des Stubs (z.B. App\\Stubs\\MyStub) — nur zur Anzeige',
                },
            },
            required: ['stubHash'],
        },
    },
]

function shortClassName(fqn) {
    return fqn?.split('\\').pop() ?? fqn
}

async function analyzeFlow(apiKey, model, flowData, runtimeHash, phpUrl, phpHeaders, onProgress) {
    const client = new Anthropic({ apiKey })
    const messages = [{ role: 'user', content: buildUserPrompt(flowData, runtimeHash) }]

    onProgress({ type: 'status', message: 'Flow-Daten werden analysiert…' })

    let response = await client.messages.create({
        model,
        max_tokens: 4096,
        system: ANALYSIS_SYSTEM_PROMPT,
        tools: ANALYSIS_TOOLS,
        messages,
    })

    // Tool-use loop: let AI request stub source code if needed
    while (response.stop_reason === 'tool_use') {
        const toolBlocks = response.content.filter(b => b.type === 'tool_use')
        messages.push({ role: 'assistant', content: response.content })

        const toolResults = []
        for (const block of toolBlocks) {
            if (block.name === 'get_stub_source') {
                onProgress({
                    type: 'tool_use',
                    message: `Lade Quellcode: ${shortClassName(block.input.className ?? block.input.stubHash)}`,
                })
                try {
                    const p = new URLSearchParams({ stubHash: block.input.stubHash })
                    const srcRes = await fetch(`${phpUrl}/api/schema/stub-source?${p}`, { headers: phpHeaders })
                    const srcData = srcRes.ok ? await srcRes.json() : { error: `HTTP ${srcRes.status}` }
                    toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(srcData) })
                } catch (err) {
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: block.id,
                        content: JSON.stringify({ error: err.message }),
                        is_error: true,
                    })
                }
            }
        }

        onProgress({ type: 'status', message: 'Analyse wird fortgesetzt…' })
        messages.push({ role: 'user', content: toolResults })
        response = await client.messages.create({
            model,
            max_tokens: 4096,
            system: ANALYSIS_SYSTEM_PROMPT,
            tools: ANALYSIS_TOOLS,
            messages,
        })
    }

    const text = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
        .replace(/```json?\n?/g, '')
        .replace(/```\s*$/g, '')
        .trim()

    // Extract JSON object even if surrounded by prose text
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Keine gueltige JSON-Antwort vom AI-Modell erhalten.')

    return JSON.parse(jsonMatch[0])
}

// ─── Crypto ───────────────────────────────────────────────────────────────────
function hashPassword(password) {
    const salt = randomBytes(16).toString('hex')
    const hash = scryptSync(password, salt, 64).toString('hex')
    return `${salt}:${hash}`
}

function verifyPassword(password, stored) {
    const [salt, hash] = stored.split(':')
    const derived = scryptSync(password, salt, 64)
    return timingSafeEqual(derived, Buffer.from(hash, 'hex'))
}

function hashToken(token) {
    return createHash('sha256').update(token).digest('hex')
}

function createToken(db) {
    const token = randomBytes(32).toString('hex')
    const expires = Date.now() + 86_400_000 // 24h
    db.sessions[hashToken(token)] = expires
    // prune expired
    for (const [h, exp] of Object.entries(db.sessions)) {
        if (exp < Date.now()) delete db.sessions[h]
    }
    saveDb(db)
    return token // raw token → client only, never stored
}

function validToken(db, token) {
    if (!token) return false
    const exp = db.sessions[hashToken(token)]
    return exp !== undefined && exp > Date.now()
}

// ─── Request helpers ──────────────────────────────────────────────────────────
function bearerToken(req) {
    const h = req.headers['authorization'] ?? ''
    return h.startsWith('Bearer ') ? h.slice(7) : null
}

function readBody(req) {
    return new Promise(resolve => {
        let raw = ''
        req.on('data', c => (raw += c))
        req.on('end', () => resolve(JSON.parse(raw || '{}')))
    })
}

function json(res, data, status = 200) {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
    })
    res.end(JSON.stringify(data))
}

// ─── Metrics ─────────────────────────────────────────────────────────────────
const metrics = {
    requests: new Map(), // key: "method:path:status" → count
    durations: new Map(), // key: "method:path" → [sum, count]
    startTime: Date.now(),
}

function normalizeMetricsPath(p) {
    if (p.startsWith('/api/auth')) return '/api/auth/*'
    if (p.startsWith('/api/fc/')) return '/api/fc/*'
    if (p === '/api/connection') return '/api/connection'
    if (p === '/api/ai-config') return '/api/ai-config'
    if (p === '/api/fc-ping') return '/api/fc-ping'
    if (p === '/api/analyze') return '/api/analyze'
    if (p === '/metrics') return '/metrics'
    return '/static'
}

function recordMetric(method, path, status, durationMs) {
    const normPath = normalizeMetricsPath(path)
    const reqKey = `${method}:${normPath}:${status}`
    metrics.requests.set(reqKey, (metrics.requests.get(reqKey) ?? 0) + 1)

    const durKey = `${method}:${normPath}`
    const prev = metrics.durations.get(durKey) ?? [0, 0]
    metrics.durations.set(durKey, [prev[0] + durationMs, prev[1] + 1])
}

function renderMetrics() {
    const lines = []
    const uptimeSeconds = Math.floor((Date.now() - metrics.startTime) / 1000)

    lines.push('# HELP flowcrafter_ui_uptime_seconds Time since the Node server started')
    lines.push('# TYPE flowcrafter_ui_uptime_seconds gauge')
    lines.push(`flowcrafter_ui_uptime_seconds ${uptimeSeconds}`)

    lines.push('# HELP flowcrafter_ui_http_requests_total Total HTTP requests by method, path, and status')
    lines.push('# TYPE flowcrafter_ui_http_requests_total counter')
    for (const [key, count] of [...metrics.requests.entries()].sort()) {
        const [method, path, status] = key.split(':')
        lines.push(`flowcrafter_ui_http_requests_total{method="${method}",path="${path}",status="${status}"} ${count}`)
    }

    lines.push('# HELP flowcrafter_ui_http_request_duration_ms_total Total request duration in ms by method and path')
    lines.push('# TYPE flowcrafter_ui_http_request_duration_ms_total counter')
    lines.push('# HELP flowcrafter_ui_http_request_duration_ms_count Number of requests by method and path')
    lines.push('# TYPE flowcrafter_ui_http_request_duration_ms_count counter')
    for (const [key, [sum, count]] of [...metrics.durations.entries()].sort()) {
        const [method, path] = key.split(':')
        lines.push(`flowcrafter_ui_http_request_duration_ms_total{method="${method}",path="${path}"} ${sum.toFixed(1)}`)
        lines.push(`flowcrafter_ui_http_request_duration_ms_count{method="${method}",path="${path}"} ${count}`)
    }

    return lines.join('\n') + '\n'
}

// ─── Server ───────────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost`)
    const path = url.pathname.replace(/\/$/, '')
    const method = req.method
    const reqStart = Date.now()

    res.on('finish', () => {
        recordMetric(method, path, res.statusCode, Date.now() - reqStart)
    })

    // CORS preflight
    if (method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        })
        return res.end()
    }

    // ── Metrics endpoint ─────────────────────────────────────────────────────
    if (method === 'GET' && path === '/metrics') {
        const body = renderMetrics()
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' })
        return res.end(body)
    }

    // ── Auth API ─────────────────────────────────────────────────────────────
    if (path.startsWith('/api/auth')) {
        const db = loadDb()

        if (method === 'GET' && path === '/api/auth/status') {
            return json(res, {
                hasPassword: db.passwordHash !== null,
                authenticated: validToken(db, bearerToken(req)),
            })
        }

        if (method === 'POST' && path === '/api/auth/setup') {
            if (db.passwordHash) return json(res, { error: 'Bereits gesetzt.' }, 409)
            const { password } = await readBody(req)
            if (!password || password.length < 6) return json(res, { error: 'Min. 6 Zeichen.' }, 400)
            db.passwordHash = hashPassword(password)
            return json(res, { token: createToken(db) })
        }

        if (method === 'POST' && path === '/api/auth/login') {
            if (!db.passwordHash) return json(res, { error: 'Kein Passwort gesetzt.' }, 404)
            const { password } = await readBody(req)
            if (!password || !verifyPassword(password, db.passwordHash)) return json(res, { error: 'Falsches Passwort.' }, 401)
            return json(res, { token: createToken(db) })
        }

        if (method === 'POST' && path === '/api/auth/change-password') {
            if (!validToken(db, bearerToken(req))) return json(res, { error: 'Nicht autorisiert.' }, 401)
            const { currentPassword, newPassword } = await readBody(req)
            if (!db.passwordHash || !verifyPassword(currentPassword, db.passwordHash))
                return json(res, { error: 'Aktuelles Passwort falsch.' }, 401)
            if (!newPassword || newPassword.length < 6) return json(res, { error: 'Min. 6 Zeichen.' }, 400)
            db.passwordHash = hashPassword(newPassword)
            db.sessions = {} // invalidate all sessions
            return json(res, { token: createToken(db) })
        }

        if (method === 'POST' && path === '/api/auth/logout') {
            const token = bearerToken(req)
            if (token) {
                delete db.sessions[token]
                saveDb(db)
            }
            return json(res, { ok: true })
        }

        return json(res, { error: 'Not found.' }, 404)
    }

    // ── Connection API ───────────────────────────────────────────────────────
    if (path === '/api/connection') {
        const db = loadDb()
        if (!validToken(db, bearerToken(req))) return json(res, { error: 'Nicht autorisiert.' }, 401)

        if (method === 'GET') {
            const conn = loadConnection()
            const configured = !!conn.url
            return json(res, {
                configured,
                url: conn.url ?? '',
                secret: configured && conn.encryptedSecret ? decryptSecret(conn.encryptedSecret) : '',
            })
        }

        if (method === 'POST') {
            const { url: serviceUrl, secret } = await readBody(req)
            if (!serviceUrl) return json(res, { error: 'url fehlt.' }, 400)
            saveConnection(serviceUrl.replace(/\/$/, ''), secret || null)
            return json(res, { ok: true })
        }

        if (method === 'DELETE') {
            clearConnection()
            return json(res, { ok: true })
        }

        return json(res, { error: 'Not found.' }, 404)
    }

    // ── AI config API ─────────────────────────────────────────────────────────
    if (path === '/api/ai-config') {
        const db = loadDb()
        if (!validToken(db, bearerToken(req))) return json(res, { error: 'Nicht autorisiert.' }, 401)

        if (method === 'GET') {
            const config = loadAiConfig()
            return json(res, {
                configured: !!config.encryptedApiKey,
                provider: config.provider ?? '',
                model: config.model ?? DEFAULT_MODEL,
                models: AI_MODELS,
            })
        }

        if (method === 'POST') {
            const { apiKey, provider, model } = await readBody(req)
            const selectedModel = AI_MODELS.some(m => m.id === model) ? model : DEFAULT_MODEL
            if (apiKey) {
                try {
                    const client = new Anthropic({ apiKey })
                    await client.messages.create({
                        model: selectedModel,
                        max_tokens: 10,
                        messages: [{ role: 'user', content: 'ping' }],
                    })
                } catch (err) {
                    const msg = err.error?.error?.message ?? err.message ?? 'API-Key ungültig.'
                    return json(res, { error: msg }, 400)
                }
            }
            saveAiConfig(provider || 'anthropic', apiKey, selectedModel)
            return json(res, { ok: true })
        }

        if (method === 'DELETE') {
            clearAiConfig()
            return json(res, { ok: true })
        }

        return json(res, { error: 'Not found.' }, 404)
    }

    // ── FlowCrafter proxy ─────────────────────────────────────────────────
    if (path.startsWith('/api/fc/')) {
        const db = loadDb()
        if (!validToken(db, bearerToken(req))) return json(res, { error: 'Nicht autorisiert.' }, 401)

        const conn = loadConnection()
        if (!conn.url) return json(res, { error: 'Keine FlowCrafter-Verbindung konfiguriert.' }, 503)

        const phpSecret = conn.encryptedSecret ? decryptSecret(conn.encryptedSecret) : null
        const targetPath = path.replace('/api/fc', '') + url.search
        const targetUrl = `${conn.url}${targetPath}`

        const proxyHeaders = {
            ...(phpSecret ? { Authorization: `Bearer ${phpSecret}` } : {}),
        }

        try {
            const fetchOpts = { method, headers: proxyHeaders }
            if (method === 'POST') {
                const body = await readBody(req)
                fetchOpts.body = JSON.stringify(body)
                proxyHeaders['Content-Type'] = 'application/json'
            }
            const proxyRes = await fetch(targetUrl, fetchOpts)
            const contentType = proxyRes.headers.get('content-type') ?? 'application/json'
            res.writeHead(proxyRes.status, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' })
            const buffer = Buffer.from(await proxyRes.arrayBuffer())
            return res.end(buffer)
        } catch (err) {
            console.error('Proxy error:', err.message)
            return json(res, { error: 'FlowCrafter nicht erreichbar.' }, 502)
        }
    }

    // ── Ping proxy ───────────────────────────────────────────────────────────
    if (path === '/api/fc-ping' && method === 'POST') {
        const db = loadDb()
        if (!validToken(db, bearerToken(req))) return json(res, { error: 'Nicht autorisiert.' }, 401)

        const { url: pingUrl, secret } = await readBody(req)
        if (!pingUrl) return json(res, { error: 'url fehlt.' }, 400)

        try {
            const headers = secret ? { Authorization: `Bearer ${secret}` } : {}
            const pingRes = await fetch(`${pingUrl.replace(/\/$/, '')}/api/ping`, { headers })
            if (pingRes.status === 401) return json(res, { error: '401' })
            if (!pingRes.ok) return json(res, { error: 'unreachable' })
            const data = await pingRes.json().catch(() => null)
            if (data === 'pong' || data?.pong) return json(res, { ok: true })
            return json(res, { error: 'unexpected' })
        } catch {
            return json(res, { error: 'unreachable' })
        }
    }

    // ── Analyze API ─────────────────────────────────────────────────────────
    if (path === '/api/analyze' && method === 'POST') {
        const db = loadDb()
        if (!validToken(db, bearerToken(req))) return json(res, { error: 'Nicht autorisiert.' }, 401)

        const aiConfig = loadAiConfig()
        if (!aiConfig.encryptedApiKey) return json(res, { error: 'AI nicht konfiguriert.' }, 503)

        const conn = loadConnection()
        if (!conn.url) return json(res, { error: 'Keine FlowCrafter-Verbindung konfiguriert.' }, 503)

        const { flowHash, runtimeHash } = await readBody(req)
        if (!flowHash) return json(res, { error: 'flowHash fehlt.' }, 400)

        res.writeHead(200, {
            'Content-Type': 'application/x-ndjson',
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*',
        })

        const send = data => res.write(JSON.stringify(data) + '\n')

        try {
            send({ type: 'status', message: 'Flow-Daten werden geladen…' })
            const phpSecret = conn.encryptedSecret ? decryptSecret(conn.encryptedSecret) : null
            const phpHeaders = phpSecret ? { Authorization: `Bearer ${phpSecret}` } : {}
            const flowRes = await fetch(`${conn.url}/api/flows/detail?hash=${encodeURIComponent(flowHash)}`, {
                headers: phpHeaders,
            })
            if (!flowRes.ok) {
                send({ type: 'error', error: `FlowCrafter API: HTTP ${flowRes.status}` })
                return res.end()
            }
            const flowData = await flowRes.json()

            const apiKey = decryptSecret(aiConfig.encryptedApiKey)
            const aiModel = aiConfig.model ?? DEFAULT_MODEL
            const analysis = await analyzeFlow(apiKey, aiModel, flowData, runtimeHash, conn.url, phpHeaders, send)

            send({ type: 'result', analysis, model: aiModel, timestamp: new Date().toISOString() })
        } catch (err) {
            console.error('Analyze error:', err)
            const detail = {}
            if (err.status) detail.status = err.status
            if (err.error) detail.body = err.error
            const message = err.error?.error?.message ?? err.message ?? 'Analyse fehlgeschlagen.'
            send({ type: 'error', error: message, detail: Object.keys(detail).length > 0 ? detail : undefined })
        }
        return res.end()
    }

    // ── Static files ─────────────────────────────────────────────────────────
    let filePath = join(DIST, path === '' ? '/index.html' : path)
    if (!existsSync(filePath)) filePath = join(DIST, 'index.html') // SPA fallback

    const mime = MIME[extname(filePath)] ?? 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': mime })
    createReadStream(filePath).pipe(res)
})

server.listen(PORT, () => console.log(`FlowCrafter UI node service → http://localhost:${PORT}`))

process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down…')
    server.close(() => process.exit(0))
})
process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down…')
    server.close(() => process.exit(0))
})

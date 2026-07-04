import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, createReadStream } from 'node:fs'
import { join, extname, dirname, resolve } from 'node:path'
import { scryptSync, randomBytes, timingSafeEqual, createHash, createCipheriv, createDecipheriv } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'

const APP_VERSION = existsSync('./VERSION') ? readFileSync('./VERSION', 'utf8').trim() : 'dev'
const DIST = join(dirname(fileURLToPath(import.meta.url)), 'dist')
const PORT = Number(process.env.PORT ?? 3000)
const MAX_BODY_SIZE = 1_048_576

const AI_FILE = './data/ai.json'
const AUTH_FILE = './data/auth.json'
const CONNECTION_FILE = './data/connection.json'
const DEV_IMPORT_FILE = './data/dev-import.json'
const KEY_FILE = './data/.key'
const MASKING_RULES_FILE = './data/masking-rules.json'

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
const AI_MODELS_ANTHROPIC = [
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', provider: 'anthropic' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', provider: 'anthropic' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic' },
]
const DEFAULT_MODEL = 'claude-sonnet-5'
const DEFAULT_OLLAMA_URL = 'http://localhost:11434'
// Abgeschaltete Modell-IDs aus älteren Configs auf die Nachfolger umleiten
const LEGACY_MODEL_MAP = {
    'claude-sonnet-4-20250514': 'claude-sonnet-5',
    'claude-opus-4-20250514': 'claude-opus-4-8',
    'claude-haiku-4-5-20251001': 'claude-haiku-4-5',
}

function loadAiConfig() {
    if (!existsSync(AI_FILE)) return { provider: null, encryptedApiKey: null, model: null, ollamaUrl: null }
    const cfg = JSON.parse(readFileSync(AI_FILE, 'utf8'))
    cfg.ollamaUrl = cfg.ollamaUrl ?? null
    if (cfg.provider === 'anthropic' && LEGACY_MODEL_MAP[cfg.model]) cfg.model = LEGACY_MODEL_MAP[cfg.model]
    return cfg
}

function saveAiConfig(provider, apiKey, model, ollamaUrl) {
    mkdirSync(dirname(AI_FILE), { recursive: true })
    const existing = loadAiConfig()
    const encryptedApiKey = apiKey ? encryptSecret(apiKey) : existing.encryptedApiKey
    writeFileSync(AI_FILE, JSON.stringify({ provider, encryptedApiKey, model, ollamaUrl: ollamaUrl ?? null }, null, 2))
}

function clearAiConfig() {
    if (existsSync(AI_FILE))
        writeFileSync(AI_FILE, JSON.stringify({ provider: null, encryptedApiKey: null, model: null, ollamaUrl: null }, null, 2))
}

async function fetchOllamaModels(ollamaUrl) {
    try {
        const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) })
        if (!res.ok) return { reachable: false, models: [] }
        const data = await res.json()
        const models = (data.models ?? []).map(m => ({ id: m.name, label: m.name, provider: 'ollama' }))
        return { reachable: true, models }
    } catch {
        return { reachable: false, models: [] }
    }
}

// ─── Masking rules store ────��────��───────────────────────────────────────────
function loadMaskingRules() {
    if (!existsSync(MASKING_RULES_FILE)) return null
    return JSON.parse(readFileSync(MASKING_RULES_FILE, 'utf8'))
}

function saveMaskingRules(rules) {
    mkdirSync(dirname(MASKING_RULES_FILE), { recursive: true })
    writeFileSync(MASKING_RULES_FILE, JSON.stringify(rules, null, 2))
}
function maskFlowData(obj, rules) {
    if (obj === null || obj === undefined) return obj
    if (Array.isArray(obj)) return obj.map(item => maskFlowData(item, rules))
    if (typeof obj !== 'object') return obj

    const masked = {}
    for (const [key, value] of Object.entries(obj)) {
        if (rules.some(r => r.enabled && key.toLowerCase() === r.field.toLowerCase())) {
            masked[key] = '***'
        } else if (typeof value === 'object' && value !== null) {
            masked[key] = maskFlowData(value, rules)
        } else {
            masked[key] = value
        }
    }
    return masked
}

// ─── Dev import store ─────────────────────────────────────────────────────────
function loadDevImport() {
    if (!existsSync(DEV_IMPORT_FILE)) return null
    return JSON.parse(readFileSync(DEV_IMPORT_FILE, 'utf8'))
}

function saveDevImport(data) {
    mkdirSync(dirname(DEV_IMPORT_FILE), { recursive: true })
    writeFileSync(DEV_IMPORT_FILE, JSON.stringify(data, null, 2))
}

function clearDevImport() {
    if (existsSync(DEV_IMPORT_FILE)) unlinkSync(DEV_IMPORT_FILE)
}

// Niemals das (verschlüsselte) Secret an den Client ausliefern.
function publicDevImport(snapshot) {
    if (!snapshot) return snapshot
    const rest = { ...snapshot }
    delete rest.encryptedSecret
    return rest
}

// ─── AI analysis ─────────────────────────────────────────────────────────────
const ANALYSIS_SYSTEM_PROMPT = `Du bist ein Experte fuer Workflow- und State-Machine-Analyse fuer FlowCrafter, eine PHP message-driven Workflow-Engine.

Du analysierst Flow-Ausfuehrungsdaten und lieferst konkrete, umsetzbare Erkenntnisse in diesen Kategorien:
- "error": Erkannte oder wahrscheinliche Fehlerquellen
- "warning": Praeventive Warnungen vor moeglichen Problemen
- "performance": Performance-Auffaelligkeiten innerhalb eines flowRuns (Zeitluecken, langsame Steps, unnoetige Verarbeitung)
- "info": Allgemeine Beobachtungen und Verbesserungsvorschlaege

Ein Flow besteht aus:
- Einem Schema mit Steps (Prozessoren), die typisierte Messages konsumieren und produzieren
- Messages fliessen zwischen Steps mit den Zustaenden: WAIT -> PROCESS -> FINISH
- Jede Message hat Zeitstempel, predecessorHash-Ketten und ist an einen flowRuntimeHash (Run) gebunden
- Exceptions werden mit vollstaendigem Stack-Trace erfasst
- FlowResults erfassen boolsche Rueckgabewerte von Steps. Jeder Step kann bool|MessageDataInterface|MessageReturnInterface zurueckgeben. Ein FlowResult enthaelt: stepSource, stepHash, result (true/false), flowRuntimeHash. Ein result=false bedeutet, dass der Step die Verarbeitung abgelehnt hat (Status "rejected"), ist aber KEIN Fehler — der Flow kann trotzdem weiterlaufen
- Pro Flow Instanze koennen mehrere Runs existieren (Wiederausfuehrung mit neuen Messages)
- Jeder Run in einer Flow Instanze wird durch eine Message ausgelöst, diese Message besitzt kein predecessorHash
- WICHTIG: Nur der allererste Run einer Flow-Instanz (zeitlich fruehester) startet mit einer Init-Message (messageEnum:"init") und durchlaeuft den Init-Step. Alle nachfolgenden Runs können ohne Init-Step starten — sie setzen den Flow an einer beliebigen Stelle fort (z.B. nach einem Fehler). Das Fehlen des Init-Steps in einem Folge-Run ist KEIN Fehler und KEINE Auffaelligkeit, sondern gewolltes Verhalten
- Messages in flowMessages sind nicht sortiert
- Mehrere Runs sind normal und gewollt: Ein Run bricht typischerweise ab, wenn ein Step einen Fehler im eigenen Code hat oder eine externe Abhaengigkeit einen Fehler zurueckliefert. In diesem Fall wird ein neuer Run mit gleicher oder geänderten message gestartet um den Flow fortzusetzen. Das ist erwartetes Verhalten und KEINE Auffaelligkeit.
- includeSteps: Beim Starten eines Runs kann der Benutzer eine Auswahl treffen, welche Steps ausgefuehrt werden sollen (includeSteps). Wenn eine messageSource von mehreren Steps konsumiert wird, kann der Benutzer gezielt einzelne Steps ein- oder ausschliessen. Wenn in einem Run bestimmte Steps nicht ausgefuehrt wurden obwohl sie laut Schema die Message konsumieren, ist das KEIN Fehler — es kann eine bewusste includeSteps-Auswahl gewesen sein.

Antworte AUSSCHLIESSLICH mit validem JSON in genau dieser Struktur:
{
  "summary": "1-2 Saetze Gesamtbewertung",
  "findings": [
    {
      "category": "error|warning|performance|info",
      "severity": "high|medium|low",
      "title": "Kurzer Titel",
      "description": "Detaillierte Erklaerung mit konkreten Verweisen auf Steps/Messages",
      "affectedStep": "ClassName oder null"
    }
  ]
}

Du hast Zugriff auf das Tool "get_step_source", um den PHP-Quellcode einzelner Steps zu laden. Nutze es, wenn der Quellcode fuer eine fundierte Analyse hilfreich waere (z.B. bei Exceptions, unklarem Verhalten oder Performance-Problemen).

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

// Anthropic format
const ANALYSIS_TOOLS = [
    {
        name: 'get_step_source',
        description:
            'Laedt den PHP-Quellcode eines Steps anhand seines stepHash. Nutze dieses Tool, wenn du den Quellcode eines Steps benoetist um die Analyse zu vertiefen (z.B. bei Fehlern, unklarer Logik oder Performance-Problemen). Der stepHash ist in den Flow-Messages und Exceptions enthalten und ermoeglicht auch den Zugriff auf archivierte Versionen.',
        input_schema: {
            type: 'object',
            properties: {
                stepHash: {
                    type: 'string',
                    description: 'Der stepHash des Steps (z.B. aus flowMessages[].stepHash oder flowExceptions[].stepHash)',
                },
                className: {
                    type: 'string',
                    description: 'Vollqualifizierter PHP-Klassenname des Steps (z.B. App\\Steps\\MyStep) — nur zur Anzeige',
                },
            },
            required: ['stepHash'],
        },
    },
]

// OpenAI-compatible format (used by Ollama)
const ANALYSIS_TOOLS_OPENAI = [
    {
        type: 'function',
        function: {
            name: 'get_step_source',
            description: ANALYSIS_TOOLS[0].description,
            parameters: ANALYSIS_TOOLS[0].input_schema,
        },
    },
]

// JSON-Schema fuer Structured Outputs (nur Anthropic) — erzwingt das Antwortformat aus dem System-Prompt
const ANALYSIS_OUTPUT_SCHEMA = {
    type: 'object',
    properties: {
        summary: { type: 'string' },
        findings: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    category: { type: 'string', enum: ['error', 'warning', 'performance', 'info'] },
                    severity: { type: 'string', enum: ['high', 'medium', 'low'] },
                    title: { type: 'string' },
                    description: { type: 'string' },
                    affectedStep: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                },
                required: ['category', 'severity', 'title', 'description', 'affectedStep'],
                additionalProperties: false,
            },
        },
    },
    required: ['summary', 'findings'],
    additionalProperties: false,
}

function shortClassName(fqn) {
    return fqn?.split('\\').pop() ?? fqn
}

function extractJsonFromText(text) {
    const clean = text
        .replace(/```json?\n?/g, '')
        .replace(/```\s*$/g, '')
        .trim()
    const match = clean.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('Keine gueltige JSON-Antwort vom AI-Modell erhalten.')
    return JSON.parse(match[0])
}

async function fetchStepSource(stepHash, className, phpUrl, phpHeaders, onProgress, signal) {
    onProgress({ type: 'tool_use', message: `Lade Quellcode: ${shortClassName(className ?? stepHash)}` })
    try {
        const p = new URLSearchParams({ stepHash })
        const srcRes = await fetch(`${phpUrl}/api/flow/step-source?${p}`, { headers: phpHeaders, signal })
        return srcRes.ok ? await srcRes.json() : { error: `HTTP ${srcRes.status}` }
    } catch (err) {
        if (err.name === 'AbortError') throw err
        return { error: err.message }
    }
}

async function analyzeFlowAnthropic(apiKey, model, flowData, runtimeHash, phpUrl, phpHeaders, onProgress, signal) {
    const client = new Anthropic({ apiKey })
    const messages = [{ role: 'user', content: buildUserPrompt(flowData, runtimeHash) }]
    const callAnthropic = msgs => {
        const stream = client.messages.stream(
            {
                model,
                max_tokens: 16000,
                system: ANALYSIS_SYSTEM_PROMPT,
                tools: ANALYSIS_TOOLS,
                messages: msgs,
                output_config: { format: { type: 'json_schema', schema: ANALYSIS_OUTPUT_SCHEMA } },
                // Auto-Caching: Folge-Requests der Tool-Schleife lesen System-Prompt + Flow-Daten aus dem Cache
                cache_control: { type: 'ephemeral' },
            },
            { signal }
        )
        stream.on('text', text => onProgress({ type: 'delta', text }))
        return stream.finalMessage()
    }

    onProgress({ type: 'status', message: 'Flow-Daten werden analysiert…' })

    let response = await callAnthropic(messages)
    let inputTokens = response.usage?.input_tokens ?? 0
    let outputTokens = response.usage?.output_tokens ?? 0

    while (response.stop_reason === 'tool_use') {
        const toolBlocks = response.content.filter(b => b.type === 'tool_use')
        messages.push({ role: 'assistant', content: response.content })

        const toolResults = []
        for (const block of toolBlocks) {
            if (block.name === 'get_step_source') {
                const srcData = await fetchStepSource(block.input.stepHash, block.input.className, phpUrl, phpHeaders, onProgress, signal)
                toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(srcData) })
            }
        }

        onProgress({ type: 'status', message: 'Analyse wird fortgesetzt…' })
        messages.push({ role: 'user', content: toolResults })
        response = await callAnthropic(messages)
        inputTokens += response.usage?.input_tokens ?? 0
        outputTokens += response.usage?.output_tokens ?? 0
    }

    if (response.stop_reason === 'max_tokens') {
        throw new Error('Die Analyse wurde am Token-Limit abgeschnitten. Bitte erneut versuchen oder einen einzelnen Run analysieren.')
    }

    const text = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
    // Structured Outputs garantieren valides JSON nach ANALYSIS_OUTPUT_SCHEMA
    return { analysis: JSON.parse(text), usage: { inputTokens, outputTokens } }
}

async function ollamaUnloadModel(ollamaUrl, model) {
    try {
        await fetch(`${ollamaUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, keep_alive: 0 }),
            signal: AbortSignal.timeout(3000),
        })
    } catch {
        // best-effort
    }
}

async function analyzeFlowOllama(ollamaUrl, model, flowData, runtimeHash, phpUrl, phpHeaders, onProgress, signal) {
    const messages = [
        { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(flowData, runtimeHash) },
    ]

    onProgress({ type: 'status', message: 'Flow-Daten werden analysiert…' })

    const callOllama = async msgs => {
        const res = await fetch(`${ollamaUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: msgs,
                tools: ANALYSIS_TOOLS_OPENAI,
                stream: true,
                stream_options: { include_usage: true },
                options: { num_ctx: 32768 },
            }),
            signal,
        })
        if (!res.ok) {
            const err = await res.text().catch(() => `HTTP ${res.status}`)
            throw new Error(`Ollama: ${err}`)
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        let content = ''
        const toolCalls = []
        let finishReason = null
        let promptTokens = 0
        let completionTokens = 0
        outer: while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buf += decoder.decode(value, { stream: true })
            const lines = buf.split('\n')
            buf = lines.pop()
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue
                const data = line.slice(6).trim()
                if (data === '[DONE]') break outer
                const chunk = JSON.parse(data)
                const delta = chunk.choices?.[0]?.delta
                if (delta?.content) content += delta.content
                for (const tc of delta?.tool_calls ?? []) {
                    const i = tc.index ?? 0
                    if (!toolCalls[i]) toolCalls[i] = { id: '', function: { name: '', arguments: '' } }
                    if (tc.id) toolCalls[i].id = tc.id
                    if (tc.function?.name) toolCalls[i].function.name += tc.function.name
                    if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments
                }
                if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason
                if (chunk.usage) {
                    promptTokens = chunk.usage.prompt_tokens ?? 0
                    completionTokens = chunk.usage.completion_tokens ?? 0
                    if (finishReason) break outer
                }
            }
        }
        return {
            choices: [{ message: { content, tool_calls: toolCalls.length > 0 ? toolCalls : undefined }, finish_reason: finishReason }],
            usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
        }
    }

    let response = await callOllama(messages)
    let choice = response.choices?.[0]
    let inputTokens = response.usage?.prompt_tokens ?? 0
    let outputTokens = response.usage?.completion_tokens ?? 0

    while (choice?.finish_reason === 'tool_calls') {
        const toolCalls = choice.message.tool_calls ?? []
        messages.push({ role: 'assistant', content: choice.message.content ?? null, tool_calls: toolCalls })

        for (const call of toolCalls) {
            const args = JSON.parse(call.function.arguments ?? '{}')
            const srcData = await fetchStepSource(args.stepHash, args.className, phpUrl, phpHeaders, onProgress, signal)
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(srcData) })
        }

        onProgress({ type: 'status', message: 'Analyse wird fortgesetzt…' })
        response = await callOllama(messages)
        choice = response.choices?.[0]
        inputTokens += response.usage?.prompt_tokens ?? 0
        outputTokens += response.usage?.completion_tokens ?? 0
    }

    const text = choice?.message?.content ?? ''
    return { analysis: extractJsonFromText(text), usage: { inputTokens, outputTokens } }
}

async function analyzeFlow(provider, apiKey, ollamaUrl, model, flowData, runtimeHash, phpUrl, phpHeaders, onProgress, signal) {
    if (provider === 'ollama') {
        return analyzeFlowOllama(ollamaUrl, model, flowData, runtimeHash, phpUrl, phpHeaders, onProgress, signal)
    }
    return analyzeFlowAnthropic(apiKey, model, flowData, runtimeHash, phpUrl, phpHeaders, onProgress, signal)
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
    return new Promise((resolve, reject) => {
        let raw = ''
        let bytes = 0
        req.on('data', c => {
            bytes += c.length
            if (bytes > MAX_BODY_SIZE) {
                req.destroy()
                return reject(Object.assign(new Error('Anfrage zu groß.'), { statusCode: 413 }))
            }
            raw += c
        })
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

// ─── Rate limiting ───────────────────────────────────────────────────────────
const rateLimits = new Map()
const RATE_LIMIT_WINDOW = 15 * 60 * 1000
const RATE_LIMIT_MAX = 10

function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? req.socket.remoteAddress
}

function checkRateLimit(req) {
    const ip = getClientIp(req)
    const now = Date.now()
    const entry = rateLimits.get(ip)
    if (!entry || now > entry.resetAt) {
        rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW })
        return false
    }
    entry.count++
    return entry.count > RATE_LIMIT_MAX
}

setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of rateLimits) {
        if (now > entry.resetAt) rateLimits.delete(key)
    }
}, 60_000).unref()

// ─── URL validation ─────────────────────────────────────────────────────────
const BLOCKED_HOSTS = new Set(['metadata.google.internal', 'metadata.internal', 'kubernetes.default', 'kubernetes.default.svc'])

function isUrlAllowed(urlStr) {
    try {
        const parsed = new URL(urlStr)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
        const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
        if (BLOCKED_HOSTS.has(host)) return false
        return true
    } catch {
        return false
    }
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
    if (p === '/api/version') return '/api/version'
    if (p.startsWith('/api/dev-import')) return '/api/dev-import'
    if (p === '/api/fc-ping') return '/api/fc-ping'
    if (p === '/api/masking-rules') return '/api/masking-rules'
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

    try {
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
            const db = loadDb()
            if (!validToken(db, bearerToken(req))) return json(res, { error: 'Nicht autorisiert.' }, 401)
            const body = renderMetrics()
            res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' })
            return res.end(body)
        }

        // ── Version endpoint ─────────────────────────────────────────────────────
        if (method === 'GET' && path === '/api/version') {
            const db = loadDb()
            if (!validToken(db, bearerToken(req))) return json(res, { error: 'Nicht autorisiert.' }, 401)
            return json(res, { version: APP_VERSION })
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
                if (checkRateLimit(req)) return json(res, { error: 'Zu viele Versuche. Bitte später erneut versuchen.' }, 429)
                if (db.passwordHash) return json(res, { error: 'Bereits gesetzt.' }, 409)
                const { password } = await readBody(req)
                if (!password || password.length < 6) return json(res, { error: 'Min. 6 Zeichen.' }, 400)
                db.passwordHash = hashPassword(password)
                return json(res, { token: createToken(db) })
            }

            if (method === 'POST' && path === '/api/auth/login') {
                if (checkRateLimit(req)) return json(res, { error: 'Zu viele Versuche. Bitte später erneut versuchen.' }, 429)
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
                const isOllama = config.provider === 'ollama'
                const ollamaUrl = config.ollamaUrl ?? DEFAULT_OLLAMA_URL
                const ollamaResult = isOllama ? await fetchOllamaModels(ollamaUrl) : null
                const models = isOllama ? ollamaResult.models : AI_MODELS_ANTHROPIC
                const configured = isOllama ? !!config.ollamaUrl : !!config.encryptedApiKey
                return json(res, {
                    configured,
                    provider: config.provider ?? 'anthropic',
                    model: config.model ?? DEFAULT_MODEL,
                    models,
                    anthropicModels: AI_MODELS_ANTHROPIC,
                    ollamaUrl,
                })
            }

            if (method === 'POST') {
                const { apiKey, provider, model, ollamaUrl } = await readBody(req)
                const resolvedProvider = provider || 'anthropic'

                if (resolvedProvider === 'ollama') {
                    const url = (ollamaUrl || DEFAULT_OLLAMA_URL).replace(/\/$/, '')
                    const { reachable, models } = await fetchOllamaModels(url)
                    if (!reachable) {
                        return json(res, { error: `Ollama nicht erreichbar unter ${url}. Bitte URL prüfen.` }, 400)
                    }
                    if (models.length === 0) {
                        return json(
                            res,
                            {
                                error: `Ollama ist erreichbar, aber es sind keine Modelle installiert. Bitte zuerst ein Modell laden (z.B. "ollama pull qwen2.5-coder:7b").`,
                            },
                            400
                        )
                    }
                    const selectedModel = models.some(m => m.id === model) ? model : models[0].id
                    saveAiConfig('ollama', null, selectedModel, url)
                    return json(res, { ok: true })
                }

                // Anthropic — Key und Modell-ID validieren (models.retrieve ist kostenlos)
                const selectedModel = AI_MODELS_ANTHROPIC.some(m => m.id === model) ? model : DEFAULT_MODEL
                const existingConfig = loadAiConfig()
                const keyToValidate = apiKey ?? (existingConfig.encryptedApiKey ? decryptSecret(existingConfig.encryptedApiKey) : null)
                if (keyToValidate) {
                    try {
                        const client = new Anthropic({ apiKey: keyToValidate })
                        await client.models.retrieve(selectedModel)
                    } catch (err) {
                        const msg = err.error?.error?.message ?? err.message ?? 'API-Key ungültig.'
                        return json(res, { error: msg }, 400)
                    }
                }
                saveAiConfig('anthropic', apiKey, selectedModel, null)
                return json(res, { ok: true })
            }

            if (method === 'DELETE') {
                clearAiConfig()
                return json(res, { ok: true })
            }

            return json(res, { error: 'Not found.' }, 404)
        }

        // ── Dev import API ───────────────────────────────────────────────────────
        if (path.startsWith('/api/dev-import')) {
            const db = loadDb()
            if (!validToken(db, bearerToken(req))) return json(res, { error: 'Nicht autorisiert.' }, 401)

            if (method === 'GET' && path === '/api/dev-import') {
                return json(res, publicDevImport(loadDevImport()))
            }

            // Leichtgewichtiger Freshness-Check: Remote-Hashes gegen den Snapshot vergleichen.
            if (method === 'GET' && path === '/api/dev-import/check') {
                const snapshot = loadDevImport()
                if (!snapshot) return json(res, { hasImport: false })
                if (!snapshot.sourceUrl || !snapshot.encryptedSecret || !snapshot.schemaHash) {
                    return json(res, { hasImport: true, canCheck: false })
                }

                try {
                    const secret = decryptSecret(snapshot.encryptedSecret)
                    const headers = secret ? { Authorization: `Bearer ${secret}` } : {}
                    const hashRes = await fetch(`${snapshot.sourceUrl}/api/flow/schema-import-hashes`, { headers })
                    if (!hashRes.ok) return json(res, { hasImport: true, canCheck: false, error: `HTTP ${hashRes.status}` })

                    const current = await hashRes.json()
                    const changed = current.schemaHash !== snapshot.schemaHash || current.messageSourceHash !== snapshot.messageSourceHash
                    return json(res, {
                        hasImport: true,
                        canCheck: true,
                        changed,
                        current,
                        stored: { schemaHash: snapshot.schemaHash, messageSourceHash: snapshot.messageSourceHash },
                    })
                } catch (err) {
                    return json(res, { hasImport: true, canCheck: false, error: err.cause?.code ?? err.message })
                }
            }

            if (method === 'DELETE' && path === '/api/dev-import') {
                clearDevImport()
                return json(res, { ok: true })
            }

            if (method === 'POST' && path === '/api/dev-import') {
                const body = await readBody(req)

                // Save pre-built snapshot (from client-side fetch)
                if (body?.schemas) {
                    saveDevImport(body)
                    return json(res, publicDevImport(body))
                }

                // Server-side fetch: { url, secret }
                const { url: importUrl } = body
                if (!importUrl) return json(res, { error: 'url fehlt.' }, 400)
                if (!isUrlAllowed(importUrl)) return json(res, { error: 'Ungültige URL.' }, 403)

                const baseUrl = importUrl.replace(/\/$/, '')

                // Secret wiederverwenden, wenn kein neues angegeben wurde (z. B. Re-Import aus dem Änderungs-Popup).
                let secret = body.secret ?? ''
                if (!secret) {
                    const existing = loadDevImport()
                    if (existing?.sourceUrl === baseUrl && existing?.encryptedSecret) {
                        try {
                            secret = decryptSecret(existing.encryptedSecret)
                        } catch {
                            // ungültiges/altes Secret — ignorieren
                        }
                    }
                }

                const headers = secret ? { Authorization: `Bearer ${secret}` } : {}

                try {
                    const [schemasRes, messageSourcesRes, hashesRes] = await Promise.all([
                        fetch(`${baseUrl}/api/flow/schema-list`, { headers }),
                        fetch(`${baseUrl}/api/flow/message-source-list`, { headers }),
                        fetch(`${baseUrl}/api/flow/schema-import-hashes`, { headers }).catch(() => null),
                    ])

                    if (schemasRes.status === 401)
                        return json(res, { error: 'Authentifizierung fehlgeschlagen — Bearer Secret prüfen.' }, 401)
                    if (!schemasRes.ok) return json(res, { error: `Fehler vom Server: HTTP ${schemasRes.status}` }, 502)

                    const rawText = await schemasRes.text()
                    let schemas
                    try {
                        schemas = JSON.parse(rawText)
                    } catch {
                        return json(
                            res,
                            { error: 'Kein gültiges JSON erhalten. Bitte die PHP-Backend-URL angeben, nicht die UI-Server-URL.' },
                            502
                        )
                    }

                    const messageSources = {}
                    if (messageSourcesRes.ok) {
                        const rawMsgText = await messageSourcesRes.text()
                        try {
                            const msgSourcesArr = JSON.parse(rawMsgText)
                            if (Array.isArray(msgSourcesArr)) {
                                for (const entry of msgSourcesArr) {
                                    if (entry.messageSource) {
                                        messageSources[entry.messageSource] = entry.propertyNames ?? {}
                                    }
                                }
                            }
                        } catch {
                            // message-sources nicht verfügbar — kein Fehler
                        }
                    }

                    let schemaHash = null
                    let messageSourceHash = null
                    if (hashesRes?.ok) {
                        try {
                            const h = await hashesRes.json()
                            schemaHash = h.schemaHash ?? null
                            messageSourceHash = h.messageSourceHash ?? null
                        } catch {
                            // hashes nicht verfügbar — Freshness-Check später nicht möglich
                        }
                    }

                    const schemasMap = {}
                    for (const s of schemas) {
                        schemasMap[s.type] = { storedHash: s.schemaHash, steps: s.steps }
                    }
                    const snapshot = {
                        importedAt: new Date().toISOString(),
                        sourceUrl: baseUrl,
                        schemaCount: Object.keys(schemasMap).length,
                        messageSourceCount: Object.keys(messageSources).length,
                        schemaHash,
                        messageSourceHash,
                        encryptedSecret: secret ? encryptSecret(secret) : null,
                        schemas: schemasMap,
                        messageSources,
                    }
                    saveDevImport(snapshot)
                    return json(res, publicDevImport(snapshot))
                } catch (err) {
                    const cause = err.cause?.code ?? err.cause?.message ?? err.message
                    console.error('Dev import error:', cause)
                    return json(res, { error: `Verbindung fehlgeschlagen: ${cause}` }, 502)
                }
            }

            return json(res, { error: 'Not found.' }, 404)
        }

        // ── Masking rules API ────────────────────────────────────────────────
        if (path === '/api/masking-rules') {
            const db = loadDb()
            if (!validToken(db, bearerToken(req))) return json(res, { error: 'Nicht autorisiert.' }, 401)

            if (method === 'GET') {
                const rules = loadMaskingRules()
                return json(res, rules ?? [])
            }

            if (method === 'POST') {
                const rules = await readBody(req)
                if (!Array.isArray(rules)) return json(res, { error: 'Ungültiges Format.' }, 400)
                saveMaskingRules(rules)
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
            if (!isUrlAllowed(conn.url)) return json(res, { error: 'Ungültige Ziel-URL.' }, 403)

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
            if (!isUrlAllowed(pingUrl)) return json(res, { error: 'Ungültige URL.' }, 403)

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
            const aiProvider = aiConfig.provider ?? 'anthropic'
            const isConfigured = aiProvider === 'ollama' ? !!aiConfig.ollamaUrl : !!aiConfig.encryptedApiKey
            if (!isConfigured) return json(res, { error: 'AI nicht konfiguriert.' }, 503)

            const conn = loadConnection()
            if (!conn.url) return json(res, { error: 'Keine FlowCrafter-Verbindung konfiguriert.' }, 503)
            if (!isUrlAllowed(conn.url)) return json(res, { error: 'Ungültige Ziel-URL.' }, 403)

            const { flowHash, runtimeHash } = await readBody(req)
            if (!flowHash) return json(res, { error: 'flowHash fehlt.' }, 400)

            res.writeHead(200, {
                'Content-Type': 'application/x-ndjson',
                'Cache-Control': 'no-cache',
                'Access-Control-Allow-Origin': '*',
            })

            const send = data => res.write(JSON.stringify(data) + '\n')

            const abort = new AbortController()
            const ollamaUrl = aiConfig.ollamaUrl ?? DEFAULT_OLLAMA_URL
            const aiModel = aiConfig.model ?? DEFAULT_MODEL
            let analysisCompleted = false
            res.on('close', () => {
                abort.abort()
                if (aiProvider === 'ollama' && !analysisCompleted) ollamaUnloadModel(ollamaUrl, aiModel)
            })

            try {
                send({ type: 'status', message: 'Flow-Daten werden geladen…' })
                const phpSecret = conn.encryptedSecret ? decryptSecret(conn.encryptedSecret) : null
                const phpHeaders = phpSecret ? { Authorization: `Bearer ${phpSecret}` } : {}
                const flowRes = await fetch(`${conn.url}/api/flow/flow-details?hash=${encodeURIComponent(flowHash)}`, {
                    headers: phpHeaders,
                    signal: abort.signal,
                })
                if (!flowRes.ok) {
                    send({ type: 'error', error: `FlowCrafter API: HTTP ${flowRes.status}` })
                    return res.end()
                }
                const flowData = await flowRes.json()

                const maskingRules = loadMaskingRules()
                const maskedFlowData = maskingRules?.length > 0 ? maskFlowData(flowData, maskingRules) : flowData

                const apiKey = aiProvider === 'anthropic' && aiConfig.encryptedApiKey ? decryptSecret(aiConfig.encryptedApiKey) : null
                const { analysis, usage } = await analyzeFlow(
                    aiProvider,
                    apiKey,
                    ollamaUrl,
                    aiModel,
                    maskedFlowData,
                    runtimeHash,
                    conn.url,
                    phpHeaders,
                    send,
                    abort.signal
                )

                analysisCompleted = true
                send({ type: 'result', analysis, model: aiModel, provider: aiProvider, usage, timestamp: new Date().toISOString() })
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('Analyze error:', err)
                    const detail = {}
                    if (err.status) detail.status = err.status
                    if (err.error) detail.body = err.error
                    const message = err.error?.error?.message ?? err.message ?? 'Analyse fehlgeschlagen.'
                    send({ type: 'error', error: message, detail: Object.keys(detail).length > 0 ? detail : undefined })
                }
            }
            return res.end()
        }

        // ── Static files ─────────────────────────────────────────────────────────
        let filePath = resolve(join(DIST, path === '' ? '/index.html' : path))
        if (!filePath.startsWith(DIST)) return json(res, { error: 'Forbidden.' }, 403)
        if (!existsSync(filePath)) filePath = join(DIST, 'index.html') // SPA fallback

        const mime = MIME[extname(filePath)] ?? 'application/octet-stream'
        const headers = { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff' }
        if (mime === 'text/html') {
            headers['Content-Security-Policy'] =
                "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'"
            headers['X-Frame-Options'] = 'DENY'
            headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        }
        res.writeHead(200, headers)
        createReadStream(filePath).pipe(res)
    } catch (err) {
        if (res.headersSent) return res.end()
        const status = err.statusCode ?? 500
        return json(res, { error: status === 413 ? err.message : 'Interner Serverfehler.' }, status)
    }
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

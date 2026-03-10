import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync, mkdirSync, createReadStream } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { scryptSync, randomBytes, timingSafeEqual, createHash, createCipheriv, createDecipheriv } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PORT ?? 3000)
const DB_FILE = './data/auth.json'
const CONNECTION_FILE = './data/connection.json'
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
    if (!existsSync(DB_FILE)) return { passwordHash: null, sessions: {} }
    return JSON.parse(readFileSync(DB_FILE, 'utf8'))
}

function saveDb(db) {
    mkdirSync(dirname(DB_FILE), { recursive: true })
    writeFileSync(DB_FILE, JSON.stringify(db, null, 2))
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

// ─── Server ───────────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost`)
    const path = url.pathname.replace(/\/$/, '')
    const method = req.method

    // CORS preflight
    if (method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        })
        return res.end()
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

    // ── Static files ─────────────────────────────────────────────────────────
    let filePath = join(DIST, path === '' ? '/index.html' : path)
    if (!existsSync(filePath)) filePath = join(DIST, 'index.html') // SPA fallback

    const mime = MIME[extname(filePath)] ?? 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': mime })
    createReadStream(filePath).pipe(res)
})

server.listen(PORT, () => console.log(`FlowCrafter UI → http://localhost:${PORT}`))

process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down…')
    server.close(() => process.exit(0))
})
process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down…')
    server.close(() => process.exit(0))
})

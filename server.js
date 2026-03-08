import { createServer }                               from 'node:http'
import { readFileSync, writeFileSync, existsSync,
         mkdirSync, createReadStream }                from 'node:fs'
import { join, extname, dirname }                     from 'node:path'
import { scryptSync, randomBytes, timingSafeEqual,
         createHash }                                  from 'node:crypto'
import { fileURLToPath }                              from 'node:url'

const PORT     = Number(process.env.PORT     ?? 3000)
const DB_FILE  = './data/auth.json'
const DIST     = join(dirname(fileURLToPath(import.meta.url)), 'dist')

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.png':  'image/png',
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
  const token   = randomBytes(32).toString('hex')
  const expires = Date.now() + 86_400_000   // 24h
  db.sessions[hashToken(token)] = expires
  // prune expired
  for (const [h, exp] of Object.entries(db.sessions)) {
    if (exp < Date.now()) delete db.sessions[h]
  }
  saveDb(db)
  return token   // raw token → client only, never stored
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
    req.on('data', c => raw += c)
    req.on('end', () => resolve(JSON.parse(raw || '{}')))
  })
}

function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(JSON.stringify(data))
}

// ─── Server ───────────────────────────────────────────────────────────────────
createServer(async (req, res) => {
  const url    = new URL(req.url, `http://localhost`)
  const path   = url.pathname.replace(/\/$/, '')
  const method = req.method

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    })
    return res.end()
  }

  // ── Auth API ────────────────────────────────────────────────────────────────
  if (path.startsWith('/api/auth')) {
    const db = loadDb()

    if (method === 'GET' && path === '/api/auth/status') {
      return json(res, {
        hasPassword:   db.passwordHash !== null,
        authenticated: validToken(db, bearerToken(req)),
      })
    }

    if (method === 'POST' && path === '/api/auth/setup') {
      if (db.passwordHash) return json(res, { error: 'Bereits gesetzt.' }, 409)
      const { password } = await readBody(req)
      if (!password || password.length < 6)
        return json(res, { error: 'Min. 6 Zeichen.' }, 400)
      db.passwordHash = hashPassword(password)
      return json(res, { token: createToken(db) })
    }

    if (method === 'POST' && path === '/api/auth/login') {
      if (!db.passwordHash) return json(res, { error: 'Kein Passwort gesetzt.' }, 404)
      const { password } = await readBody(req)
      if (!password || !verifyPassword(password, db.passwordHash))
        return json(res, { error: 'Falsches Passwort.' }, 401)
      return json(res, { token: createToken(db) })
    }

    if (method === 'POST' && path === '/api/auth/change-password') {
      if (!validToken(db, bearerToken(req))) return json(res, { error: 'Nicht autorisiert.' }, 401)
      const { currentPassword, newPassword } = await readBody(req)
      if (!db.passwordHash || !verifyPassword(currentPassword, db.passwordHash))
        return json(res, { error: 'Aktuelles Passwort falsch.' }, 401)
      if (!newPassword || newPassword.length < 6)
        return json(res, { error: 'Min. 6 Zeichen.' }, 400)
      db.passwordHash = hashPassword(newPassword)
      db.sessions     = {}   // invalidate all sessions
      const token     = createToken(db)
      return json(res, { token })
    }

    if (method === 'POST' && path === '/api/auth/logout') {
      const token = bearerToken(req)
      if (token) { delete db.sessions[token]; saveDb(db) }
      return json(res, { ok: true })
    }

    return json(res, { error: 'Not found.' }, 404)
  }

  // ── Static files ────────────────────────────────────────────────────────────
  let filePath = join(DIST, path === '' ? '/index.html' : path)
  if (!existsSync(filePath)) filePath = join(DIST, 'index.html')   // SPA fallback

  const mime = MIME[extname(filePath)] ?? 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': mime })
  createReadStream(filePath).pipe(res)

}).listen(PORT, () => console.log(`FlowCrafter UI → http://localhost:${PORT}`))

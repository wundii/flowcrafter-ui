const TOKEN_KEY = 'fc_token'

function token() {
  return sessionStorage.getItem(TOKEN_KEY)
}

async function call(path, options = {}) {
  try {
    const res = await fetch(path, {
      headers: {
        'Content-Type':  'application/json',
        'Authorization': token() ? `Bearer ${token()}` : '',
      },
      ...options,
    })
    return res.json()
  } catch {
    return { error: 'Server nicht erreichbar.' }
  }
}

export const auth = {
  async status() {
    return call('/api/auth/status')
  },

  async hasPassword() {
    const s = await call('/api/auth/status')
    return s.hasPassword
  },

  isAuthenticated() {
    return !!token()
  },

  async setup(password) {
    const res = await call('/api/auth/setup', {
      method: 'POST',
      body:   JSON.stringify({ password }),
    })
    if (res.token) sessionStorage.setItem(TOKEN_KEY, res.token)
    return res
  },

  async login(password) {
    const res = await call('/api/auth/login', {
      method: 'POST',
      body:   JSON.stringify({ password }),
    })
    if (res.token) sessionStorage.setItem(TOKEN_KEY, res.token)
    return res
  },

  async changePassword(currentPassword, newPassword) {
    const res = await call('/api/auth/change-password', {
      method: 'POST',
      body:   JSON.stringify({ currentPassword, newPassword }),
    })
    if (res.token) sessionStorage.setItem(TOKEN_KEY, res.token)
    return res
  },

  async logout() {
    await call('/api/auth/logout', { method: 'POST' })
    sessionStorage.removeItem(TOKEN_KEY)
  },
}

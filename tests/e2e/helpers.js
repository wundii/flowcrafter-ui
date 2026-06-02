import * as mocks from '../fixtures/api-mocks.js'

export const isMocked = process.env.PW_MOCK !== '0'

export function tab(page, name) {
    return page.locator(`a[role="tab"]`, { hasText: name })
}

export async function loginReal(page) {
    const password = process.env.PW_PASSWORD
    if (!password) throw new Error('PW_PASSWORD env variable required for real mode tests')

    await page.goto('/')
    await page.locator('input[type="password"]').fill(password)
    await page.locator('button[type="submit"]').click()

    const error = page.locator('.alert-error')
    if (await error.isVisible().catch(() => false)) {
        throw new Error('Login fehlgeschlagen — PW_PASSWORD prüfen')
    }

    await page.locator('fc-login').waitFor({ state: 'detached', timeout: 10_000 })

    const tabs = page.locator('a[role="tab"]')
    try {
        await tabs.first().waitFor({ timeout: 3_000 })
        return
    } catch {
        // tabs not visible yet — service setup needed
    }

    const serviceUrl = process.env.PW_SERVICE_URL
    if (!serviceUrl) throw new Error('PW_SERVICE_URL env variable required (Service-Setup nach Login)')

    const setupUrl = page.locator('fc-service-setup input[type="url"]')
    await setupUrl.waitFor({ timeout: 5_000 })
    await setupUrl.fill(serviceUrl)
    if (process.env.PW_SERVICE_SECRET) {
        await page.locator('fc-service-setup input[type="password"]').fill(process.env.PW_SERVICE_SECRET)
    }
    await page.locator('fc-service-setup button[type="submit"]').click()
    await tabs.first().waitFor({ timeout: 10_000 })
}

export async function mockAuthenticatedApp(page, overrides = {}) {
    if (!isMocked) return

    const data = { ...mocks, ...overrides }

    await page.route('**/api/auth/status', route => route.fulfill({ json: data.authStatusAuthenticated ?? mocks.authStatusAuthenticated }))
    await page.route('**/api/auth/login', route => route.fulfill({ json: data.loginSuccess ?? mocks.loginSuccess }))
    await page.route('**/api/connection', async route => {
        if (route.request().method() === 'GET') {
            return route.fulfill({ json: data.connectionConfigured ?? mocks.connectionConfigured })
        }
        if (route.request().method() === 'POST') {
            return route.fulfill({ status: 200 })
        }
        if (route.request().method() === 'DELETE') {
            return route.fulfill({ status: 200 })
        }
        return route.continue()
    })
    await page.route('**/api/ai-config', route => route.fulfill({ json: data.aiConfigUnconfigured ?? mocks.aiConfigUnconfigured }))
    await page.route('**/api/masking-rules', async route => {
        if (route.request().method() === 'GET') {
            return route.fulfill({ json: data.maskingRules ?? [] })
        }
        return route.fulfill({ json: { ok: true } })
    })
    await page.route('**/api/version', route => route.fulfill({ json: data.uiVersion ?? mocks.uiVersion }))

    await mockFlowcrafterApi(page, data)

    await page.addInitScript(token => {
        localStorage.setItem('fc_token', token)
    }, mocks.AUTH_TOKEN)
}

export async function mockUnauthenticatedApp(page, overrides = {}) {
    if (!isMocked) return

    const data = { ...mocks, ...overrides }

    await page.route('**/api/auth/status', route => route.fulfill({ json: data.authStatus ?? mocks.authStatus }))
    await page.route('**/api/auth/login', async route => {
        const body = JSON.parse(route.request().postData() ?? '{}')
        if (body.password === 'correct-password') {
            return route.fulfill({ json: mocks.loginSuccess })
        }
        return route.fulfill({ json: mocks.loginError })
    })
    await page.route('**/api/auth/setup', route => route.fulfill({ json: data.setupSuccess ?? mocks.setupSuccess }))
}

export async function mockFlowcrafterApi(page, data = {}) {
    await page.route('**/api/fc/api/flow/flow-list*', route => route.fulfill({ json: data.flowList ?? mocks.flowList }))
    await page.route('**/api/fc/api/flow/flow-details*', route => route.fulfill({ json: data.flowDetail ?? mocks.flowDetail }))
    await page.route('**/api/fc/api/flow/flow-search*', route => route.fulfill({ json: data.searchResults ?? mocks.searchResults }))
    await page.route('**/api/fc/api/flow/exception-list*', route => route.fulfill({ json: data.exceptionList ?? mocks.exceptionList }))
    await page.route('**/api/fc/api/flow/exceptions-stats*', route => route.fulfill({ json: data.exceptionStats ?? mocks.exceptionStats }))
    await page.route('**/api/fc/api/flow/flow-stats*', route => route.fulfill({ json: data.flowStats ?? mocks.flowStats }))
    await page.route('**/api/fc/api/flow/flow-type-stats*', route => route.fulfill({ json: data.flowTypeStats ?? mocks.flowTypeStats }))
    await page.route('**/api/fc/api/flow/schema-list*', route => route.fulfill({ json: data.schemas ?? mocks.schemas }))
    await page.route('**/api/fc/api/queue/queue-list*', route => route.fulfill({ json: data.queueList ?? mocks.queueList }))
    await page.route('**/api/fc/api/queue/queue-count*', route => route.fulfill({ json: data.queueCount ?? mocks.queueCount }))
    await page.route('**/api/fc/api/schedule/schedule-list*', route => route.fulfill({ json: data.scheduleList ?? mocks.scheduleList }))
    await page.route('**/api/fc/api/info*', route => route.fulfill({ json: data.serverInfo ?? mocks.serverInfo }))
}

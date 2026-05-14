import { test, expect } from '@playwright/test'
import { isMocked, mockUnauthenticatedApp } from './helpers.js'
import * as mocks from '../fixtures/api-mocks.js'

test.describe('Login', () => {
    test('zeigt Login-Formular wenn Passwort existiert', async ({ page }) => {
        if (isMocked) await mockUnauthenticatedApp(page)
        await page.goto('/')

        await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible()
        await expect(page.locator('input[type="password"]')).toBeVisible()
    })

    test('zeigt Setup-Formular wenn kein Passwort existiert', async ({ page }) => {
        test.skip(!isMocked, 'Braucht Mock für authStatus ohne Passwort')
        await mockUnauthenticatedApp(page, { authStatus: mocks.authStatusNoPassword })
        await page.goto('/')

        await expect(page.locator('text=Passwort festlegen')).toBeVisible()
        await expect(page.locator('text=Passwort wiederholen')).toBeVisible()
    })

    test('Login mit korrektem Passwort', async ({ page }) => {
        if (isMocked) {
            await mockUnauthenticatedApp(page)
            await page.route('**/api/connection', route => route.fulfill({ json: mocks.connectionNotConfigured }))
            await page.route('**/api/ai-config', route => route.fulfill({ json: mocks.aiConfigUnconfigured }))
            await page.route('**/api/version', route => route.fulfill({ json: mocks.uiVersion }))
        }

        await page.goto('/')
        const password = isMocked ? 'correct-password' : process.env.PW_PASSWORD
        await page.locator('input[type="password"]').fill(password)
        await page.locator('button[type="submit"]').click()

        await page.locator('fc-login').waitFor({ state: 'detached', timeout: 10_000 })
    })

    test('Login mit falschem Passwort zeigt Fehler', async ({ page }) => {
        if (isMocked) await mockUnauthenticatedApp(page)
        await page.goto('/')

        await page.locator('input[type="password"]').fill('wrong-password-xyz')
        await page.locator('button[type="submit"]').click()

        await expect(page.locator('.alert-error')).toBeVisible()
    })

    test('Passwort-Setup mit zu kurzem Passwort zeigt Fehler', async ({ page }) => {
        test.skip(!isMocked, 'Braucht Mock für Setup-Modus')
        await mockUnauthenticatedApp(page, { authStatus: mocks.authStatusNoPassword })
        await page.goto('/')

        const passwords = page.locator('input[type="password"]')
        await passwords.nth(0).fill('abc')
        await passwords.nth(1).fill('abc')
        await page.locator('button[type="submit"]').click()

        await expect(page.locator('text=mindestens 6 Zeichen')).toBeVisible()
    })

    test('Passwort-Setup mit nicht übereinstimmenden Passwörtern zeigt Fehler', async ({ page }) => {
        test.skip(!isMocked, 'Braucht Mock für Setup-Modus')
        await mockUnauthenticatedApp(page, { authStatus: mocks.authStatusNoPassword })
        await page.goto('/')

        const passwords = page.locator('input[type="password"]')
        await passwords.nth(0).fill('password123')
        await passwords.nth(1).fill('password456')
        await page.locator('button[type="submit"]').click()

        await expect(page.locator('text=stimmen nicht überein')).toBeVisible()
    })
})

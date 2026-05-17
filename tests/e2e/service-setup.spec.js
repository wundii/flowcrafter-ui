import { test, expect } from '@playwright/test'
import { isMocked, mockAuthenticatedApp } from './helpers.js'
import * as mocks from '../fixtures/api-mocks.js'

test.describe('Service Setup', () => {
    test.skip(!isMocked, 'Service-Setup-Tests nur im Mock-Modus')

    test('zeigt Service-Setup wenn keine Verbindung konfiguriert', async ({ page }) => {
        await mockAuthenticatedApp(page, { connectionConfigured: mocks.connectionNotConfigured })
        await page.goto('/')

        await expect(page.locator('text=Service API')).toBeVisible()
        await expect(page.locator('input[type="url"]')).toBeVisible()
    })

    test('Verbindung mit gültiger URL herstellen', async ({ page }) => {
        await mockAuthenticatedApp(page, { connectionConfigured: mocks.connectionNotConfigured })

        await page.route('**/api/fc-ping', route => route.fulfill({ json: mocks.pingSuccess }))

        await page.goto('/')
        await page.locator('input[type="url"]').fill('http://localhost:8000')
        await page.locator('button[type="submit"]').click()

        await expect(page.locator('fc-service-setup')).not.toBeVisible({ timeout: 5000 })
    })

    test('Verbindung mit ungültiger URL zeigt Fehler', async ({ page }) => {
        await mockAuthenticatedApp(page, { connectionConfigured: mocks.connectionNotConfigured })

        await page.route('**/api/fc-ping', route => route.fulfill({ json: { error: 'unreachable' } }))

        await page.goto('/')
        await page.locator('input[type="url"]').fill('http://invalid:9999')
        await page.locator('button[type="submit"]').click()

        await expect(page.locator('.alert-error')).toBeVisible()
        await expect(page.locator('text=nicht erreichbar')).toBeVisible()
    })

    test('Zeigt 401-Fehler bei falschem Secret', async ({ page }) => {
        await mockAuthenticatedApp(page, { connectionConfigured: mocks.connectionNotConfigured })

        await page.route('**/api/fc-ping', route => route.fulfill({ json: mocks.pingUnauthorized }))

        await page.goto('/')
        await page.locator('input[type="url"]').fill('http://localhost:8000')
        await page.locator('input[type="password"]').fill('wrong-secret')
        await page.locator('button[type="submit"]').click()

        await expect(page.locator('text=Zugriff verweigert')).toBeVisible()
    })
})

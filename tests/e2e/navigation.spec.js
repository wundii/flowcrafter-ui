import { test, expect } from '@playwright/test'
import { isMocked, loginReal, mockAuthenticatedApp, tab } from './helpers.js'

test.describe('Navigation', () => {
    test.beforeEach(async ({ page }) => {
        if (isMocked) {
            await mockAuthenticatedApp(page)
            await page.goto('/')
        } else {
            await loginReal(page)
        }
        await expect(page.locator('fc-app')).toBeVisible()
    })

    test('zeigt Übersicht-Tab als Standard', async ({ page }) => {
        await expect(tab(page, 'Overview')).toHaveClass(/tab-active/)
    })

    test('wechselt zu Flows-Tab', async ({ page }) => {
        await tab(page, 'Flows').click()
        await expect(page.locator('fc-type-list')).toBeVisible()
    })

    test('wechselt zu Exceptions-Tab', async ({ page }) => {
        await tab(page, 'Exceptions').click()
        await expect(page.locator('fc-exception-list')).toBeVisible()
    })

    test('wechselt zu Queues-Tab', async ({ page }) => {
        await tab(page, 'Queues').click()
        await expect(page.locator('fc-queue-list')).toBeVisible()
    })

    test('wechselt zu Schemas-Tab', async ({ page }) => {
        await tab(page, 'Schemas').click()
        await expect(page.locator('fc-schema-list')).toBeVisible()
    })

    test('URL wird bei Tab-Wechsel aktualisiert', async ({ page }) => {
        await tab(page, 'Flows').click()
        await expect(page.locator('fc-type-list')).toBeVisible()
        await expect(page).toHaveURL(/#\/flows/)

        await tab(page, 'Exceptions').click()
        await expect(page.locator('fc-exception-list')).toBeVisible()
        await expect(page).toHaveURL(/#\/exceptions/)
    })
})

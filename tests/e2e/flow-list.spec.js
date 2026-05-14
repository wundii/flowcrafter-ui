import { test, expect } from '@playwright/test'
import { isMocked, loginReal, mockAuthenticatedApp, tab } from './helpers.js'

test.describe('Flow-Liste', () => {
    test.beforeEach(async ({ page }) => {
        if (isMocked) {
            await mockAuthenticatedApp(page)
            await page.goto('/')
        } else {
            await loginReal(page)
        }
        await tab(page, 'Flows').click()
        await expect(page.locator('fc-type-list')).toBeVisible()
    })

    test('zeigt Flow-Typen', async ({ page }) => {
        if (isMocked) {
            await expect(page.locator('text=OrderFlow')).toBeVisible()
            await expect(page.locator('text=PaymentFlow')).toBeVisible()
            await expect(page.locator('text=NotificationFlow')).toBeVisible()
        } else {
            const cards = page.locator('fc-type-list .rounded-box')
            await expect(cards.first()).toBeVisible({ timeout: 10_000 })
        }
    })
})

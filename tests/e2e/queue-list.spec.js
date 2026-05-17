import { test, expect } from '@playwright/test'
import { isMocked, loginReal, mockAuthenticatedApp, tab } from './helpers.js'

test.describe('Queue-Liste', () => {
    test.beforeEach(async ({ page }) => {
        if (isMocked) {
            await mockAuthenticatedApp(page)
            await page.goto('/')
        } else {
            await loginReal(page)
        }
        await tab(page, 'Queues').click()
        await expect(page.locator('fc-queue-list')).toBeVisible()
    })

    test('zeigt Queue-Einträge', async ({ page }) => {
        if (isMocked) {
            await expect(page.locator('text=OrderFlow')).toBeVisible()
        } else {
            await expect(page.locator('fc-queue-list')).toBeVisible()
        }
    })
})

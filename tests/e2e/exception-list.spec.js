import { test, expect } from '@playwright/test'
import { isMocked, loginReal, mockAuthenticatedApp, tab } from './helpers.js'

test.describe('Exception-Liste', () => {
    test.beforeEach(async ({ page }) => {
        if (isMocked) {
            await mockAuthenticatedApp(page)
            await page.goto('/')
        } else {
            await loginReal(page)
        }
        await tab(page, 'Exceptions').click()
        await expect(page.locator('fc-exception-list')).toBeVisible()
    })

    test('zeigt Exception-Einträge', async ({ page }) => {
        if (isMocked) {
            await expect(page.locator('text=Payment gateway timeout')).toBeVisible()
            await expect(page.locator('text=SMTP connection refused')).toBeVisible()
        } else {
            await expect(page.locator('fc-exception-list')).toBeVisible()
        }
    })

    test('zeigt Exception-Status-Badge', async ({ page }) => {
        if (isMocked) {
            await expect(page.locator('.badge-error').first()).toBeVisible()
        } else {
            await expect(page.locator('fc-exception-list')).toBeVisible()
        }
    })
})

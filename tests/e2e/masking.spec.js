import { test, expect } from '@playwright/test'
import { isMocked, loginReal, mockAuthenticatedApp, tab } from './helpers.js'
import { masking } from '../../src/services/masking.js'

const flowDetailWithPII = {
    flowHash: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    flowSource: 'App\\Flow\\OrderFlow',
    flowType: 'App\\Flow\\OrderFlow',
    flowRuntimeHash: 'rt-001',
    status: 'OK',
    createdAt: '2026-05-14T10:00:00+00:00',
    updatedAt: '2026-05-14T10:01:00+00:00',
    isReadOnly: false,
    isExecutable: true,
    flowSchema: {
        steps: [
            {
                source: 'App\\Step\\ValidateOrder',
                messages: ['App\\Message\\OrderMessage'],
                returnTypes: [],
            },
        ],
    },
    flowRuns: [
        {
            flowRuntimeHash: 'rt-001',
            time: '2026-05-14T10:00:00+00:00',
        },
    ],
    flowMessages: [
        {
            flowHash: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            flowRuntimeHash: 'rt-001',
            stepHash: 's1',
            stepSource: 'App\\Step\\ValidateOrder',
            messageSource: 'App\\Message\\OrderMessage',
            messageType: 'process',
            message: {
                orderId: 42,
                email: 'max@example.com',
                vorname: 'Max',
                password: 'geheim123',
                address: 'Musterstr. 1',
            },
            time: '2026-05-14T10:00:10+00:00',
        },
    ],
    flowExceptions: [],
    flowResults: [],
}

const flowListWithUUID = {
    total: 1,
    items: [
        {
            flowHash: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            flowSource: 'App\\Flow\\OrderFlow',
            flowRuntimeHash: 'rt-001',
            status: 'OK',
            createdAt: '2026-05-14T10:00:00+00:00',
            updatedAt: '2026-05-14T10:01:00+00:00',
        },
    ],
}

test.describe('Datenschutz-Maskierung', () => {
    test.beforeEach(async ({ page }) => {
        if (isMocked) {
            await mockAuthenticatedApp(page, {
                flowDetail: flowDetailWithPII,
                flowList: flowListWithUUID,
                maskingRules: masking.DEFAULT_RULES,
            })
            await page.goto('/')
        } else {
            await loginReal(page)
        }
    })

    test('Masking-Settings-Modal öffnet und zeigt Standard-Regeln', async ({ page }) => {
        if (!isMocked) return

        const maskingBtn = page.locator('fc-tooltip[text="Datenschutz-Maskierung"] button')
        await expect(maskingBtn).toBeVisible()
        await maskingBtn.click()

        const modal = page.locator('#masking-modal')
        await expect(modal).toBeVisible()
        await expect(modal.locator('text=Standard-Regeln')).toBeVisible()

        await expect(page.locator('fc-masking-settings .badge', { hasText: 'password' })).toBeVisible()
        await expect(page.locator('fc-masking-settings .badge', { hasText: 'email' })).toBeVisible()
        await expect(page.locator('fc-masking-settings .badge', { hasText: 'vorname' })).toBeVisible()
    })

    test('Masking-Settings erlaubt neue Regel hinzuzufügen', async ({ page }) => {
        if (!isMocked) return

        await page.locator('fc-tooltip[text="Datenschutz-Maskierung"] button').click()
        await expect(page.locator('#masking-modal')).toBeVisible()

        const input = page.locator('fc-masking-settings input[type="text"]')
        await input.fill('steuernummer')
        await page.locator('fc-masking-settings button', { hasText: 'Hinzufügen' }).click()

        await expect(page.locator('text=Eigene Regeln')).toBeVisible()
        await expect(page.locator('fc-masking-settings .badge', { hasText: 'steuernummer' })).toBeVisible()
    })

    test('Message-Block zeigt maskierte Daten und Toggle deckt auf', async ({ page }) => {
        if (!isMocked) return

        await tab(page, 'Flows').click()
        await expect(page.locator('fc-type-list')).toBeVisible()
        await page.locator('fc-type-list .rounded-box', { hasText: 'OrderFlow' }).click()
        await expect(page.locator('fc-flow-list')).toBeVisible()
        await page.locator('fc-flow-list .rounded-box').first().click()
        await expect(page.locator('fc-flow-detail')).toBeVisible({ timeout: 10_000 })

        await page.locator('.fc-node').first().click()

        const messageBlock = page.locator('.rounded-lg.bg-base-300').first()
        await expect(messageBlock).toBeVisible()

        const preContent = messageBlock.locator('pre')
        await expect(preContent).toBeVisible()
        await expect(preContent).toContainText('"orderId": 42')
        await expect(preContent).toContainText('"email": "***"')
        await expect(preContent).toContainText('"vorname": "***"')
        await expect(preContent).toContainText('"password": "***"')

        const revealBtn = messageBlock.locator('button[title="Sensible Daten anzeigen"]')
        await revealBtn.click()

        await expect(preContent).toContainText('"email": "max@example.com"')
        await expect(preContent).toContainText('"vorname": "Max"')
        await expect(preContent).toContainText('"password": "geheim123"')

        const maskBtn = messageBlock.locator('button[title="Sensible Daten maskieren"]')
        await maskBtn.click()

        await expect(preContent).toContainText('"email": "***"')
    })

    test('Default-Regeln greifen wenn Server keine Regeln gespeichert hat', async ({ page }) => {
        if (!isMocked) return

        await page.route('**/api/masking-rules', route => route.fulfill({ json: [] }))

        await tab(page, 'Flows').click()
        await expect(page.locator('fc-type-list')).toBeVisible()
        await page.locator('fc-type-list .rounded-box', { hasText: 'OrderFlow' }).click()
        await expect(page.locator('fc-flow-list')).toBeVisible()
        await page.locator('fc-flow-list .rounded-box').first().click()
        await expect(page.locator('fc-flow-detail')).toBeVisible({ timeout: 10_000 })

        await page.locator('.fc-node').first().click()

        const messageBlock = page.locator('.rounded-lg.bg-base-300').first()
        await expect(messageBlock).toBeVisible()

        const preContent = messageBlock.locator('pre')
        await expect(preContent).toBeVisible()
        await expect(preContent).toContainText('"email": "***"')
        await expect(preContent).toContainText('"password": "***"')
    })

    test('Copy-Button kopiert maskierte Daten im maskierten Zustand', async ({ page, context }) => {
        if (!isMocked) return

        await context.grantPermissions(['clipboard-read', 'clipboard-write'])

        await tab(page, 'Flows').click()
        await expect(page.locator('fc-type-list')).toBeVisible()
        await page.locator('fc-type-list .rounded-box', { hasText: 'OrderFlow' }).click()
        await expect(page.locator('fc-flow-list')).toBeVisible()
        await page.locator('fc-flow-list .rounded-box').first().click()
        await expect(page.locator('fc-flow-detail')).toBeVisible({ timeout: 10_000 })
        await page.locator('.fc-node').first().click()

        const messageBlock = page.locator('.rounded-lg.bg-base-300').first()
        await expect(messageBlock).toBeVisible()

        const copyBtn = messageBlock.locator('button[title="Inhalt kopieren"]')
        await copyBtn.click()

        const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
        expect(clipboardText).toContain('"email": "***"')
        expect(clipboardText).toContain('"password": "***"')
        expect(clipboardText).not.toContain('max@example.com')
    })
})

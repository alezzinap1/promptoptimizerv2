import { test, expect } from '@playwright/test'

test.describe('smoke', () => {
  test('login page renders form', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByPlaceholder(/username|логин|имя|user/i)).toBeVisible()
    await expect(page.getByPlaceholder(/password|пароль/i)).toBeVisible()
  })

  test('welcome marketing page loads', async ({ page }) => {
    await page.goto('/welcome')
    await expect(page.locator('body')).toBeVisible()
    await expect(page).toHaveURL(/\/welcome/)
  })

  test('library route shows auth gate or hub', async ({ page }) => {
    await page.goto('/library')
    const main = page.locator('#main-content')
    const gate = main.getByRole('heading', { name: /требуется вход|sign-in required/i })
    const hub = main.getByRole('heading', { name: /библиотека|library/i })
    await expect(gate.or(hub)).toBeVisible({ timeout: 20_000 })
  })

  test('home studio via demo mode', async ({ page }) => {
    await page.goto('/home')
    const demoBtn = page.getByRole('button', { name: /без регистрации|try without|demo/i })
    await expect(demoBtn).toBeVisible({ timeout: 10_000 })
    await demoBtn.click()
    await page.waitForURL(/\/home/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: /задача|task/i })).toBeVisible({ timeout: 25_000 })
  })
})

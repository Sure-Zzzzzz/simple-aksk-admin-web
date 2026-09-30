import { expect, test } from '@playwright/test';

test('API 权限不足时各视图呈现安全错误态', async ({ page }) => {
  await page.route(/\/api\//, route => route.fulfill({ status: 403, body: '' }));

  await page.goto('/app/aksk/clients');
  await expect(page.locator('.admin-message.error')).toContainText('查询客户端列表失败');
  await expect(page.locator('.admin-message.error')).toContainText('没有执行该操作的权限');

  await page.goto('/app/aksk/tokens');
  await expect(page.locator('.admin-message.error').first()).toContainText('查询令牌列表失败');
  await expect(page.locator('.metric-cards')).toHaveCount(0);

  await page.goto('/app/aksk/authorizations');
  await expect(page.locator('.admin-message.error')).toContainText('查询应用授权列表失败');

  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toContain('localhost');
  expect(bodyText).not.toContain('Bearer');
});

import { expect, test } from '@playwright/test';

const clientDetail = {
  clientId: 'AKP0001',
  clientSecret: null,
  clientName: '示例平台客户端',
  clientType: 1,
  ownerUserId: null,
  ownerUsername: null,
  scopes: ['read'],
  enabled: true,
  clientIdIssuedAt: '2026-09-01T08:00:00Z'
};

test('客户端详情渲染字段并可单字段更新名称', async ({ page }) => {
  const patches: string[] = [];
  await page.route(/\/api\/client\/AKP0001$/, route => {
    if (route.request().method() === 'PATCH') {
      patches.push(route.request().postData() ?? '');
      return route.fulfill({ json: { message: '' } });
    }
    return route.fulfill({ json: clientDetail });
  });

  await page.goto('/app/aksk/clients/AKP0001');

  await expect(page.locator('.detail-grid')).toContainText('AKP0001');
  await expect(page.locator('.detail-grid')).toContainText('示例平台客户端');
  await expect(page.locator('.detail-grid')).toContainText('AKP 平台级');

  await page.getByPlaceholder('客户端名称').fill('改名后的客户端');
  await page.getByRole('button', { name: '更新名称' }).click();
  await expect(page.locator('.admin-message.success')).toContainText('名称已更新');
  expect(JSON.parse(patches[0])).toEqual({ name: '改名后的客户端' });
});

test('重置密钥默认吊销令牌并一次性回显新密钥', async ({ page }) => {
  const resetUrls: string[] = [];
  await page.route(/\/api\/client\/AKP0001$/, route => route.fulfill({ json: clientDetail }));
  await page.route(/\/api\/client\/AKP0001\/secret/, route => {
    resetUrls.push(route.request().url());
    return route.fulfill({ json: { clientId: 'AKP0001', clientSecret: 'SK-rotated' } });
  });

  await page.goto('/app/aksk/clients/AKP0001');

  const revokeCheckbox = page.locator('.detail-maintenance input[type="checkbox"]').first();
  await expect(revokeCheckbox).toBeChecked();
  await page.getByRole('button', { name: '重置 SecretKey' }).click();

  await expect(page.locator('.secret-reveal')).toContainText('SK-rotated');
  await expect(page.locator('.secret-reveal')).toContainText('仅此一次');
  expect(resetUrls[0]).toContain('/api/client/AKP0001/secret?revokeTokens=true');
});

test('删除客户端需确认且文案如实呈现令牌级联后果', async ({ page }) => {
  const deletions: string[] = [];
  await page.route(/\/api\/client\?/, route => route.fulfill({ json: { data: [], total: 0, page: 1, size: 20, totalPages: 0 } }));
  await page.route(/\/api\/client\/AKP0001$/, route => {
    if (route.request().method() === 'DELETE') {
      deletions.push(route.request().url());
      return route.fulfill({ status: 200, body: '' });
    }
    return route.fulfill({ json: clientDetail });
  });

  await page.goto('/app/aksk/clients/AKP0001');

  await page.getByRole('button', { name: '删除客户端' }).click();
  const dialog = page.locator('.confirm-dialog');
  await expect(dialog).toContainText('该客户端下所有令牌将被撤销');
  await dialog.getByRole('button', { name: '确认删除' }).click();

  await expect(page).toHaveURL(/\/app\/aksk\/clients$/);
  expect(deletions).toHaveLength(1);
});

import { expect, test } from '@playwright/test';

const statistics = {
  totalCount: 12, activeCount: 7, revokedCount: 3, expiredCount: 2,
  mysqlCount: 12, redisCount: 4, bothCount: 4
};

const tokenRow = {
  id: 'tok-0001',
  registeredClientId: 'reg-1',
  clientId: 'AKP0001',
  clientName: '示例平台客户端',
  clientType: 1,
  issuedAt: '2026-09-01T08:00:00Z',
  expiresAt: '2026-09-08T08:00:00Z',
  scopes: ['read'],
  status: 'ACTIVE',
  dataSource: 'MYSQL',
  ownerUserId: null,
  ownerUsername: null
};

const redisRow = { ...tokenRow, id: 'tok-redis-1', dataSource: 'REDIS' };

function tokensPage(data: unknown[] = [tokenRow], total = 1) {
  return { data, total, page: 1, size: 10, totalPages: 1 };
}

test('令牌页渲染统计卡与列表并完成撤销', async ({ page }) => {
  const revocations: string[] = [];
  await page.route(/\/api\/token\/statistics$/, route => route.fulfill({ json: statistics }));
  await page.route(/\/api\/token\/tok-0001\/revoke$/, route => {
    revocations.push(route.request().url());
    return route.fulfill({ status: 200, body: '' });
  });
  await page.route(/\/api\/token\?/, route => route.fulfill({ json: tokensPage() }));

  await page.goto('/app/aksk/tokens');

  await expect(page.locator('.metric-cards')).toContainText('令牌总数');
  await expect(page.locator('.metric-cards')).toContainText('7');
  await expect(page.locator('tbody')).toContainText('tok-0001');
  await expect(page.locator('tbody')).toContainText('有效');

  await page.locator('tbody').getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('.admin-message.success')).toContainText('令牌已撤销');
  expect(revocations).toHaveLength(1);
});

test('切换 Redis 源走 redis 端点', async ({ page }) => {
  const redisUrls: string[] = [];
  await page.route(/\/api\/token\/statistics$/, route => route.fulfill({ json: statistics }));
  await page.route(/\/api\/token\/redis/, route => {
    redisUrls.push(route.request().url());
    return route.fulfill({ json: tokensPage([redisRow]) });
  });
  await page.route(/\/api\/token\?/, route => route.fulfill({ json: tokensPage() }));

  await page.goto('/app/aksk/tokens');
  await page.getByRole('button', { name: /Redis 源/ }).click();

  await expect(page.locator('tbody')).toContainText('tok-redis-1');
  await expect(page.locator('tbody')).toContainText('REDIS');
  expect(redisUrls[0]).toContain('/api/token/redis?page=1&size=10');
});

test('按客户端筛选批量撤销需确认并展示撤销数', async ({ page }) => {
  await page.route(/\/api\/token\/statistics$/, route => route.fulfill({ json: statistics }));
  await page.route(/\/api\/token\?/, route => route.fulfill({ json: tokensPage() }));
  await page.route(/\/api\/token\?clientId=AKP0001$/, route => route.fulfill({ json: { revokedCount: 2 } }));

  await page.goto('/app/aksk/tokens');
  await page.getByPlaceholder('按客户端 ID 筛选').fill('AKP0001');
  await page.getByRole('button', { name: '查询' }).click();

  await page.getByRole('button', { name: '撤销该客户端全部令牌' }).click();
  const dialog = page.locator('.confirm-dialog');
  await expect(dialog).toContainText('AKP0001');
  await dialog.getByRole('button', { name: '确认撤销' }).click();

  await expect(page.locator('.admin-message.success')).toContainText('已撤销客户端 AKP0001 名下 2 个令牌');
});

import { expect, test } from '@playwright/test';

const clientRow = {
  clientId: 'AKP0001',
  clientSecret: null,
  clientName: '示例平台客户端',
  clientType: 1,
  ownerUserId: null,
  ownerUsername: null,
  scopes: ['read', 'write'],
  enabled: true,
  clientIdIssuedAt: '2026-09-01T08:00:00Z'
};

const userRow = {
  ...clientRow,
  clientId: 'AKU0002',
  clientName: '用户级客户端',
  clientType: 2,
  ownerUserId: 'sid-u7',
  ownerUsername: 'u7'
};

function clientsPage(data: unknown[] = [clientRow, userRow], total = 2) {
  return { data, total, page: 1, size: 20, totalPages: 1 };
}

const LIST_URL = /\/api\/client\?/;
const ROOT_URL = /\/api\/client(\?|$)/;

async function mockClientsApi(page, handlers: Record<string, (route) => void> = {}) {
  await page.route(ROOT_URL, route => {
    if (route.request().method() === 'POST') {
      if (handlers.create) {
        return handlers.create(route);
      }
      return route.fulfill({ json: { clientId: 'AKP0100', clientSecret: 'SK-created', type: 'platform', name: '新建客户端' } });
    }
    return route.fulfill({ json: clientsPage() });
  });
  await page.route(LIST_URL, route => {
    if (handlers.list) {
      return handlers.list(route);
    }
    return route.fulfill({ json: clientsPage() });
  });
}

test('客户端列表渲染类型徽标与归属', async ({ page }) => {
  await mockClientsApi(page);

  await page.goto('/app/aksk/clients');

  await expect(page.locator('tbody')).toContainText('示例平台客户端');
  await expect(page.locator('tbody')).toContainText('AKP 平台级');
  await expect(page.locator('tbody')).toContainText('AKU 用户级');
  await expect(page.locator('tbody')).toContainText('u7');
});

test('新建客户端只允许平台级并进入密钥一次性回显', async ({ page }) => {
  const created: string[] = [];
  await mockClientsApi(page, {
    create: route => {
      created.push(route.request().postData() ?? '');
      return route.fulfill({ json: { clientId: 'AKP0100', clientSecret: 'SK-created', type: 'platform', name: '新建客户端' } });
    }
  });
  await page.route(/\/api\/client\/AKP0100$/, route => route.fulfill({ json: { ...clientRow, clientId: 'AKP0100', clientName: '新建客户端' } }));

  await page.goto('/app/aksk/clients');
  await page.getByRole('button', { name: '新建客户端' }).first().click();

  // 类型固定平台级（禁用单选项）；用户级 AKU 指向门户自助创建，页面不出现归属字段
  const typeSelect = page.getByRole('button', { name: '客户端类型' });
  await expect(typeSelect).toBeDisabled();
  await expect(typeSelect).toHaveText('平台级 AKP（业务系统持有）');
  await expect(page.locator('.drawer-hint-block')).toContainText('我的 AKSK 访问凭证');
  await expect(page.getByPlaceholder('IAM 稳定主体 ID')).toHaveCount(0);

  await page.getByPlaceholder('客户端名称').fill('新建客户端');
  await page.getByRole('button', { name: '正在创建…' }).or(page.getByRole('button', { name: '创建客户端' })).click();

  await expect(page.locator('.admin-empty-state')).toContainText('AK：AKP0100');
  await expect(page.locator('.admin-empty-state')).toContainText('SK：SK-created');
  await expect(page.locator('.admin-empty-state')).toContainText('仅此一次');
  expect(created).toHaveLength(1);
  expect(JSON.parse(created[0])).toEqual({
    type: 'platform',
    name: '新建客户端'
  });

  await page.getByRole('button', { name: '我已妥善保存，查看客户端' }).click();
  await expect(page).toHaveURL(/\/app\/aksk\/clients\/AKP0100$/);
});

test('按归属筛选不暴露 scopes 批量修改入口', async ({ page }) => {
  const urls: string[] = [];
  await mockClientsApi(page, {
    list: route => {
      urls.push(route.request().url());
      return route.fulfill({ json: clientsPage() });
    }
  });
  await page.goto('/app/aksk/clients');
  await page.getByPlaceholder('按归属主体 ID 筛选').fill('sid-u7');
  await page.getByRole('button', { name: '查询' }).click();

  await expect(page.locator('.sync-form')).toHaveCount(0);
  await expect(page.getByText('同步 scopes')).toHaveCount(0);
  expect(urls.some(url => url.includes('ownerUserId=sid-u7'))).toBe(true);
});

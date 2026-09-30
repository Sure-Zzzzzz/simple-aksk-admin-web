import { expect, test } from '@playwright/test';

const authorizationDetail = {
  clientId: 'AKP0001',
  clientType: 1,
  ownerUserId: null,
  applicationCode: 'aksk',
  admitted: true,
  enabled: true,
  roles: ['app-admin'],
  pagePermissions: ['page:home'],
  apiPermissions: ['akskClient:read'],
  dataGrantDocument: {
    protocol: 'p1',
    version: '1',
    grants: [{ resource: 'kms:key', actions: ['read'], all: false, constraints: [{ dimension: 'department', operator: 'IN', values: ['D01'] }] }]
  },
  authorizationVersion: 2,
  manifestVersion: 'v1',
  manifestDigest: 'digest-1',
  createdAt: '',
  updatedAt: '',
  revokedAt: null
};

function authorizationPage() {
  return { data: [authorizationDetail], total: 1, page: 1, size: 20, totalPages: 1 };
}

test('应用授权列表渲染并可进入编辑器', async ({ page }) => {
  await page.route(/\/api\/application-authorization\?/, route => route.fulfill({ json: authorizationPage() }));
  await page.route(/\/api\/application-authorization\/AKP0001$/, route => route.fulfill({ json: authorizationDetail }));

  await page.goto('/app/aksk/authorizations');
  await expect(page.locator('tbody')).toContainText('AKP0001');
  await expect(page.locator('tbody')).toContainText('已准入');
  await expect(page.locator('tbody')).toContainText('v2');

  await page.locator('tbody').getByRole('button', { name: '编辑' }).click();
  await expect(page).toHaveURL(/\/app\/aksk\/authorizations\/AKP0001$/);
  await expect(page.locator('.drawer-status-line')).toContainText('生效中');
});

test('编辑器支持新建→替换→并发冲突→撤销全链', async ({ page }) => {
  let exists = false;
  let conflictOnce = true;
  const puts: string[] = [];
  await page.route(/\/api\/application-authorization\/AKU0009$/, route => {
    if (route.request().method() === 'GET') {
      return exists
        ? route.fulfill({ json: { ...authorizationDetail, clientId: 'AKU0009' } })
        : route.fulfill({ status: 404, body: '' });
    }
    if (conflictOnce) {
      conflictOnce = false;
      return route.fulfill({ status: 409, body: '' });
    }
    puts.push(route.request().postData() ?? '');
    exists = true;
    return route.fulfill({ json: { ...authorizationDetail, clientId: 'AKU0009', authorizationVersion: 3 } });
  });
  await page.route(/\/api\/application-authorization\?clientId=AKU0009$/, route => {
    exists = true;
    return route.fulfill({ status: 201, json: { ...authorizationDetail, clientId: 'AKU0009' } });
  });
  await page.route(/\/api\/application-authorization\/AKU0009\/revoke$/, route => {
    return route.fulfill({ status: 204, body: '' });
  });

  await page.goto('/app/aksk/authorizations/AKU0009');
  await expect(page.getByText('该客户端尚未配置授权')).toBeVisible();

  await page.getByPlaceholder('如 aksk').fill('aksk');
  await page.getByPlaceholder('如 v1').fill('v1');
  await page.getByPlaceholder('来自应用权限清单登记').fill('digest-1');
  await page.getByRole('button', { name: '创建授权' }).click();
  await expect(page.locator('.admin-message.success')).toContainText('应用授权已创建');

  await page.getByRole('button', { name: '保存（整单替换）' }).click();
  const dialog = page.locator('.confirm-dialog');
  await expect(dialog).toContainText('并发修改');
  await dialog.getByRole('button', { name: '重拉并重新编辑' }).click();
  await expect(page.getByPlaceholder('资源（如 kms:key）')).toHaveValue('kms:key');

  await page.getByRole('button', { name: '保存（整单替换）' }).click();
  await expect(page.locator('.admin-message.success')).toContainText('应用授权已保存');
  expect(JSON.parse(puts[0]).dataGrantDocument.grants[0].constraints[0].operator).toBe('IN');

  await page.getByRole('button', { name: '撤销授权' }).click();
  const revokeDialog = page.locator('.confirm-dialog');
  await expect(revokeDialog).toContainText('一并失效');
  await revokeDialog.getByRole('button', { name: '确认撤销' }).click();
  await expect(page.locator('.admin-message.success')).toContainText('应用授权已撤销');
});

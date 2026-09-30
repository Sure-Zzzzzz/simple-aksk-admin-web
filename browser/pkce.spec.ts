import { expect, test } from '@playwright/test';

test('PKCE 回调全链：交换令牌、清理 URL、恢复目标路由并携带 Bearer', async ({ page }) => {
  const tokenRequests: string[] = [];
  const apiAuthHeaders: string[] = [];

  await page.route('**/oauth2/token', route => {
    tokenRequests.push(route.request().postData() ?? '');
    return route.fulfill({ json: { access_token: 'e2e-access-token', expires_in: 1800 } });
  });
  await page.route(/\/api\/client\?/, route => {
    apiAuthHeaders.push(route.request().headers()['authorization'] ?? '');
    return route.fulfill({ json: { data: [], total: 0, page: 1, size: 20, totalPages: 0 } });
  });

  await page.addInitScript(() => {
    sessionStorage.setItem('aksk.pkce.state-e2e', JSON.stringify({ verifier: 'e2e-verifier', target: '/clients' }));
  });

  await page.goto('/app/aksk/oauth-callback?code=e2e-code&state=state-e2e');

  await expect(page.locator('tbody')).toContainText('暂无符合条件的客户端');
  await expect(page).toHaveURL(/\/app\/aksk\/clients$/);
  await expect(page).not.toHaveURL(/code=/);

  expect(tokenRequests).toHaveLength(1);
  const form = new URLSearchParams(tokenRequests[0]);
  expect(form.get('grant_type')).toBe('authorization_code');
  expect(form.get('code')).toBe('e2e-code');
  expect(form.get('code_verifier')).toBe('e2e-verifier');
  expect(form.get('client_id')).toBe('e2e-aksk-admin');
  expect(form.get('redirect_uri')).toContain('/app/aksk/oauth-callback');

  expect(apiAuthHeaders.length).toBeGreaterThan(0);
  expect(apiAuthHeaders.every(header => header === 'Bearer e2e-access-token')).toBe(true);

  const storedToken = await page.evaluate(() => sessionStorage.getItem('aksk.accessToken'));
  expect(storedToken).toBe('e2e-access-token');
});

test('state 无法匹配时不静默放行', async ({ page }) => {
  await page.route('**/oauth2/token', route => route.fulfill({ json: { access_token: 'should-not-matter', expires_in: 1800 } }));

  await page.addInitScript(() => {
    sessionStorage.setItem('aksk.pkce.retry', '1');
  });

  await page.goto('/app/aksk/oauth-callback?code=e2e-code&state=never-seen');

  await expect(page.locator('.admin-message.error')).toContainText('授权码交换失败，请重新从统一应用门户进入');
  const storedToken = await page.evaluate(() => sessionStorage.getItem('aksk.accessToken'));
  expect(storedToken).toBeNull();
});

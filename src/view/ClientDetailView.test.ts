import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createWebHistory } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClientDetailView from './ClientDetailView.vue';

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

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body))
  };
}

function emptyResponse(status: number) {
  return { ok: false, status, json: async () => ({}), text: async () => '' };
}

function fetchStub(handlers: Record<string, unknown> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const mock = vi.fn().mockImplementation((url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const method = (init.method ?? 'GET').toUpperCase();
    const value = handlers[`${method} ${url}`];
    if (value === undefined) {
      return Promise.reject(new Error(`unexpected request: ${method} ${url}`));
    }
    return Promise.resolve(typeof value === 'function' ? value(url, init) : jsonResponse(value));
  });
  return { mock, calls };
}

function seedToken() {
  window.sessionStorage.setItem('aksk.accessToken', 'token-1');
  window.sessionStorage.setItem('aksk.accessTokenExpiresAt', String(Date.now() + 3600_000));
}

async function mountView(router?: Awaited<ReturnType<typeof createRouter>>, clientId = 'AKP0001') {
  const instance = router ?? createRouter({
    history: createWebHistory(),
    routes: [{ path: '/clients/:clientId', component: ClientDetailView }, { path: '/clients', component: { template: '<div>clients-list</div>' } }]
  });
  await instance.push(`/clients/${clientId}`);
  const wrapper = mount(ClientDetailView, { attachTo: document.body, global: { plugins: [instance] } });
  await flushPromises();
  return wrapper;
}

describe('ClientDetailView', () => {
  beforeEach(() => seedToken());

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('渲染详情字段', async () => {
    const { mock } = fetchStub({ 'GET /api/client/AKP0001': clientDetail });
    vi.stubGlobal('fetch', mock);
    const wrapper = await mountView();
    expect(wrapper.text()).toContain('AKP0001');
    expect(wrapper.text()).toContain('示例平台客户端');
    expect(wrapper.text()).toContain('AKP 平台级');
    wrapper.unmount();
  });

  it('404 呈现不存在空态', async () => {
    const { mock } = fetchStub({ 'GET /api/client/AKP404': () => emptyResponse(404) });
    vi.stubGlobal('fetch', mock);
    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: '/clients/:clientId', component: ClientDetailView }, { path: '/clients', component: { template: '<div />' } }]
    });
    await router.push('/clients/AKP404');
    const wrapper = mount(ClientDetailView, { attachTo: document.body, global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.text()).toContain('客户端不存在');
    wrapper.unmount();
  });

  it('重置密钥默认勾选吊销令牌并一次性回显新密钥', async () => {
    const { mock, calls } = fetchStub({
      'GET /api/client/AKP0001': clientDetail,
      'PUT /api/client/AKP0001/secret?revokeTokens=true': { clientId: 'AKP0001', clientSecret: 'SK-new' }
    });
    vi.stubGlobal('fetch', mock);
    const wrapper = await mountView();

    const resetForm = wrapper.findAll('form').find(form => form.text().includes('重置 SecretKey'));
    expect(resetForm).toBeTruthy();
    expect(resetForm!.find('input[type="checkbox"]').element as HTMLInputElement).toBeTruthy();
    expect((resetForm!.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true);

    await resetForm!.find('button[type="submit"]').trigger('submit');
    await flushPromises();

    expect(calls.some(call => call.url === '/api/client/AKP0001/secret?revokeTokens=true')).toBe(true);
    expect(wrapper.text()).toContain('SK-new');
    expect(wrapper.text()).toContain('仅此一次');
    wrapper.unmount();
  });

  it('用户级凭证允许提交不透明的稳定主体 ID', async () => {
    const userClient = {
      ...clientDetail,
      clientId: 'AKU0001',
      clientType: 2,
      ownerUserId: 'sid-existing',
      ownerUsername: 'alice'
    };
    const { mock, calls } = fetchStub({
      'GET /api/client/AKU0001': userClient,
      'PATCH /api/client/AKU0001': { message: '' }
    });
    vi.stubGlobal('fetch', mock);
    const wrapper = await mountView(undefined, 'AKU0001');

    await wrapper.get('input[placeholder="IAM 稳定主体 ID"]').setValue('sid-alice-v1');
    await wrapper.get('input[placeholder="IAM 用户名"]').setValue('alice');
    await wrapper.findAll('form').find(form => form.text().includes('更新归属'))!.trigger('submit');
    await flushPromises();

    const request = calls.find(call => call.url === '/api/client/AKU0001' && call.init.method === 'PATCH');
    expect(request).toBeTruthy();
    expect(JSON.parse(String(request!.init.body))).toEqual({ ownerUserId: 'sid-alice-v1', ownerUsername: 'alice' });
    expect(wrapper.text()).toContain('归属已更新');
    wrapper.unmount();
  });

  it('删除确认文案含令牌级联后果，确认后回列表', async () => {
    const { mock, calls } = fetchStub({
      'GET /api/client/AKP0001': clientDetail,
      'DELETE /api/client/AKP0001': () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' })
    });
    vi.stubGlobal('fetch', mock);
    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: '/clients/:clientId', component: ClientDetailView }, { path: '/clients', component: { template: '<div>clients-list</div>' } }]
    });
    await router.push('/clients/AKP0001');
    const wrapper = mount(ClientDetailView, { attachTo: document.body, global: { plugins: [router] } });
    await flushPromises();

    await wrapper.findAll('button').find(button => button.text() === '删除客户端')!.trigger('click');
    await flushPromises();
    const dialog = document.body.querySelector('.confirm-dialog')!;
    expect(dialog.textContent).toContain('该客户端下所有令牌将被撤销');

    await wrapper.findAll('button').find(button => button.text() === '确认删除')!.trigger('click');
    await flushPromises();
    expect(calls.some(call => call.url === '/api/client/AKP0001' && call.init.method === 'DELETE')).toBe(true);
    expect(router.currentRoute.value.path).toBe('/clients');
    wrapper.unmount();
  });
});

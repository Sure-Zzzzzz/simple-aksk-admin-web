import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createWebHistory } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TokensView from './TokensView.vue';
import { pickFormSelectOption } from './formSelectDriver';

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

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body))
  };
}

function tokensPage(data = [tokenRow], total = 1) {
  return { data, total, page: 1, size: 10, totalPages: 1 };
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
  window.sessionStorage.setItem('aksk.accessTokenExpiresAt', String(Date.now() + 3600000));
}

async function mountView() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/tokens', component: TokensView },
      { path: '/clients/:clientId', component: { template: '<div />' } }
    ]
  });
  await router.push('/tokens');
  const wrapper = mount(TokensView, { attachTo: document.body, global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe('TokensView', () => {
  beforeEach(() => seedToken());

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('渲染统计卡与列表，撤销走 POST', async () => {
    const { mock, calls } = fetchStub({
      'GET /api/token/statistics': statistics,
      'GET /api/token?page=1&size=10': tokensPage(),
      'GET /api/token?status=ACTIVE&page=1&size=10': tokensPage(),
      'POST /api/token/tok-0001/revoke': () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' })
    });
    vi.stubGlobal('fetch', mock);
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('令牌总数');
    expect(wrapper.text()).toContain('7');
    expect(wrapper.text()).toContain('tok-0001');
    expect(wrapper.text()).toContain('有效');
    expect(wrapper.text()).toContain('MYSQL');

    await wrapper.findAll('button').find(button => button.text() === '撤销')!.trigger('click');
    await flushPromises();
    expect(calls.some(call => call.url === '/api/token/tok-0001/revoke' && call.init.method === 'POST')).toBe(true);
    expect(wrapper.text()).toContain('令牌已撤销');
    wrapper.unmount();
  });

  it('切换 Redis 源走 redis 端点且仅带状态筛选', async () => {
    const { mock, calls } = fetchStub({
      'GET /api/token/statistics': statistics,
      'GET /api/token?page=1&size=10': tokensPage(),
      'GET /api/token/redis?page=1&size=10': tokensPage(),
      'GET /api/token/redis?status=REVOKED&page=1&size=10': tokensPage()
    });
    vi.stubGlobal('fetch', mock);
    const wrapper = await mountView();

    const redisTab = wrapper.findAll('.type-filter-tabs button').find(button => button.text().includes('Redis'));
    await redisTab!.trigger('click');
    await flushPromises();
    expect(calls.some(call => call.url === '/api/token/redis?page=1&size=10')).toBe(true);

    await pickFormSelectOption(wrapper, { ariaLabel: '状态' }, '已撤销');
    await flushPromises();
    expect(calls.some(call => call.url === '/api/token/redis?status=REVOKED&page=1&size=10')).toBe(true);
    wrapper.unmount();
  });

  it('按客户端筛选时提供批量撤销并带确认', async () => {
    const { mock, calls } = fetchStub({
      'GET /api/token/statistics': statistics,
      'GET /api/token?page=1&size=10': tokensPage(),
      'GET /api/token?clientId=AKP0001&page=1&size=10': tokensPage(),
      'DELETE /api/token?clientId=AKP0001': { revokedCount: 2 }
    });
    vi.stubGlobal('fetch', mock);
    const wrapper = await mountView();

    await wrapper.get('#token-client-filter').setValue('AKP0001');
    await wrapper.get('#token-client-filter').trigger('keyup.enter');
    await flushPromises();

    await wrapper.findAll('button').find(button => button.text() === '撤销该客户端全部令牌')!.trigger('click');
    await flushPromises();
    const dialog = document.body.querySelector('.confirm-dialog')!;
    expect(dialog.textContent).toContain('AKP0001');

    await wrapper.findAll('button').find(button => button.text() === '确认撤销')!.trigger('click');
    await flushPromises();
    expect(calls.some(call => call.url === '/api/token?clientId=AKP0001' && call.init.method === 'DELETE')).toBe(true);
    expect(wrapper.text()).toContain('已撤销客户端 AKP0001 名下 2 个令牌');
    wrapper.unmount();
  });
});

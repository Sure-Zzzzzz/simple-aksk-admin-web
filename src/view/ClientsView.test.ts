import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createWebHistory } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClientsView from './ClientsView.vue';
import type { AkskClientInfo } from '../api/akskAuth';

const clientRow: AkskClientInfo = {
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

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body))
  };
}

function clientsPage(data = [clientRow], total = 1) {
  return { data, total, page: 1, size: 20, totalPages: 1 };
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

async function mountView() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/clients', component: ClientsView },
      { path: '/clients/create', component: { template: '<div />' } },
      { path: '/authorizations/:clientId', component: { template: '<div />' } }
    ]
  });
  await router.push('/clients');
  const wrapper = mount(ClientsView, { attachTo: document.body, global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe('ClientsView', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    seedToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('渲染分页数据与类型徽标', async () => {
    const { mock } = fetchStub({ 'GET /api/client?page=1&size=20': clientsPage() });
    vi.stubGlobal('fetch', mock);
    const wrapper = await mountView();
    expect(wrapper.text()).toContain('示例平台客户端');
    expect(wrapper.text()).toContain('AKP0001');
    expect(wrapper.text()).toContain('AKP 平台级');
    expect(wrapper.text()).not.toContain('read, write');
    wrapper.unmount();
  });

  it('AKU 缺少用户名快照时仍显示归属主体 ID', async () => {
    const userClient = { ...clientRow, clientId: 'AKU0001', clientType: 2, ownerUserId: 'sid-alice', ownerUsername: null } as AkskClientInfo;
    const { mock } = fetchStub({ 'GET /api/client?page=1&size=20': clientsPage([userClient]) });
    vi.stubGlobal('fetch', mock);
    const wrapper = await mountView();
    expect(wrapper.text()).toContain('sid-alice');
    expect(wrapper.text()).not.toContain('AKU0001—');
    wrapper.unmount();
  });

  it('按归属主体筛选，不提供批量 scopes 修改入口', async () => {
    const { mock, calls } = fetchStub({
      'GET /api/client?page=1&size=20': clientsPage(),
      'GET /api/client?ownerUserId=sid-alice&page=1&size=20': clientsPage()
    });
    vi.stubGlobal('fetch', mock);
    const wrapper = await mountView();

    await wrapper.get('#client-owner-filter').setValue('sid-alice');
    await wrapper.get('#client-owner-filter').trigger('keyup.enter');
    await flushPromises();
    expect(calls.some(call => call.url === '/api/client?ownerUserId=sid-alice&page=1&size=20')).toBe(true);
    expect(wrapper.find('.sync-form').exists()).toBe(false);
    wrapper.unmount();
  });

  it('行内禁用走单字段 PATCH', async () => {
    const { mock, calls } = fetchStub({
      'GET /api/client?page=1&size=20': clientsPage(),
      'GET /api/client?type=user&page=1&size=20': clientsPage(),
      'PATCH /api/client/AKP0001': { message: '' }
    });
    vi.stubGlobal('fetch', mock);
    const wrapper = await mountView();

    const disableButton = wrapper.findAll('button').find(button => button.text() === '禁用');
    expect(disableButton).toBeTruthy();
    await disableButton!.trigger('click');
    await flushPromises();
    const patchCall = calls.find(call => call.url === '/api/client/AKP0001');
    expect(patchCall).toBeTruthy();
    expect(JSON.parse(String(patchCall!.init.body))).toEqual({ enabled: false });
    expect(wrapper.text()).toContain('已禁用 AKP0001');
    wrapper.unmount();
  });

  it('类型 tabs 携带查询参数', async () => {
    const { mock, calls } = fetchStub({
      'GET /api/client?page=1&size=20': clientsPage(),
      'GET /api/client?type=user&page=1&size=20': clientsPage()
    });
    vi.stubGlobal('fetch', mock);
    const wrapper = await mountView();

    const userTab = wrapper.findAll('.type-filter-tabs button').find(button => button.text().includes('用户级'));
    await userTab!.trigger('click');
    await flushPromises();
    expect(calls.some(call => call.url === '/api/client?type=user&page=1&size=20')).toBe(true);
    wrapper.unmount();
  });
});

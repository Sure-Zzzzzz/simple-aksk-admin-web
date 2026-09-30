import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createWebHistory } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CreateClientView from './CreateClientView.vue';
import { formSelectDisplay } from './formSelectDriver';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body))
  };
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
      { path: '/clients', component: { template: '<div>clients-list</div>' } },
      { path: '/clients/create', component: CreateClientView },
      { path: '/clients/:clientId', component: { template: '<div>client-detail</div>' } }
    ]
  });
  await router.push('/clients/create');
  const wrapper = mount(CreateClientView, { attachTo: document.body, global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe('CreateClientView', () => {
  beforeEach(() => seedToken());

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('只提供平台级类型，用户级 AKU 指向门户自助创建', async () => {
    const { mock, calls } = fetchStub();
    vi.stubGlobal('fetch', mock);
    const wrapper = await mountView();

    const typeToggle = wrapper.get('.form-select-toggle');
    expect(typeToggle.attributes('disabled')).toBeDefined();
    expect(formSelectDisplay(wrapper, { ariaLabel: '客户端类型' })).toBe('平台级 AKP（业务系统持有）');
    expect(wrapper.text()).toContain('我的 AKSK 访问凭证');
    expect(wrapper.text()).not.toContain('归属用户 ID');
    expect(calls).toHaveLength(0);
    wrapper.unmount();
  });

  it('创建成功进入密钥一次性回显面板，确认后才跳详情', async () => {
    const { mock, calls } = fetchStub({
      'POST /api/client': { clientId: 'AKP0002', clientSecret: 'SK-once', type: 'platform', name: '平台客户端' }
    });
    vi.stubGlobal('fetch', mock);
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/clients', component: { template: '<div />' } },
        { path: '/clients/create', component: CreateClientView },
        { path: '/clients/:clientId', component: { template: '<div>client-detail</div>' } }
      ]
    });
    await router.push('/clients/create');
    const wrapper = mount(CreateClientView, { attachTo: document.body, global: { plugins: [router] } });
    await flushPromises();

    const inputs = wrapper.findAll('input');
    await inputs.find(input => input.element.placeholder === '客户端名称')!.setValue('平台客户端');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const postCall = calls.find(call => call.url === '/api/client');
    expect(postCall).toBeTruthy();
    expect(JSON.parse(String(postCall!.init.body))).toEqual({
      type: 'platform',
      name: '平台客户端'
    });
    expect(wrapper.text()).toContain('客户端创建成功');
    expect(wrapper.text()).toContain('AK：AKP0002');
    expect(wrapper.text()).toContain('SK：SK-once');
    expect(wrapper.text()).toContain('仅此一次');
    expect(router.currentRoute.value.path).toBe('/clients/create');

    await wrapper.findAll('button').find(button => button.text().includes('我已妥善保存'))!.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/clients/AKP0002');
    wrapper.unmount();
  });
});

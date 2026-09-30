import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createWebHistory } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MyCredentialsView from './MyCredentialsView.vue';
import { pickFormSelectOption } from './formSelectDriver';

const client = {
  clientId: 'AKU0001',
  clientSecret: null,
  clientName: '报表访问凭证',
  clientType: 2,
  ownerUserId: '7',
  ownerUsername: 'user7',
  scopes: [],
  enabled: true,
  clientIdIssuedAt: '2026-09-01T08:00:00Z',
  lifecycleVersion: 1,
  targetApplicationId: 42
};

const candidates = [{
  applicationId: 42,
  applicationName: '报表中心',
  applicationCodeSnapshot: 'reporting'
}];

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    // fetch 桩需带 headers（候选目录会读取 X-Aksk-Projection-Degraded；默认无该头=未降级）
    headers: { get: (name: string) => (name.toLowerCase() === 'x-aksk-projection-degraded' ? null : null) },
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body))
  };
}

function seedToken() {
  window.sessionStorage.setItem('aksk.accessToken', 'token-1');
  window.sessionStorage.setItem('aksk.accessTokenExpiresAt', String(Date.now() + 3600000));
}

async function mountView() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [{ path: '/my-credentials', component: MyCredentialsView }]
  });
  await router.push('/my-credentials');
  const wrapper = mount(MyCredentialsView, { attachTo: document.body, global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe('MyCredentialsView', () => {
  beforeEach(() => seedToken());

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('加载自助凭证并用明确按钮进入重命名', async () => {
    const mock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([client]))
      .mockResolvedValueOnce(jsonResponse(candidates));
    vi.stubGlobal('fetch', mock);
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('报表访问凭证');
    expect(wrapper.text()).toContain('报表中心（reporting）');
    expect(wrapper.text()).not.toContain('AKU0001');
    expect(wrapper.text()).not.toContain('AKP');
    expect(wrapper.text()).not.toContain('AKU');
    expect(wrapper.findAll('button').some(button => button.text() === '刷新')).toBe(false);
    expect(wrapper.findAll('button').some(button => button.text() === '重命名')).toBe(true);
    wrapper.unmount();
  });

  it('创建凭证只提交目标应用和名称，并一次性展示 Secret', async () => {
    const created = { ...client, clientName: '新凭证', clientSecret: 'secret-once' };
    const mock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse(candidates))
      .mockResolvedValueOnce(jsonResponse(created))
      .mockResolvedValueOnce(jsonResponse([created]))
      .mockResolvedValueOnce(jsonResponse(candidates));
    vi.stubGlobal('fetch', mock);
    const wrapper = await mountView();

    await wrapper.find('button.button-primary').trigger('click');
    await pickFormSelectOption(wrapper, { ariaLabel: '目标业务应用' }, '报表中心（reporting）');
    await wrapper.find('input[placeholder="例如：我的报表访问凭证"]').setValue('新凭证');
    await wrapper.findAll('button').find(button => button.text() === '创建凭证')!.trigger('click');
    await flushPromises();

    const createCall = mock.mock.calls[2] as [string, RequestInit];
    expect(createCall[0]).toBe('/api/me/aksk-clients');
    expect(JSON.parse(String(createCall[1].body))).toEqual({ targetApplicationId: 42, clientName: '新凭证' });
    expect(wrapper.text()).toContain('secret-once');
    expect(wrapper.text()).toContain('关闭后无法再次查看明文 SecretKey');
    wrapper.unmount();
  });
});

import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createWebHistory } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AuthorizationEditorView from './AuthorizationEditorView.vue';

const existingAuthorization = {
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

async function mountView(clientId = 'AKP0001') {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/authorizations/:clientId', component: AuthorizationEditorView },
      { path: '/authorizations', component: { template: '<div />' } }
    ]
  });
  await router.push(`/authorizations/${clientId}`);
  const wrapper = mount(AuthorizationEditorView, { attachTo: document.body, global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

function findByPlaceholder(wrapper: ReturnType<typeof mount>, placeholder: string) {
  const field = wrapper.findAll('input, textarea').find(item => item.attributes('placeholder') === placeholder);
  expect(field, `field[placeholder=${placeholder}]`).toBeTruthy();
  return field!;
}

describe('AuthorizationEditorView', () => {
  beforeEach(() => seedToken());

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('新建模式：grant 卡片编辑生成带 IN 约束的文档并 POST 创建', async () => {
    let created = false;
    const { mock, calls } = fetchStub({
      'GET /api/application-authorization/AKU0009': () => (created ? jsonResponse(existingAuthorization) : emptyResponse(404)),
      'POST /api/application-authorization?clientId=AKU0009': () => {
        created = true;
        return jsonResponse({ ...existingAuthorization, clientId: 'AKU0009' }, 201);
      }
    });
    vi.stubGlobal('fetch', mock);
    const wrapper = await mountView('AKU0009');

    expect(wrapper.text()).toContain('该客户端尚未配置授权');
    await findByPlaceholder(wrapper, '如 aksk').setValue('aksk');
    await findByPlaceholder(wrapper, '如 v1').setValue('v1');
    await findByPlaceholder(wrapper, '来自应用权限清单登记').setValue('digest-1');
    await findByPlaceholder(wrapper, 'app-admin\napp-user').setValue('app-admin');

    await wrapper.findAll('button').find(button => button.text() === '+ 添加授权条目')!.trigger('click');
    await findByPlaceholder(wrapper, '资源（如 kms:key）').setValue('kms:key');
    await findByPlaceholder(wrapper, 'read write').setValue('read');
    await wrapper.findAll('button').find(button => button.text() === '+ 添加约束（IN）')!.trigger('click');
    await findByPlaceholder(wrapper, '维度（如 department）').setValue('department');
    await findByPlaceholder(wrapper, '取值，逗号分隔（IN）').setValue('D01, D02');
    await findByPlaceholder(wrapper, '如 urn:aksk:data-grant:1').setValue('p1');
    await findByPlaceholder(wrapper, '如 1').setValue('1');

    await wrapper.findAll('button').find(button => button.text() === '创建授权')!.trigger('click');
    await flushPromises();

    const postCall = calls.find(call => call.url === '/api/application-authorization?clientId=AKU0009');
    expect(postCall).toBeTruthy();
    expect(JSON.parse(String(postCall!.init.body))).toEqual({
      applicationCode: 'aksk',
      admitted: false,
      roles: ['app-admin'],
      pagePermissions: [],
      apiPermissions: [],
      dataGrantDocument: {
        protocol: 'p1',
        version: '1',
        grants: [{ resource: 'kms:key', actions: ['read'], all: false, constraints: [{ dimension: 'department', operator: 'IN', values: ['D01', 'D02'] }] }]
      },
      manifestVersion: 'v1',
      manifestDigest: 'digest-1'
    });
    expect(wrapper.text()).toContain('应用授权已创建');
    wrapper.unmount();
  });

  it('全量授权开关会清空约束并在提交体中体现', async () => {
    const { mock, calls } = fetchStub({
      'GET /api/application-authorization/AKP0001': existingAuthorization,
      'PUT /api/application-authorization/AKP0001': existingAuthorization
    });
    vi.stubGlobal('fetch', mock);
    const wrapper = await mountView();

    const allToggle = wrapper.findAll('input[type="checkbox"]').find(checkbox => checkbox.element.closest('label')?.textContent?.includes('全量授权'));
    expect(allToggle).toBeTruthy();
    await allToggle!.setValue(true);

    await wrapper.findAll('button').find(button => button.text() === '保存（整单替换）')!.trigger('click');
    await flushPromises();

    const putCall = calls.find(call => call.url === '/api/application-authorization/AKP0001' && call.init.method === 'PUT');
    expect(putCall).toBeTruthy();
    const body = JSON.parse(String(putCall!.init.body)) as { dataGrantDocument: { grants: Array<{ all: boolean; constraints: unknown[] }> } };
    expect(body.dataGrantDocument.grants[0].all).toBe(true);
    expect(body.dataGrantDocument.grants[0].constraints).toEqual([]);
    wrapper.unmount();
  });

  it('并发修改 409 弹冲突对话框，重拉后回填', async () => {
    let putAttempted = false;
    const { mock, calls } = fetchStub({
      'GET /api/application-authorization/AKP0001': existingAuthorization,
      'PUT /api/application-authorization/AKP0001': () => (putAttempted ? jsonResponse(existingAuthorization) : emptyResponse(409))
    });
    vi.stubGlobal('fetch', mock);
    const wrapper = await mountView();
    const detailUrl = '/api/application-authorization/AKP0001';
    const initialGetCount = calls.filter(call => call.url === detailUrl && (call.init.method ?? 'GET') === 'GET').length;

    await wrapper.findAll('button').find(button => button.text() === '保存（整单替换）')!.trigger('click');
    await flushPromises();
    putAttempted = true;

    const dialog = document.body.querySelector('.confirm-dialog');
    expect(dialog?.textContent).toContain('并发修改');

    await wrapper.findAll('button').find(button => button.text() === '重拉并重新编辑')!.trigger('click');
    await flushPromises();
    const reloadedGetCount = calls.filter(call => call.url === detailUrl && (call.init.method ?? 'GET') === 'GET').length;
    expect(reloadedGetCount).toBeGreaterThan(initialGetCount);
    expect(wrapper.text()).toContain('kms:key');
    wrapper.unmount();
  });

  it('JSON 导入按精确字段校验并拒绝多余字段', async () => {
    const { mock } = fetchStub({
      'GET /api/application-authorization/AKP0001': existingAuthorization
    });
    vi.stubGlobal('fetch', mock);
    const wrapper = await mountView();

    await wrapper.findAll('button').find(button => button.text() === '展开')!.trigger('click');
    const textarea = wrapper.findAll('textarea').find(item => item.attributes('aria-label') === '数据授权文档 JSON');
    expect(textarea).toBeTruthy();
    await textarea!.setValue(JSON.stringify({
      protocol: 'p2', version: '2', grants: [{ resource: 'r', actions: ['read'], all: true, constraints: [], extra: 1 }]
    }));
    await wrapper.findAll('button').find(button => button.text() === '校验并导入')!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('多余字段');

    await textarea!.setValue(JSON.stringify({
      protocol: 'p2', version: '2', grants: [{ resource: 'r2', actions: ['read'], all: true, constraints: [] }]
    }));
    await wrapper.findAll('button').find(button => button.text() === '校验并导入')!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('已导入数据授权文档');
    expect((findByPlaceholder(wrapper, '资源（如 kms:key）').element as HTMLInputElement).value).toBe('r2');
    wrapper.unmount();
  });
});

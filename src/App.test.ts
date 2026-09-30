import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createWebHistory, type Router } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.vue';
import { applyAkskBridge } from './akskState';
import StandaloneGuideView from './view/StandaloneGuideView.vue';

const portalUser = { subjectId: 'sid-admin', username: 'admin', displayName: '管理员', admin: true, authorities: [] };

function makeRouter(): Router {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', component: StandaloneGuideView },
      { path: '/my-credentials', component: { template: '<div>my-credentials-page</div>' } },
      { path: '/clients', component: { template: '<div>clients-page</div>' } },
      { path: '/tokens', component: { template: '<div>tokens-page</div>' } },
      { path: '/authorizations', component: { template: '<div>authorizations-page</div>' } }
    ]
  });
}

describe('App', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    applyAkskBridge();
  });

  afterEach(() => {
    applyAkskBridge();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('standalone 直开根路由显示门户引导页', async () => {
    const router = makeRouter();
    await router.push('/');
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.text()).toContain('请从统一应用门户进入');
    wrapper.unmount();
  });

  it('门户桥接且有有效令牌时渲染业务路由', async () => {
    applyAkskBridge({ getCurrentUser: () => portalUser, apiBase: '' });
    window.sessionStorage.setItem('aksk.accessToken', 'token-1');
    window.sessionStorage.setItem('aksk.accessTokenExpiresAt', String(Date.now() + 3600_000));
    const router = makeRouter();
    await router.push('/clients');
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.text()).toContain('clients-page');
    expect(wrapper.find('.admin-message.error').exists()).toBe(false);
    wrapper.unmount();
  });

  it('门户桥接无令牌时由 API 内核驱动静默授权，挂载阶段不整页发起', async () => {
    applyAkskBridge({ getCurrentUser: () => portalUser });
    vi.stubEnv('VITE_AKSK_PKCE_CLIENT_ID', '');
    const router = makeRouter();
    await router.push('/clients');
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.text()).toContain('clients-page');
    expect(wrapper.find('.admin-message.error').exists()).toBe(false);
    expect(window.location.href).not.toContain('oauth2/authorize');
    wrapper.unmount();
  });
});

import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createWebHistory } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAkskBridge } from '../akskState';
import OAuthCallbackView from './OAuthCallbackView.vue';

function tokenResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ access_token: 'token-1', expires_in: 1800 })
  };
}

describe('OAuthCallbackView', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.stubEnv('VITE_AKSK_PKCE_CLIENT_ID', 'aksk-admin-pkce');
  });

  afterEach(() => {
    applyAkskBridge();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('门户形态回调成功后先将令牌落入会话存储，再由整页导航回到门户壳', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    applyAkskBridge({
      getCurrentUser: () => null,
      routePrefix: '/app/aksk'
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenResponse()));
    window.sessionStorage.setItem('aksk.pkce.state-1', JSON.stringify({ verifier: 'verifier-1', target: '/clients' }));
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/oauth-callback', component: OAuthCallbackView },
        { path: '/clients', component: { template: '<div />' } }
      ]
    });
    await router.push('/oauth-callback?code=code-1&state=state-1');
    const wrapper = mount(OAuthCallbackView, { attachTo: document.body, global: { plugins: [router] } });
    await flushPromises();
    expect(window.sessionStorage.getItem('aksk.accessToken')).toBe('token-1');
    // jsdom 不实现 location.replace 的整页导航；真实浏览器会进入 ./clients。
    expect(router.currentRoute.value.path).toBe('/oauth-callback');
    wrapper.unmount();
  });
});

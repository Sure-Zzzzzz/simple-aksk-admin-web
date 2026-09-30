import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AkskApiError,
  ConflictError,
  NotFoundError,
  clampAkskPage,
  clampAkskSize,
  createAkskClient,
  getAkskClient,
  listAkskClients,
  resetAkskClientSecret,
  revokeAkskApplicationAuthorization,
  setAkskApiBase,
  setAkskSilentAuthorizationProvider,
  syncAkskUserScopes
} from './akskAuth';

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

function seedValidToken(token = 'token-1') {
  window.sessionStorage.setItem('aksk.accessToken', token);
  window.sessionStorage.setItem('aksk.accessTokenExpiresAt', String(Date.now() + 3600_000));
}

interface RecordedCall {
  url: string;
  init: RequestInit;
}

interface ResponseLike {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

function fetchStub(respond: (call: RecordedCall) => ResponseLike) {
  const calls: RecordedCall[] = [];
  const mock = vi.fn().mockImplementation((url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return Promise.resolve(respond(calls[calls.length - 1]));
  });
  return { mock, calls };
}

describe('akskAuth', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    setAkskApiBase('');
  });

  afterEach(() => {
    setAkskSilentAuthorizationProvider(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('clamp', () => {
    it('页码与每页条数按服务端边界收敛', () => {
      expect(clampAkskPage(undefined)).toBe(1);
      expect(clampAkskPage(0)).toBe(1);
      expect(clampAkskPage(3)).toBe(3);
      expect(clampAkskSize(undefined)).toBe(20);
      expect(clampAkskSize(0)).toBe(1);
      expect(clampAkskSize(500)).toBe(100);
    });
  });

  describe('apiBase 前缀', () => {
    it('注入的前缀会拼进请求路径', async () => {
      setAkskApiBase('/aksk-api/');
      const { mock, calls } = fetchStub(() => jsonResponse({ data: [], total: 0, page: 1, size: 20, totalPages: 0 }));
      vi.stubGlobal('fetch', mock);
      await listAkskClients();
      expect(calls[0].url).toBe('/aksk-api/api/client?page=1&size=20');
    });

    it('空前缀与斜杠前缀都按同域 /api 直连', async () => {
      setAkskApiBase('/');
      const { mock, calls } = fetchStub(() => jsonResponse({ data: [], total: 0, page: 1, size: 20, totalPages: 0 }));
      vi.stubGlobal('fetch', mock);
      await listAkskClients();
      expect(calls[0].url).toBe('/api/client?page=1&size=20');
    });
  });

  describe('请求形态', () => {
    it('携带 Bearer 且不带 Cookie，GET 无 JSON 头', async () => {
      seedValidToken();
      const { mock, calls } = fetchStub(() => jsonResponse({ clientId: 'AK1', clientSecret: null, clientName: 'N', clientType: 1, ownerUserId: null, ownerUsername: null, scopes: [], enabled: true, clientIdIssuedAt: '' }));
      vi.stubGlobal('fetch', mock);
      await getAkskClient('AK1');
      expect(calls[0].init.credentials).toBe('omit');
      expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
      expect(calls[0].init.headers).not.toHaveProperty('Content-Type');
    });

    it('写请求带 JSON 头与请求体', async () => {
      seedValidToken();
      const { mock, calls } = fetchStub(() => jsonResponse({ clientId: 'AK1', clientSecret: 'SK1', type: 'user', name: 'N' }));
      vi.stubGlobal('fetch', mock);
      await createAkskClient({ type: 'user', name: 'N', ownerUserId: 'sid-user-7', ownerUsername: 'u7', scopes: ['read'] });
      expect(calls[0].init.method).toBe('POST');
      expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      expect(JSON.parse(String(calls[0].init.body))).toEqual({ type: 'user', name: 'N', ownerUserId: 'sid-user-7', ownerUsername: 'u7', scopes: ['read'] });
    });

    it('owner_user_id 同步走查询参数', async () => {
      seedValidToken();
      const { mock, calls } = fetchStub(() => jsonResponse({ ownerUserId: 'sid-user-7', updatedCount: 3, message: '' }));
      vi.stubGlobal('fetch', mock);
      await syncAkskUserScopes('sid-user-7', ['read', 'write']);
      expect(calls[0].url).toBe('/api/client?owner_user_id=sid-user-7');
      expect(calls[0].init.method).toBe('PATCH');
      expect(JSON.parse(String(calls[0].init.body))).toEqual({ scopes: ['read', 'write'] });
    });

    it('重置密钥携带 revokeTokens 参数', async () => {
      seedValidToken();
      const { mock, calls } = fetchStub(() => jsonResponse({ clientId: 'AK1', clientSecret: 'SK2' }));
      vi.stubGlobal('fetch', mock);
      await resetAkskClientSecret('AK1', false);
      expect(calls[0].url).toBe('/api/client/AK1/secret?revokeTokens=false');
      expect(calls[0].init.method).toBe('PUT');
    });

    it('204 空 body 返回 undefined', async () => {
      seedValidToken();
      const { mock } = fetchStub(() => ({ ok: true, status: 204, json: async () => ({}), text: async () => '' }));
      vi.stubGlobal('fetch', mock);
      await expect(revokeAkskApplicationAuthorization('AK1')).resolves.toBeUndefined();
    });
  });

  describe('错误形态', () => {
    it('409 抛 ConflictError 稳定标记', async () => {
      seedValidToken();
      const { mock } = fetchStub(() => emptyResponse(409));
      vi.stubGlobal('fetch', mock);
      const error = await getAkskClient('AK1').catch(e => e);
      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toBeInstanceOf(AkskApiError);
      expect(error.status).toBe(409);
      expect(error.message).toContain('查询客户端详情失败');
      expect(error.message).toContain('并发修改');
    });

    it('404 抛 NotFoundError', async () => {
      seedValidToken();
      const { mock } = fetchStub(() => emptyResponse(404));
      vi.stubGlobal('fetch', mock);
      const error = await getAkskClient('AK1').catch(e => e);
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.message).toContain('不存在');
    });

    it('空 body 错误按状态码出文案，body.message 存在时优先', async () => {
      seedValidToken();
      const empty = fetchStub(() => emptyResponse(403));
      vi.stubGlobal('fetch', empty.mock);
      const forbidden = await getAkskClient('AK1').catch(e => e);
      expect(forbidden).toBeInstanceOf(AkskApiError);
      expect(forbidden.message).toContain('没有执行该操作的权限');

      const preconditionFailed = fetchStub(() => emptyResponse(412));
      vi.stubGlobal('fetch', preconditionFailed.mock);
      const changed = await getAkskClient('AK1').catch(e => e);
      expect(changed.message).toContain('操作条件已变化');

      const preconditionRequired = fetchStub(() => emptyResponse(428));
      vi.stubGlobal('fetch', preconditionRequired.mock);
      const stale = await getAkskClient('AK1').catch(e => e);
      expect(stale.message).toContain('页面状态已过期');

      const withBody = fetchStub(() => jsonResponse({ message: '服务端给定文案' }, 500));
      vi.stubGlobal('fetch', withBody.mock);
      const serverError = await getAkskClient('AK1').catch(e => e);
      expect(serverError).toBeInstanceOf(AkskApiError);
      expect(serverError.message).toContain('服务端给定文案');
    });

    it('401 静默授权成功后自动重放原请求且携带新令牌', async () => {
      seedValidToken('stale-token');
      setAkskSilentAuthorizationProvider(async () => {
        window.sessionStorage.setItem('aksk.accessToken', 'silent-token');
        return true;
      });
      const { mock, calls } = fetchStub(() => (calls.length === 1 ? emptyResponse(401) : jsonResponse({ clientId: 'AK1' })));
      vi.stubGlobal('fetch', mock);
      const result = await getAkskClient('AK1');
      expect(result.clientId).toBe('AK1');
      expect(mock).toHaveBeenCalledTimes(2);
      expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer stale-token');
      expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer silent-token');
    });

    it('首进无 AKSK 令牌时不走隐藏 iframe，直接进入整页 PKCE', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const silentAuthorization = vi.fn().mockResolvedValue(true);
      setAkskSilentAuthorizationProvider(silentAuthorization);
      const { mock } = fetchStub(() => emptyResponse(401));
      vi.stubGlobal('fetch', mock);

      const error = await getAkskClient('AK1').catch(e => e);

      expect(error).toBeInstanceOf(AkskApiError);
      expect(error.message).toContain('登录状态失效，正在重新发起授权');
      expect(silentAuthorization).not.toHaveBeenCalled();
    });

    it('熔断期内 401 直接抛持续失败错误，不再发起静默或整页授权', async () => {
      const silentAuthorization = vi.fn().mockResolvedValue(true);
      setAkskSilentAuthorizationProvider(silentAuthorization);
      window.sessionStorage.setItem('aksk.auth.suspendedUntil', String(Date.now() + 60_000));
      const { mock } = fetchStub(() => emptyResponse(401));
      vi.stubGlobal('fetch', mock);

      const error = await getAkskClient('AK1').catch(e => e);

      expect(error).toBeInstanceOf(AkskApiError);
      expect(error.message).toContain('已暂停自动重试');
      expect(silentAuthorization).not.toHaveBeenCalled();
      expect(mock).toHaveBeenCalledTimes(1);
      // 熔断标记保留，供后续请求继续快速失败
      expect(window.sessionStorage.getItem('aksk.auth.suspendedUntil')).not.toBeNull();
    });

    it('401 静默授权失败会清理恢复状态后重新发起整页授权', async () => {
      seedValidToken();
      window.sessionStorage.setItem('aksk.lastAuthAt', String(Date.now()));
      window.sessionStorage.setItem('aksk.pkce.retry', '1');
      setAkskSilentAuthorizationProvider(async () => false);
      const { mock } = fetchStub(() => emptyResponse(401));
      vi.stubGlobal('fetch', mock);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const error = await getAkskClient('AK1').catch(e => e);
      expect(error).toBeInstanceOf(AkskApiError);
      expect(error.message).toContain('登录状态失效，正在重新发起授权');
      expect(window.sessionStorage.getItem('aksk.accessToken')).toBeNull();
      expect(window.sessionStorage.getItem('aksk.lastAuthAt')).toBeNull();
      expect(window.sessionStorage.getItem('aksk.pkce.retry')).toBeNull();
    });
  });
});

const PKCE_STATE_PREFIX = 'aksk.pkce.';
const ACCESS_TOKEN_KEY = 'aksk.accessToken';
const ACCESS_TOKEN_EXPIRES_AT_KEY = 'aksk.accessTokenExpiresAt';
const LAST_AUTH_AT_KEY = 'aksk.lastAuthAt';
const RETRY_COUNT_KEY = 'aksk.pkce.retry';
const FRESH_REJECT_STREAK_KEY = 'aksk.auth.freshRejectStreak';
const SUSPENDED_UNTIL_KEY = 'aksk.auth.suspendedUntil';
/** 新授权令牌在此时长内被 401 视为“刚授权就被拒”，计入熔断连击。 */
const FRESH_AUTH_THRESHOLD_MS = 30_000;
/** 连续“刚授权就被拒”达到该次数进入熔断：不再自动重授权，等待人工或超时恢复。 */
const FRESH_REJECT_SUSPEND_THRESHOLD = 2;
/** 熔断时长：超时后允许再次自动授权，避免一次性故障永久锁死。 */
const AUTH_SUSPEND_MS = 5 * 60_000;
const PKCE_SCOPE = 'openid profile';
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const REAUTH_MIN_INTERVAL_MS = 60_000;

export class AkskPkceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AkskPkceError';
  }
}

export type AkskCallbackOutcome =
  | { kind: 'authorized'; target: string }
  | { kind: 'retrying'; target: string }
  | { kind: 'missing-params' }
  | { kind: 'silent'; ok: boolean };

function resolveAkskSessionStorage(): Storage | null {
  // qiankun 会为每次子应用挂载创建 Window Proxy。回调页和目标页之间必须使用
  // 同源顶层窗口的真实 sessionStorage，否则 PKCE verifier 或换到的令牌会丢失。
  try {
    return window.top?.sessionStorage ?? window.sessionStorage;
  } catch {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  }
}

function readSessionString(key: string): string | null {
  try {
    return resolveAkskSessionStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeSessionString(key: string, value: string) {
  try {
    resolveAkskSessionStorage()?.setItem(key, value);
  } catch {
    // 隐私模式等存储不可用场景：跳过持久化，本次内存态仍可继续
  }
}

function removeSessionKey(key: string) {
  try {
    resolveAkskSessionStorage()?.removeItem(key);
  } catch {
    // 同上
  }
}

function readSessionNumber(key: string): number {
  const raw = readSessionString(key);
  if (raw === null) {
    return Number.NaN;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : Number.NaN;
}

function pkceClientId(): string {
  const clientId = import.meta.env.VITE_AKSK_PKCE_CLIENT_ID as string | undefined;
  if (!clientId) {
    throw new AkskPkceError('未配置 VITE_AKSK_PKCE_CLIENT_ID，无法发起授权');
  }
  return clientId;
}

function redirectUri(): string {
  // SAS 0.4.1 拒绝 host 为字面 localhost 的 redirect_uri；本机按 127.0.0.1 规范（生产域名不受影响）
  const origin = window.location.origin.replace('//localhost:', '//127.0.0.1:');
  return `${origin}${import.meta.env.BASE_URL}oauth-callback`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomUrlSafeString(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}

export function getAkskAccessToken(): string | null {
  return readSessionString(ACCESS_TOKEN_KEY);
}

export function hasValidAkskAccessToken(): boolean {
  const token = readSessionString(ACCESS_TOKEN_KEY);
  if (!token) {
    return false;
  }
  const expiresAt = readSessionNumber(ACCESS_TOKEN_EXPIRES_AT_KEY);
  return Number.isFinite(expiresAt) && Date.now() < expiresAt - TOKEN_EXPIRY_SKEW_MS;
}

export function clearAkskAccessToken(): void {
  removeSessionKey(ACCESS_TOKEN_KEY);
  removeSessionKey(ACCESS_TOKEN_EXPIRES_AT_KEY);
}

/**
 * AKSK API 已明确拒绝当前令牌时，清除上一次授权留下的恢复状态。
 * 这条路径由服务端 401 触发，不适用于用户重复点击的普通授权入口；后者仍保留节流保护。
 *
 * 新授权令牌在极短时间内再次被拒说明问题不在令牌本身（例如验证客户端配置错误、
 * 服务端形态切换），重授权不可能成功：连续两次后进入熔断，停止自动授权避免 PKCE 跳转风暴。
 */
export function resetAkskUnauthorizedRecovery(): void {
  const lastAuthAt = readSessionNumber(LAST_AUTH_AT_KEY);
  const freshReject = Number.isFinite(lastAuthAt)
    && Date.now() - lastAuthAt < FRESH_AUTH_THRESHOLD_MS;
  const streak = freshReject ? (readSessionNumber(FRESH_REJECT_STREAK_KEY) || 0) + 1 : 0;
  if (streak >= FRESH_REJECT_SUSPEND_THRESHOLD) {
    writeSessionString(SUSPENDED_UNTIL_KEY, String(Date.now() + AUTH_SUSPEND_MS));
    removeSessionKey(FRESH_REJECT_STREAK_KEY);
  } else if (freshReject) {
    writeSessionString(FRESH_REJECT_STREAK_KEY, String(streak));
  } else {
    removeSessionKey(FRESH_REJECT_STREAK_KEY);
  }
  clearAkskAccessToken();
  removeSessionKey(LAST_AUTH_AT_KEY);
  removeSessionKey(RETRY_COUNT_KEY);
}

/**
 * 授权是否处于熔断期。熔断内调用方不得再自动发起授权（整页或静默），
 * 应向用户展示明确错误并等待超时恢复或人工重试。
 */
export function isAkskAuthorizationSuspended(): boolean {
  const until = readSessionNumber(SUSPENDED_UNTIL_KEY);
  if (Number.isFinite(until) && Date.now() < until) {
    return true;
  }
  if (Number.isFinite(until)) {
    removeSessionKey(SUSPENDED_UNTIL_KEY);
  }
  return false;
}

/**
 * 人工清除熔断（错误提示上的“重试”按钮调用），恢复常规授权链。
 */
export function clearAkskAuthorizationSuspension(): void {
  removeSessionKey(SUSPENDED_UNTIL_KEY);
  removeSessionKey(FRESH_REJECT_STREAK_KEY);
}

export async function beginAkskAuthorization(target = '/'): Promise<void> {
  if (isAkskAuthorizationSuspended()) {
    throw new AkskPkceError('AKSK 授权验证持续失败，已暂停自动授权；请稍后重试或重新从统一应用门户进入');
  }
  const lastAuthAt = readSessionNumber(LAST_AUTH_AT_KEY);
  if (Number.isFinite(lastAuthAt) && Date.now() - lastAuthAt < REAUTH_MIN_INTERVAL_MS) {
    throw new AkskPkceError('刚刚完成授权仍无法通过校验，请稍后重试或重新从统一应用门户进入');
  }
  window.location.assign(await buildAkskAuthorizeUrl(target));
}

export async function buildAkskAuthorizeUrl(target: string): Promise<string> {
  const clientId = pkceClientId();
  const state = randomUrlSafeString();
  const verifier = randomUrlSafeString();
  writeSessionString(`${PKCE_STATE_PREFIX}${state}`, JSON.stringify({ verifier, target }));
  const codeChallenge = await sha256Base64Url(verifier);
  const search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri(),
    scope: PKCE_SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });
  return `/oauth2/authorize?${search.toString()}`;
}

const RENEW_BEFORE_MS = 120_000;
const RENEW_WATCHDOG_MS = 15_000;
const RENEW_MESSAGE = 'aksk:pkce-silent-renew';
let renewTimer: number | undefined;

interface AkskSilentRenewalMessage {
  type?: string;
  ok?: boolean;
  accessToken?: string;
  expiresAt?: number;
}

/**
 * 隐藏 iframe 静默授权（首进获取与续签同链）：会话在则整条授权码链在 iframe 内完成，
 * 新令牌落同一 sessionStorage，主页面无刷新（不闪、不丢表单状态）；会话失效时回调页
 * 回报失败，由调用方回落整页授权链。并发调用经单飞去重，同一时刻至多一个 iframe。
 */
export function silentAkskAuthorization(): Promise<boolean> {
  if (!silentInflight) {
    silentInflight = runSilentAuthorization().finally(() => {
      silentInflight = null;
      cancelSilentAuthorization = null;
    });
  }
  return silentInflight;
}

let silentInflight: Promise<boolean> | null = null;
let cancelSilentAuthorization: (() => void) | null = null;

function runSilentAuthorization(): Promise<boolean> {
  return new Promise(resolve => {
    let iframe: HTMLIFrameElement | null = null;
    let watchdog = 0;
    let finished = false;
    const finish = (ok: boolean) => {
      if (finished) {
        return;
      }
      finished = true;
      window.clearTimeout(watchdog);
      window.removeEventListener('message', onMessage);
      iframe?.remove();
      iframe = null;
      resolve(ok);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== iframe?.contentWindow) {
        return;
      }
      const data = event.data as AkskSilentRenewalMessage | null;
      if (data?.type === RENEW_MESSAGE) {
        const expiresAt = data.expiresAt;
        if (data.ok !== true || typeof data.accessToken !== 'string' || !data.accessToken
          || !Number.isFinite(expiresAt) || expiresAt === undefined
          || expiresAt <= Date.now() + TOKEN_EXPIRY_SKEW_MS) {
          finish(false);
          return;
        }
        // qiankun 下 iframe 与主应用可能处于不同的存储代理；令牌必须由主应用落位。
        writeSessionString(ACCESS_TOKEN_KEY, data.accessToken);
        writeSessionString(ACCESS_TOKEN_EXPIRES_AT_KEY, String(expiresAt));
        writeSessionString(LAST_AUTH_AT_KEY, String(Date.now()));
        removeSessionKey(RETRY_COUNT_KEY);
        scheduleAkskTokenRenewal();
        finish(true);
      }
    };
    window.addEventListener('message', onMessage);
    cancelSilentAuthorization = () => finish(false);
    watchdog = window.setTimeout(() => finish(false), RENEW_WATCHDOG_MS);
    iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);
    void buildAkskAuthorizeUrl('/clients').then(url => {
      if (iframe) {
        iframe.src = url;
      }
    });
  });
}

export function scheduleAkskTokenRenewal(): void {
  window.clearTimeout(renewTimer);
  const expiresAt = readSessionNumber(ACCESS_TOKEN_EXPIRES_AT_KEY);
  if (!Number.isFinite(expiresAt)) {
    return;
  }
  const dueAt = expiresAt - TOKEN_EXPIRY_SKEW_MS - RENEW_BEFORE_MS;
  const delay = Math.max(dueAt - Date.now(), 5_000);
  renewTimer = window.setTimeout(() => {
    void silentAkskAuthorization().finally(scheduleAkskTokenRenewal);
  }, delay);
}

export function cancelAkskTokenRenewal(): void {
  window.clearTimeout(renewTimer);
  renewTimer = undefined;
  cancelSilentAuthorization?.();
  cancelSilentAuthorization = null;
}

interface AkskTokenExchangeResult {
  accessToken: string;
  expiresIn: number;
}

async function exchangeCodeForToken(code: string, verifier: string): Promise<AkskTokenExchangeResult> {
  const response = await window.fetch('/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: pkceClientId(),
      code_verifier: verifier
    }).toString(),
    credentials: 'omit'
  });
  if (!response.ok) {
    throw new AkskPkceError(`令牌交换失败（HTTP ${response.status}）`);
  }
  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!payload.access_token) {
    throw new AkskPkceError(payload.error ? `令牌交换失败：${payload.error}` : '令牌交换响应缺少 access_token');
  }
  const expiresIn = typeof payload.expires_in === 'number' && payload.expires_in > 0 ? payload.expires_in : 3600;
  return { accessToken: payload.access_token, expiresIn };
}

export async function handleAkskOAuthCallback(options: { silent?: boolean } = {}): Promise<AkskCallbackOutcome> {
  const silent = options.silent === true;
  const params = new URLSearchParams(window.location.search);
  const errorParam = params.get('error');
  if (errorParam) {
    if (silent) {
      reportSilentResult(false);
      return { kind: 'silent', ok: false };
    }
    throw new AkskPkceError(`授权失败：${errorParam}`);
  }
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) {
    if (silent) {
      reportSilentResult(false);
      return { kind: 'silent', ok: false };
    }
    return { kind: 'missing-params' };
  }
  const stored = readSessionString(`${PKCE_STATE_PREFIX}${state}`);
  let verifier = '';
  let target = '/';
  if (stored) {
    removeSessionKey(`${PKCE_STATE_PREFIX}${state}`);
    try {
      const parsed = JSON.parse(stored) as { verifier?: string; target?: string };
      verifier = typeof parsed.verifier === 'string' ? parsed.verifier : '';
      target = typeof parsed.target === 'string' && parsed.target.startsWith('/') ? parsed.target : '/';
    } catch {
      verifier = '';
    }
  }
  if (!verifier) {
    if (silent) {
      reportSilentResult(false);
      return { kind: 'silent', ok: false };
    }
    return retryAuthorization(target);
  }
  try {
    const { accessToken, expiresIn } = await exchangeCodeForToken(code, verifier);
    const expiresAt = Date.now() + expiresIn * 1000;
    writeSessionString(ACCESS_TOKEN_KEY, accessToken);
    writeSessionString(ACCESS_TOKEN_EXPIRES_AT_KEY, String(expiresAt));
    writeSessionString(LAST_AUTH_AT_KEY, String(Date.now()));
    removeSessionKey(RETRY_COUNT_KEY);
    window.history.replaceState(window.history.state, '', window.location.pathname);
    if (silent) {
      reportSilentResult(true, accessToken, expiresAt);
      return { kind: 'silent', ok: true };
    }
    return { kind: 'authorized', target };
  } catch {
    clearAkskAccessToken();
    if (silent) {
      reportSilentResult(false);
      return { kind: 'silent', ok: false };
    }
    return retryAuthorization(target);
  }
}

function reportSilentResult(ok: boolean, accessToken?: string, expiresAt?: number) {
  if (window.top && window.top !== window.self) {
    window.top.postMessage({ type: RENEW_MESSAGE, ok, accessToken, expiresAt }, window.location.origin);
  }
}

async function retryAuthorization(target: string): Promise<AkskCallbackOutcome> {
  const attempts = readSessionNumber(RETRY_COUNT_KEY);
  const used = Number.isFinite(attempts) ? attempts : 0;
  if (used >= 1) {
    removeSessionKey(RETRY_COUNT_KEY);
    throw new AkskPkceError('授权码交换失败，请重新从统一应用门户进入');
  }
  writeSessionString(RETRY_COUNT_KEY, '1');
  await beginAkskAuthorization(target);
  return { kind: 'retrying', target };
}

export function resetAkskAuthorizationRetryBudget(): void {
  removeSessionKey(RETRY_COUNT_KEY);
}

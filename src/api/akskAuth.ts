import {
  beginAkskAuthorization,
  getAkskAccessToken,
  isAkskAuthorizationSuspended,
  resetAkskUnauthorizedRecovery,
  silentAkskAuthorization
} from '../auth/pkce';

let trySilentAuthorization: () => Promise<boolean> = () => silentAkskAuthorization();

export function setAkskSilentAuthorizationProvider(provider: (() => Promise<boolean>) | null) {
  trySilentAuthorization = provider ?? (() => silentAkskAuthorization());
}

export class AkskApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AkskApiError';
    this.status = status;
  }
}

export class ConflictError extends AkskApiError {
  constructor(message: string) {
    super(message, 409);
    this.name = 'ConflictError';
  }
}

export class NotFoundError extends AkskApiError {
  constructor(message: string) {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

export interface AkskPage<T> {
  data: T[];
  total: number;
  page: number;
  size: number;
  totalPages: number;
}

export interface AkskClientInfo {
  clientId: string;
  clientSecret: string | null;
  clientName: string;
  clientType: 1 | 2;
  /** 服务端兼容字段名；值是 IAM 对外稳定主体 ID，不是内部自增 userId。 */
  ownerUserId: string | null;
  ownerUsername: string | null;
  scopes: string[];
  enabled: boolean;
  clientIdIssuedAt: string;
  lifecycleVersion?: number | null;
  targetApplicationId?: number | null;
}

export interface AkskCandidateApplication {
  applicationId: number;
  applicationName: string;
  applicationCodeSnapshot: string;
}

export interface CreateAkskClientInput {
  type: 'platform' | 'user';
  name: string;
  ownerUserId?: string;
  ownerUsername?: string;
  scopes?: string[];
}

export interface CreateAkskClientResult {
  clientId: string;
  clientSecret: string;
  type: string;
  name: string;
}

export interface ResetAkskSecretResult {
  clientId: string;
  clientSecret: string;
}

export interface SyncAkskScopesResult {
  ownerUserId: string;
  updatedCount: number;
  message: string;
}

export interface AkskTokenInfo {
  id: string;
  registeredClientId: string;
  clientId: string;
  clientName: string;
  clientType: 1 | 2;
  issuedAt: string;
  expiresAt: string;
  scopes: string[];
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  dataSource: 'MYSQL' | 'REDIS' | 'BOTH';
  ownerUserId: string | null;
  ownerUsername: string | null;
}

export interface AkskTokenStatistics {
  totalCount: number;
  activeCount: number;
  revokedCount: number;
  expiredCount: number;
  mysqlCount: number;
  redisCount: number;
  bothCount: number;
}

export interface AkskDataConstraint {
  dimension: string;
  operator: 'IN';
  values: string[];
}

export interface AkskDataGrant {
  resource: string;
  actions: string[];
  all: boolean;
  constraints: AkskDataConstraint[];
}

export interface AkskDataGrantDocument {
  protocol: string;
  version: string;
  grants: AkskDataGrant[];
}

export interface AkskApplicationAuthorizationInput {
  applicationCode: string;
  admitted: boolean;
  roles: string[];
  pagePermissions: string[];
  apiPermissions: string[];
  dataGrantDocument: AkskDataGrantDocument | null;
  manifestVersion: string;
  manifestDigest: string;
}

export interface AkskApplicationAuthorization {
  clientId: string;
  clientType: 1 | 2;
  ownerUserId: string | null;
  applicationCode: string;
  admitted: boolean;
  enabled: boolean;
  roles: string[];
  pagePermissions: string[];
  apiPermissions: string[];
  dataGrantDocument: AkskDataGrantDocument | null;
  authorizationVersion: number;
  manifestVersion: string;
  manifestDigest: string;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}

let apiBasePrefix = '';
let unauthorizedTargetProvider: () => string = () => '/';

export function setAkskApiBase(prefix: string | null | undefined) {
  const trimmed = typeof prefix === 'string' ? prefix.replace(/\/+$/, '') : '';
  apiBasePrefix = trimmed === '/' ? '' : trimmed;
}

export function setAkskUnauthorizedTargetProvider(provider: () => string) {
  unauthorizedTargetProvider = provider;
}

export function clampAkskPage(page?: number): number {
  return Math.max(1, Math.floor(page ?? 1));
}

export function clampAkskSize(size?: number, max = 100): number {
  return Math.min(max, Math.max(1, Math.floor(size ?? 20)));
}

const STATUS_MESSAGES: Record<number, string> = {
  400: '请求参数无效',
  403: '没有执行该操作的权限',
  404: '资源不存在或已被删除',
  409: '记录已被并发修改或状态冲突',
  412: '操作条件已变化，请刷新后重试',
  428: '页面状态已过期，请刷新后重试',
  500: '服务内部错误'
};

async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (body && typeof body.message === 'string' && body.message.trim()) {
      return body.message.trim();
    }
  } catch {
    // 管理异常为空 body 是常态
  }
  return null;
}

async function akskRequest<T>(
  path: string,
  init: RequestInit,
  context: string,
  allowSilentRetry = true,
  extraHeaders: Record<string, string> = {},
  // 可选响应头收集器：填入的键名按 fetch 语义大小写不敏感取值；3.2.1 起候选目录用它透出投影降级标记
  headerSink?: Record<string, string | null>
): Promise<T> {
  const token = getAkskAccessToken();
  const response = await window.fetch(`${apiBasePrefix}${path}`, {
    ...init,
    credentials: 'omit',
    headers: {
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders
    }
  });
  if (response.status === 204) {
    return undefined as T;
  }
  if (response.ok) {
    if (headerSink) {
      for (const name of Object.keys(headerSink)) {
        headerSink[name] = response.headers.get(name);
      }
    }
    const text = await response.text();
    return (text === '' ? (undefined as T) : (JSON.parse(text) as T));
  }
  if (response.status === 401) {
    // 熔断期：刚换的新令牌连续被拒说明重授权不可能成功（验证客户端配置、服务端形态等
    // 基础设施问题）。直接向用户抛出明确错误，不再清状态、不再发起授权，杜绝 PKCE 跳转风暴。
    if (isAkskAuthorizationSuspended()) {
      throw new AkskApiError('AKSK 授权验证持续失败，已暂停自动重试；请稍后再试或重新从统一应用门户进入', 401);
    }
    // 服务端已明确拒绝旧令牌（例如 AKSK 双实例重启后）。这不是用户重复点击，
    // 必须清理上一轮授权节流与重试标记，才允许恢复链重新建立 PKCE 会话。
    resetAkskUnauthorizedRecovery();
    // 首进没有本应用令牌时必须走整页 PKCE；qiankun 存储边界下不能把 iframe 当作首认证载体。
    if (token && allowSilentRetry && await trySilentAuthorization()) {
      return akskRequest<T>(path, init, context, false, extraHeaders);
    }
    await beginAkskAuthorization(unauthorizedTargetProvider());
    throw new AkskApiError('登录状态失效，正在重新发起授权', 401);
  }
  const serverMessage = await readErrorMessage(response);
  const fallback = STATUS_MESSAGES[response.status] ?? `请求失败（HTTP ${response.status}）`;
  const message = `${context}失败：${serverMessage ?? fallback}`;
  if (response.status === 409) {
    throw new ConflictError(message);
  }
  if (response.status === 404) {
    throw new NotFoundError(message);
  }
  throw new AkskApiError(message, response.status);
}

function buildQuery(params: Record<string, string | number | boolean | string[] | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    if (Array.isArray(value)) {
      value.forEach(item => search.append(key, item));
      continue;
    }
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export interface ListAkskClientsQuery {
  ownerUserId?: string;
  type?: 'platform' | 'user';
  page?: number;
  size?: number;
}

export async function listAkskClients(query: ListAkskClientsQuery = {}): Promise<AkskPage<AkskClientInfo>> {
  const path = buildQuery({
    ownerUserId: query.ownerUserId,
    type: query.type,
    page: clampAkskPage(query.page),
    size: clampAkskSize(query.size)
  });
  return akskRequest<AkskPage<AkskClientInfo>>(`/api/client${path}`, { method: 'GET' }, '查询客户端列表');
}

export async function fetchAkskClientsByIds(clientIds: string[]): Promise<Record<string, AkskClientInfo>> {
  const path = buildQuery({ clientIds: clientIds.slice(0, 100) });
  const body = await akskRequest<{ clients?: Record<string, AkskClientInfo> }>(`/api/client${path}`, { method: 'GET' }, '批量查询客户端');
  return body?.clients ?? {};
}

export async function getAkskClient(clientId: string): Promise<AkskClientInfo> {
  return akskRequest<AkskClientInfo>(`/api/client/${encodeURIComponent(clientId)}`, { method: 'GET' }, '查询客户端详情');
}

export async function createAkskClient(input: CreateAkskClientInput): Promise<CreateAkskClientResult> {
  return akskRequest<CreateAkskClientResult>('/api/client', {
    method: 'POST',
    body: JSON.stringify(input)
  }, '创建客户端');
}

export type UpdateAkskClientInput =
  | { enabled: boolean }
  | { scopes: string[] }
  | { name: string }
  | { ownerUserId: string; ownerUsername: string };

export async function updateAkskClient(clientId: string, input: UpdateAkskClientInput): Promise<{ message?: string }> {
  return akskRequest<{ message?: string }>(`/api/client/${encodeURIComponent(clientId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  }, '更新客户端');
}

export async function syncAkskUserScopes(ownerUserId: string, scopes: string[]): Promise<SyncAkskScopesResult> {
  const path = buildQuery({ owner_user_id: ownerUserId });
  return akskRequest<SyncAkskScopesResult>(`/api/client${path}`, {
    method: 'PATCH',
    body: JSON.stringify({ scopes })
  }, '同步用户客户端权限范围');
}

export async function resetAkskClientSecret(clientId: string, revokeTokens: boolean): Promise<ResetAkskSecretResult> {
  const path = buildQuery({ revokeTokens });
  return akskRequest<ResetAkskSecretResult>(`/api/client/${encodeURIComponent(clientId)}/secret${path}`, {
    method: 'PUT'
  }, '重置客户端密钥');
}

export async function deleteAkskClient(clientId: string): Promise<void> {
  await akskRequest<void>(`/api/client/${encodeURIComponent(clientId)}`, { method: 'DELETE' }, '删除客户端');
}

export interface AkskCandidateApplicationsResult {
  applications: AkskCandidateApplication[];
  // true=本地投影同步租约已过期：空目录可能是"读不到"而非"没授权"（X-Aksk-Projection-Degraded，server 3.2.1+）
  degraded: boolean;
}

export async function listMyAkskCandidateApplications(): Promise<AkskCandidateApplicationsResult> {
  const headerSink: Record<string, string | null> = { 'X-Aksk-Projection-Degraded': null };
  const applications = await akskRequest<AkskCandidateApplication[]>(
    '/api/me/aksk-clients/candidate-applications',
    { method: 'GET' },
    '查询可用业务应用',
    true,
    {},
    headerSink
  );
  return { applications: applications ?? [], degraded: headerSink['X-Aksk-Projection-Degraded'] === 'true' };
}

export async function listMyAkskClients(): Promise<AkskClientInfo[]> {
  return akskRequest<AkskClientInfo[]>('/api/me/aksk-clients', { method: 'GET' }, '查询我的 AKSK 访问凭证');
}

export interface CreateMyAkskClientInput {
  targetApplicationId: number;
  clientName: string;
}

export async function createMyAkskClient(
  input: CreateMyAkskClientInput,
  idempotencyKey: string
): Promise<AkskClientInfo> {
  return akskRequest<AkskClientInfo>('/api/me/aksk-clients', {
    method: 'POST',
    body: JSON.stringify(input)
  }, '创建访问凭证', true, { 'Idempotency-Key': idempotencyKey });
}

export async function renameMyAkskClient(
  clientId: string,
  clientName: string,
  lifecycleVersion: number
): Promise<AkskClientInfo> {
  return akskRequest<AkskClientInfo>(`/api/me/aksk-clients/${encodeURIComponent(clientId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ clientName })
  }, '修改凭证名称', true, { 'If-Match': String(lifecycleVersion) });
}

export async function rotateMyAkskSecret(clientId: string, lifecycleVersion: number): Promise<AkskClientInfo> {
  return akskRequest<AkskClientInfo>(`/api/me/aksk-clients/${encodeURIComponent(clientId)}/secret`, {
    method: 'PUT'
  }, '轮换凭证密钥', true, { 'If-Match': String(lifecycleVersion) });
}

export async function terminateMyAkskClient(clientId: string, lifecycleVersion: number): Promise<void> {
  await akskRequest<void>(`/api/me/aksk-clients/${encodeURIComponent(clientId)}`, {
    method: 'DELETE'
  }, '撤销访问凭证', true, { 'If-Match': String(lifecycleVersion) });
}

export interface ListAkskTokensQuery {
  clientId?: string;
  clientType?: 1 | 2;
  status?: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  search?: string;
  page?: number;
  size?: number;
}

export async function listAkskTokens(query: ListAkskTokensQuery = {}): Promise<AkskPage<AkskTokenInfo>> {
  const path = buildQuery({
    clientId: query.clientId,
    clientType: query.clientType,
    status: query.status,
    search: query.search,
    page: clampAkskPage(query.page),
    size: clampAkskSize(query.size, 100)
  });
  return akskRequest<AkskPage<AkskTokenInfo>>(`/api/token${path}`, { method: 'GET' }, '查询令牌列表');
}

export interface ListAkskRedisTokensQuery {
  status?: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  page?: number;
  size?: number;
}

export async function listAkskRedisTokens(query: ListAkskRedisTokensQuery = {}): Promise<AkskPage<AkskTokenInfo>> {
  const path = buildQuery({
    status: query.status,
    page: clampAkskPage(query.page),
    size: clampAkskSize(query.size, 100)
  });
  return akskRequest<AkskPage<AkskTokenInfo>>(`/api/token/redis${path}`, { method: 'GET' }, '查询 Redis 令牌列表');
}

export async function getAkskTokenStatistics(): Promise<AkskTokenStatistics> {
  return akskRequest<AkskTokenStatistics>('/api/token/statistics', { method: 'GET' }, '查询令牌统计');
}

export async function getAkskToken(id: string): Promise<AkskTokenInfo> {
  return akskRequest<AkskTokenInfo>(`/api/token/${encodeURIComponent(id)}`, { method: 'GET' }, '查询令牌详情');
}

export async function revokeAkskToken(id: string): Promise<void> {
  await akskRequest<void>(`/api/token/${encodeURIComponent(id)}/revoke`, { method: 'POST' }, '撤销令牌');
}

export async function revokeAkskTokensByClientId(clientId: string): Promise<{ revokedCount: number }> {
  const path = buildQuery({ clientId });
  return akskRequest<{ revokedCount: number }>(`/api/token${path}`, { method: 'DELETE' }, '批量撤销令牌');
}

export async function deleteAkskToken(id: string): Promise<void> {
  await akskRequest<void>(`/api/token/${encodeURIComponent(id)}`, { method: 'DELETE' }, '删除令牌');
}

export async function deleteAkskExpiredTokens(): Promise<{ deletedCount: number; message?: string }> {
  return akskRequest<{ deletedCount: number; message?: string }>('/api/token/expired', { method: 'DELETE' }, '清理过期令牌');
}

export interface ListAkskAuthorizationsQuery {
  page?: number;
  size?: number;
}

export async function listAkskApplicationAuthorizations(query: ListAkskAuthorizationsQuery = {}): Promise<AkskPage<AkskApplicationAuthorization>> {
  const path = buildQuery({
    page: clampAkskPage(query.page),
    size: clampAkskSize(query.size)
  });
  return akskRequest<AkskPage<AkskApplicationAuthorization>>(`/api/application-authorization${path}`, { method: 'GET' }, '查询应用授权列表');
}

export async function getAkskApplicationAuthorization(clientId: string): Promise<AkskApplicationAuthorization> {
  return akskRequest<AkskApplicationAuthorization>(`/api/application-authorization/${encodeURIComponent(clientId)}`, { method: 'GET' }, '查询应用授权');
}

export async function createAkskApplicationAuthorization(clientId: string, input: AkskApplicationAuthorizationInput): Promise<AkskApplicationAuthorization> {
  const path = buildQuery({ clientId });
  return akskRequest<AkskApplicationAuthorization>(`/api/application-authorization${path}`, {
    method: 'POST',
    body: JSON.stringify(input)
  }, '创建应用授权');
}

export async function replaceAkskApplicationAuthorization(clientId: string, input: AkskApplicationAuthorizationInput): Promise<AkskApplicationAuthorization> {
  return akskRequest<AkskApplicationAuthorization>(`/api/application-authorization/${encodeURIComponent(clientId)}`, {
    method: 'PUT',
    body: JSON.stringify(input)
  }, '保存应用授权');
}

export async function revokeAkskApplicationAuthorization(clientId: string): Promise<void> {
  await akskRequest<void>(`/api/application-authorization/${encodeURIComponent(clientId)}/revoke`, { method: 'POST' }, '撤销应用授权');
}

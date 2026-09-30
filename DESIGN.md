# simple-aksk-admin-web 设计

> 先行设计文档。本文描述目标形态与决策依据；实现进度、版本历史以 README 为准。

## 1. 定位与边界

AKSK 管理端微前端（纯门户模式）。浏览器侧管理面分两个通道，本应用只做其一：

| 通道 | 形态 | 归属 |
| --- | --- | --- |
| portal | 本仓：qiankun 子应用，数据走 `/api/**`（Bearer + API permission + DATA 过滤） | simple-aksk-admin-web |
| console | AKSK Server 内嵌 Thymeleaf 管理台（`/admin`，formLogin + session，`admin.enabled` 开关） | AKSK Server |

本应用**无独立登录壳、无会话、不复制身份能力**：登录态归门户，访问令牌由本应用在门户内经 PKCE 授权码链自动获取（谁要令牌谁自己走授权码链，门户无令牌职责）。直开（非门户加载）只显示引导页。

安全硬边界留在服务端：SecretKey 仅创建/重置一次性回显、令牌值不向管理 API 暴露、准入开关控制快照签发、整单替换撤活跃令牌。

## 2. 技术栈与挂载

与 IAM 管理端前端同栈（Vue 3.5 + TS 5.7 + Vite 6 + vite-plugin-qiankun 1.0.15 + vitest/Playwright），复用 `simple-frontend-contract`（props 契约）与 `simple-iam-theme-contract@1.0.1`（三主题 + 基础组件）。

| 项 | 值 |
| --- | --- |
| dev 端口 | 5177（strictPort） |
| 构建基路径 / routePrefix | `/app/aksk/` |
| 后端 | AKSK Server 8280（dev 经 vite proxy） |
| qiankun 子应用名 | `aksk` |

门户 props 消费（`microApps` 实际形态）：`getCurrentUser`/`currentUser`（仅展示）、`theme`（订阅）、`apiBase`（注入 API 前缀，空=同域 `/api`）、`onUnauthorized`；**`request` 通道不作数据桥**——门户 session 形态发给 `/api/**` 会因 Cookie 头触发公共层多凭据拒绝。

## 3. 令牌通道（PKCE 授权码链）

核心新增（IAM 管理端前端没有的半边）：

**发起**：无有效令牌且路由非 `/oauth-callback` 时（App 挂载或请求内核 401 触发）→ 生成 verifier+state → sessionStorage `aksk.pkce.<state> = {verifier, target}` → 整页跳 `/oauth2/authorize`（response_type=code、S256、redirect_uri=`origin + /app/aksk/ + oauth-callback`）。

**回调**（子应用路由 `/oauth-callback`）：校验 state 存在（防注入）→ 取 verifier/target → `POST /oauth2/token`（form，公共客户端无 secret、无会话）→ 令牌+过期时间落 sessionStorage → `history.replaceState` 清 URL 的 code/state → `router.replace(target)`。

**防护**：
- 令牌龄 < 60s 再遇 401 不重跳（循环防护，改报错）
- 交换失败（code 过期/已用）仅自动重走一次（`aksk.pkce.retry` 计数），再失败进错误态提示从门户重进
- 无 refresh token：过期重走授权码；门户会话过期由 IAM 登录链接管（登录后自动回原授权请求）
- IAM 会话在 → authorize 无感 302，用户零感知

**约束**：全部请求同域反代（门户 proxy `/oauth2`、`/api`），零 CORS 面；`credentials:'omit'` 是硬要求。

## 4. API 层与契约

接口契约：normal-sdks `sdk/auth/aksk/server/contract/openapi/simple-aksk-admin-web.openapi.yaml`（20 操作 = Client 7 + Token 8 + 应用授权 5，含 `POST /{clientId}/revoke` 撤销）。本仓 `src/api/akskAuth.ts` 与之一一对应；后端行为变更必须先改契约。

错误形态：管理异常为状态码 + 空 body（六类 advice），Client/Token 写端点资源不存在等走 Spring 默认 500 错误体——前端按状态码+操作上下文出文案，解析时兼容 `body.message`（有则优先）；409 → `ConflictError` 稳定标记（授权编辑器弹并发冲突对话框）；204/空 body 返 undefined；page clamp ≥1、size 1..100。

关键 DTO 事实（契约固化）：`PageResponse = {data,total,page(从1),size,totalPages}`；列表/详情 `clientSecret` 恒 null（明文仅创建/重置一次性返回）；`TokenInfoResponse` 不含令牌值；授权请求六必填（applicationCode/roles/pagePermissions/apiPermissions/manifestVersion/manifestDigest），`admitted` 缺省 false、`dataGrantDocument` 可空；DataGrantDocument 字段精确匹配（多/少均 400），operator 仅 IN，`all=true` 时 constraints 必须空数组。

## 5. 视图设计

- **ClientsView**：类型 tabs + 归属筛选 + 分页；归属筛选态出现"同步该用户全部客户端 scopes"（`PATCH /api/client?owner_user_id=`，返回 updatedCount）
- **CreateClientView**：用户级归属手输数字用户 ID+用户名（AKSK 侧无用户目录）；成功进 SecretKey 一次性回显面板（复制、"仅此一次"警示、确认后才跳详情）
- **ClientDetailView**：单字段四选一更新（服务端 if/else-if）；重置密钥 revokeTokens 复选默认 true；删除二次确认文案如实呈现级联语义（撤全部令牌+删本体，不删授权记录）
- **TokensView**：统计卡 + MySQL/Redis 源 tabs（Redis 仅状态筛选）+ 撤销/删除/按客户端批量撤销/清理过期
- **AuthorizationView/Editor**：applicationCode 创建后只读；admitted 准入开关（未准入=草稿）；三清单 textarea；数据授权文档 grant 卡片编辑器（all 勾选禁约束）+ JSON 预览/粘贴导入（精确字段校验）；PUT 整单替换；409 → 并发冲突对话框（重拉回填人工比对）；revoke 独立确认
- **StandaloneGuideView / OAuthCallbackView / ForbiddenView**：引导页 / 回调处理 / 403 呈现

纪律：Dialog/Drawer 禁 Teleport；内容区全宽流式；用户可见错误只按状态码+操作上下文出安全文案；成功态不放刷新按钮（操作后自动重拉）。

**明确不做**（有论证非遗漏）：令牌测试/内省工具——独立模式 console 已有 token-test 页承接（直调 `/oauth2/*`），门户侧复制边际价值低，待真实诉求进后续版本。

## 6. 测试设计

- vitest（jsdom）：pkce（state 校验/verifier 取用/URL 清理/限次重走/无参兜底）、akskAuth（apiBase/omit+Bearer/409/204/message 兼容/clamp）、App+引导页、五视图（密钥一次性面板、grant 卡片、409 对话框、IN 约束提交体）
- Playwright（4177 preview，e2e 构建模式烘焙测试客户端 ID）：五视图主流程、`revokeTokens=true` 参数、权限不足（403 错误态）、PKCE 全链（令牌交换 form 参数、URL 清理、目标路由恢复、后续请求携带 Bearer）

## 7. 版本对齐

v1.0.0 ↔ AKSK Server 3.1.x（外插 `simple-iam-resource-server-starter` 1.0.0）。

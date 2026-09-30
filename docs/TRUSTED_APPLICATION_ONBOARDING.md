# AKSK Web 可信应用接入手册

本文说明如何把 AKSK 管理台作为可信应用登记到 IAM，并完成从 Portal 进入、PKCE 取令牌、AKSK 授权和资源验证的闭环。

通用规则以 IAM 用户手册第 7 章为准；本文只写 AKSK 的具体取值和操作顺序。示例中的域名、编码和权限码均为脱敏值。

## 1. 角色分工

| 系统 | 负责内容 |
| --- | --- |
| IAM | 可信应用登记、Portal 可见性、OAuth Client、权限清单、人员准入与页面权限投影 |
| AKSK Server | AKP/AKU Client、应用授权快照、API permission 与 DATA grant、Token 颁发和撤销 |
| AKSK Web | 通过 IAM PKCE 获取人员 Token，并调用 AKSK Server 管理 API |
| 资源服务 | 校验 AKSK Token，执行 API permission 和 DATA 访问计划 |

AKSK Web 不保存 IAM 会话，不把 AKSK Secret 放进前端。IAM 人员 Token 只存当前浏览器会话，并以 Bearer 方式访问 AKSK Server。

## 2. IAM 侧注册

使用 IAM 管理台的“可信应用”创建流程，建议按下面的顺序填写：

| 字段 | AKSK 建议值 | 规则 |
| --- | --- | --- |
| 应用编码 | `aksk` | IAM 内唯一；创建后不修改 |
| 应用名称 | `AKSK访问凭证管理` | 用于 Portal、管理台和 Consent 展示，不使用内部项目名 |
| 图标 | `key` | 使用 IAM 受控内置图标编码，不传图片 URL |
| Portal 入口 | `https://<统一入口>/app/aksk/index.html` | 使用精确 HTTPS 地址；不要登记 `http` 或模糊目录入口 |
| routePrefix | `/app/aksk` | 与前端构建基路径一致 |
| 初始 Client 类型 | `PUBLIC` | 仅供 AKSK Web 的 PKCE 人员访问；不生成 Secret |
| 初始 Client redirect URI | `https://<统一入口>/app/aksk/oauth-callback` | 必须精确匹配，路径、协议、端口均不能省略 |
| 初始 Client PKCE | 开启 | 仅接受 S256 |
| 初始 Client Consent | 按组织策略 | 需要展示应用身份时开启；AKSK Web 本身不绕过 Consent |

保存后记录 application id 和初始 Client id。Client Secret 对 PUBLIC Client 应为空；任何 Secret 都不得复制进前端 `.env` 或浏览器存储。

## 3. Portal 菜单与默认入口

在可信应用详情中启用 Portal 集成并保存完整菜单树。AKSK Web 当前页面建议至少包含：

| 节点类型 | code | route | 页面权限 |
| --- | --- | --- | --- |
| PAGE | `aksk-clients` | `/clients` | `aksk:client:page` |
| PAGE | `aksk-my-credentials` | `/my-credentials` | `akskSelfCredential:page` |
| PAGE | `aksk-tokens` | `/tokens` | `aksk:token:page` |
| PAGE | `aksk-authorizations` | `/authorizations` | `aksk:authorization:page` |

管理员将 `/clients` 作为默认页面，普通用户将 `/my-credentials` 作为默认页面。菜单保存是整棵树快照，不能只提交搜索结果；保存后由 Portal 重新读取导航。菜单隐藏只影响展示，不能替代 AKSK Server 的 API 403。

## 4. 权限清单与人员准入

先在 IAM 可信应用中提交 AKSK 的权限清单，再为角色和用户配置授权。清单是事实源，下面的码只作示例，实际应覆盖已交付页面和管理 API：

```json
{
  "roles": ["iam_admin", "iam_user"],
  "pagePermissions": [
    "akskSelfCredential:page",
    "aksk:client:page",
    "aksk:token:page",
    "aksk:authorization:page"
  ],
  "apiPermissions": [
    "akskSelfCredential:read",
    "akskSelfCredential:create",
    "akskSelfCredential:update",
    "akskSelfCredential:delete",
    "akskClient:read",
    "akskClient:create",
    "akskClient:update",
    "akskClient:delete",
    "akskToken:read",
    "akskToken:update",
    "akskToken:delete",
    "akskApplicationAuthorization:create",
    "akskApplicationAuthorization:read",
    "akskApplicationAuthorization:update",
    "akskApplicationAuthorization:revoke"
  ]
}
```

`roles` 使用 IAM 中已经存在的角色编码，不在 AKSK Web 侧另建角色。管理员通常由
`iam_admin` 规则获得完整三权，普通用户是否可见 AKSK 及其数据范围由 IAM 的角色规则和
用户投影决定；`aksk_operator` 不是本应用的内置角色。

给管理员或操作员授予 AKSK 应用准入后，登录 Portal 应能看到 AKSK 应用和有权页面。普通用户只返回其页面权限允许的菜单；直接访问无权页面或 API 必须得到 403。

## 5. AKSK Server 侧业务应用授权

IAM 的人员授权只解决“谁能进入管理台”。AKSK Server 的应用授权则解决“这个 AKP/AKU Client 能调用哪个**业务应用**的资源”，两者不是同一份授权，也不能共用 applicationCode。

例如，`aksk` 是本管理台在 IAM 的可信应用编码；若某个 AKP 要调用 IAM 开放 API，则该 AKP 的 AKSK 应用授权应填写业务应用编码 `iam`，其 API permission 与 DATA grant 也必须来自 `iam` 的业务资源契约。

1. 在 AKSK Web 的“应用授权”中创建或打开目标 AKP/AKU Client 的授权记录。
2. 填写目标业务应用的 `applicationCode`、角色集合、API permission 集合、`dataGrantDocument`，以及该业务应用发布的 `manifestVersion`、`manifestDigest`。
3. 将 `admitted` 显式设为 `true` 后保存完整授权快照。
4. 需要变更授权时使用当前版本提交；收到 409 先重新读取，不覆盖其他管理员修改。

`scope` 只控制 OAuth 请求范围，不能代替 `apiPermissions` 或 DATA grant。没有 API permission 或 DATA grant 的 Client 必须在资源 API 上被拒绝，不能因为菜单可见而放行。

## 6. AKSK 管理 API 的 IAM 人员 Token 校验

AKSK Web 调用 `/api/**` 时携带的是 IAM 人员 Token。为使 AKSK Server 能回源校验该 Token，需在 IAM 可信应用详情中创建 Resource Verification Client：

1. 创建后只读取一次明文 secret，并立即写入 **AKSK Server** 的密钥注入系统。
2. AKSK Server 配置 IAM 的 `POST /iam/resource/tokens/verify` 地址、client id 和 secret；它回源校验 IAM 人员 Token 后，再执行管理 API 的精确权限判断。
3. secret 轮换后同步更新 AKSK Server 配置；旧 secret 不可恢复展示。

该验证客户端不是 AKSK Web 的浏览器 Client，不能放进 `VITE_*` 配置、前端代码或浏览器 Network 请求。

业务资源服务收到的是 AKSK Token 时，不使用本节的 IAM Verification Client；应按 AKSK 用户手册第 6 章配置 AKSK `/oauth2/introspect` 与 AKSK 侧明确授权的内省 Client。

## 7. 闭环验收

按以下顺序验收，任何一步失败都不能称为接入完成：

1. 管理员登录 IAM，Portal 显示“AKSK访问凭证管理”并进入 `/clients`；普通用户进入 `/my-credentials`，只能看到自己的 AKU。
2. 浏览器 Network 中，AKSK Web 通过 PKCE 获得 IAM Access Token；API 请求不携带门户 Cookie，只带 Bearer。
3. 管理员新建一个 AKP 或 AKU Client，明文 Secret 只在创建成功页出现一次。
4. 为该 Client 保存完整 AKSK 应用授权，确认 `admitted=true`。
5. 使用该 AK/SK 调 AKSK `/oauth2/token`，得到 Access Token；使用 AKSK 侧授权的内省 Client 调 `/oauth2/introspect`，断言返回的授权快照与保存内容一致。
6. 撤销应用授权或 Token，立即重新调 AKSK `/oauth2/introspect`，必须看到 `active=false` 或新的授权状态；受保护资源调用必须得到 401/403，不能继续使用旧缓存放行。
7. 撤销 IAM 用户的 AKSK 应用准入，刷新 Portal，应用和菜单消失；直接访问管理 API 仍必须得到 403。

## 8. 常见错误

| 现象 | 优先检查 |
| --- | --- |
| PKCE 回调后仍未授权 | redirect URI 是否精确 HTTPS；是否把回调写成目录；浏览器是否残留旧 sessionStorage |
| Portal 有应用但页面 403 | IAM 页面权限是否在清单中；角色规则和用户准入是否都已保存 |
| AK/SK 换 Token 被拒 | AKSK 授权是否 `admitted=true`；`applicationCode` 是否填成了 Client 名称 |
| 资源 API 403 | API permission 与 DATA grant 是否同时满足；不能只看 scope |
| 撤销后仍可访问 | 是否调用了正确的 revoke 端点；资源侧是否错误使用旧缓存或 stale fallback |

## 9. 安全边界

- 生产 Portal 入口、PKCE redirect URI 和资源验证地址统一使用 HTTPS。
- Secret、Access Token、Cookie 和完整授权 JSON 不写日志、不进前端构建产物、不提交 Git。
- 菜单隐藏、页面 403 和资源 API 403 是三道不同边界，必须分别验收。
- 本手册只描述接入流程；API 字段以 IAM/AKSK 各自 contract OpenAPI 为准。

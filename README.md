# simple-aksk-admin-web

AKSK 管理端微前端（纯门户模式）：承载 AKSK Server 的客户端凭据、令牌、应用授权管理页面，由统一应用门户以 qiankun 挂载。本应用无独立登录壳、不持会话——登录态归门户，访问令牌由本应用在门户内经 PKCE 授权码链自动获取。

独立模式的浏览器操作归 AKSK Server 内嵌管理台（Thymeleaf，`/admin`，`admin.enabled` 开关）；本应用直开时显示门户引导页，不复制任何身份能力。

## 功能总览

| 视图 | 路由 | 职责 |
| --- | --- | --- |
| 我的 AKSK 访问凭证 | `/my-credentials` | 当前登录用户自己的 AKU：按 IAM 候选应用创建、改名、轮换密钥、撤销 |
| 客户端列表 | `/clients` | AKP/AKU 类型与归属筛选、分页、启停、按归属用户同步全部客户端 scopes |
| 新建客户端 | `/clients/create` | 平台级/用户级创建；SecretKey 一次性回显（确认后才跳详情） |
| 客户端详情 | `/clients/:clientId` | 单字段更新（名称/scopes/归属）、重置密钥（revokeTokens 可选）、删除（级联撤销令牌） |
| 令牌 | `/tokens` | 统计卡、MySQL/Redis 双源列表、撤销/删除/按客户端批量撤销/清理过期 |
| 应用授权 | `/authorizations`、`/authorizations/:clientId` | 列表与编辑器：准入开关、三清单、数据授权文档（grant 卡片编辑 + JSON 导入校验）、整单替换、并发冲突处理、撤销 |

AKSK 接入 IAM 的可信应用注册、字段取值和验收顺序见 [可信应用接入手册](docs/TRUSTED_APPLICATION_ONBOARDING.md)。IAM 用户手册定义通用准入规则，本手册只补充 AKSK 的具体配置。

## 挂载与路由

- qiankun 子应用名 `aksk`，构建基路径 `/app/aksk/`，门户 routePrefix 默认 `/app/aksk`
- 路由表含 `/oauth-callback`（PKCE 回调）与 `/403`；Portal 根路由按当前用户默认进入 `/my-credentials`（管理员进入 `/clients`），未匹配路由进入 `/my-credentials`
- 门户 props 消费：`getCurrentUser`/`currentUser`（展示用）、`theme`（三主题订阅）、`apiBase`（API 前缀，空=同域 `/api` 直连）、`onUnauthorized`；门户的 session 请求通道不作数据桥
- 菜单归门户侧栏（IAM 侧可信应用登记 menus）

## 兼容性

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| AKSK Admin Web | 1.0.1 | 管理端，验收基线为下列完整组合；1.0.1 = 主题契约 1.0.5 适配 + 门户走查修复 |
| AKSK Server / Contract | 3.2.1 | 门户形态须外插 `simple-iam-resource-server-starter` 1.0.0 并配置受控验证，`/api/**` 才接受 IAM 人员令牌 |
| IAM Server / Contract | 1.3.0 | 提供 PKCE 协议端点和 IAM 人员令牌验证来源；不是本应用源码依赖 |
| `simple-iam-aksk-collaboration-starter` | 1.0.0 | AKSK 服务端的 OWNER_INHERITED 所属人授权协作适配器 |
| `@sure-zzzzzz/simple-iam-theme-contract` | 1.0.5 | 三主题 CSS 变量与基础组件（按钮/分页/抽屉/对话框/下拉/数据表）及通用样式族 |
| `@sure-zzzzzz/simple-frontend-contract` | 1.0.0（本地 link 构建） | Portal-子应用 props 契约 |

接口契约：normal-sdks 仓库 `sdk/auth/aksk/server/contract/openapi/simple-aksk-admin-web.openapi.yaml`（管理操作与当前用户自助 AKU 操作统一维护；后端行为变更先改契约）。`/oauth2/authorize`、`/oauth2/token` 是 IAM 协议端点，不在该契约内重复定义。

## 认证与令牌通道

- 数据请求固定 `credentials: 'omit'` + `Authorization: Bearer <access_token>`（公共资源层多凭据拒绝，浏览器不得携带门户 Cookie）
- 令牌获取：IAM 授权码 + PKCE（S256），client 为 IAM 可信应用下随 `initialClient` 一次建齐的公共客户端（`clientType=PUBLIC`，无 secret）
- 门户会话在 → authorize 无感 302 回回调；会话不在 → IAM 登录链接管后自动回跳
- 令牌交换失败仅自动重走一次；401 触发重授权带 60 秒循环防护；无 refresh token
- **静默授权（首进获取与续签统一）**：隐藏 iframe 内跑完整授权码链（门户会话在则全程无感），新令牌落同一 sessionStorage——首进无令牌与令牌临近过期均由此路径覆盖，主页面零刷新不丢状态；API 内核 401 驱动（静默优先并自动重放原请求，并发单飞），仅会话失效时回落整页授权链
- 令牌存 sessionStorage，键 `aksk.accessToken` / `aksk.accessTokenExpiresAt` / `aksk.pkce.*`
- 回调地址按页面 origin 推导；本机 loopback 形态下字面 `localhost` host 规范为 `127.0.0.1`（Spring Authorization Server 0.4.1 禁止 localhost 作为 redirect_uri host），生产域名不受影响

## 本地开发

环境：Node ≥ 20，pnpm 9.15.4（`npx pnpm@9.15.4 install`）。

1. 配置 `.env`（必填，参考 `.env.example`）：

   ```dotenv
   VITE_AKSK_PKCE_CLIENT_ID=<IAM 侧建好的 PKCE 公共客户端 client_id>
   ```

2. 前置服务：AKSK Server 于 `http://localhost:8280`（外插 iam-resource + verification 三件配置）；IAM Server 与统一应用门户按各自仓库启动
3. dev：`npx pnpm@9.15.4 run dev`（端口 5177，strictPort；`/api` 代理到 8280）
4. 联调链：门户（5176）登录 → 门户侧边栏进入 AKSK → 首进自动走授权码拿令牌 → 五视图主流程

## 验证

```bash
npx pnpm@9.15.4 run check          # type-check + lint + 单测(覆盖率) + build + 浏览器测试
npx pnpm@9.15.4 run dev            # 本地开发
npx pnpm@9.15.4 run build          # 生产构建
npx pnpm@9.15.4 run test:browser   # 仅浏览器测试（e2e 构建模式 + preview 4177）
```

浏览器测试使用 `.env.e2e` 的 e2e 构建模式（`vite build --mode e2e`）烘焙测试用 PKCE 客户端 ID，不进生产构建。

## 构建与部署

- 产物 `dist/`，基路径 `/app/aksk/`；本应用自成一个部署单元：`deploy/nginx.conf` 提供自带 nginx 形态——serve `/app/aksk/` 前端产物 + 反代 `/api` 到自己的 AKSK Server（容器内 `aksk-server` 主机名，起容器时 `--add-host aksk-server:host-gateway` 解析到宿主）
- 统一入口把 `/app/aksk/` 与 `/api` 指向本单元即可；`/oauth2`（IAM）与登录链归统一入口，本单元零 IAM 地址知识、零 CORS 面
- 由门户按可信应用 `entry`（形如 `<统一入口>/app/aksk/index.html`）以 qiankun 加载；直开本单元页面时，令牌缺失会经统一入口的 `/oauth2` 走授权码链补齐

## 目录结构

```
src/
  main.ts             # qiankun 生命周期 + 路由 + 主题接线
  App.vue             # standalone 壳 / 令牌自检
  akskState.ts        # 门户桥（props 消费）
  akskTheme.ts        # 主题桥
  auth/pkce.ts        # PKCE 授权码链（发起/回调/循环防护）
  api/akskAuth.ts     # 管理 API 客户端（20 操作，照契约）
  components/         # PageHeader / ConfirmDialog / EntityDrawer
  view/               # 九个视图（含引导页/回调页/403）
browser/              # Playwright 浏览器测试
```

## 关联

- 后端：normal-sdks `sure-zzzzzz:simple-aksk-server-starter`（3.2.1）
- 门户壳：`simple-unified-application-portal-web`
- 契约与主题：`sdk/auth/aksk/server/contract/`（normal-sdks）、`@sure-zzzzzz/simple-iam-theme-contract`
- IAM 可信应用通用规则：normal-sdks `sdk/auth/iam/USER_MANUAL.md` 第 7 章

# timbot-gateway

腾讯云即时通信 IM（Tencent Cloud IM）Webhook 网关代理，为 `timbot` OpenClaw 插件提供统一接入、命令控制和多 bot 路由能力。

## 功能特性

- **全局 IM 应用校验**：所有回调都会先校验 `SdkAppid` 是否等于配置的 `imApp.sdkAppId`
- **回调签名校验**：使用 `imApp.callbackToken` 校验 URL 上的 `Sign=sha256(token+RequestTime)`
- **按 timbot userId 精确路由**：单聊按 `To_Account` 查找目标 `timbot`
- **群聊智能过滤**：只有消息里明确 `@某个已注册 bot` 才转发，`@all` 直接丢弃
- **内置管理命令**：仅当 `BotManager -> AppAdmin` 的单聊命令满足权限规则时才执行
- **动态路由管理**：支持运行时添加、删除、启用、禁用路由，并自动持久化
- **健康检查**：定时检测后端节点存活状态

## 快速开始

### 安装

```bash
git clone https://github.com/Henry-li-oc/timbot-gateway.git
cd timbot-gateway
pnpm install
pnpm build
```

### 前置条件：开启 IM 回调

在 [腾讯云 IM 控制台](https://console.cloud.tencent.com/im) 中，进入**回调配置**，确保已开启以下回调：

| 回调 | 说明 |
|------|------|
| `C2C.CallbackAfterSendMsg` | **单聊消息后回调**（必须开启） |
| `Bot.OnGroupMessage` | 群聊消息回调（如需群聊路由） |

> ⚠️ 网关同时兼容 `Bot.OnC2CMessage` 和 `C2C.CallbackAfterSendMsg` 作为单聊消息回调，但推荐使用 `C2C.CallbackAfterSendMsg`。

回调 URL 填写网关地址，例如：`https://your-domain.com/timbot`

### 配置

```bash
cp timbot-gateway.example.yaml timbot-gateway.yaml
```

编辑 `timbot-gateway.yaml`：

```yaml
server:
  port: 8080
  host: "0.0.0.0"

imApp:
  sdkAppId: "1600130023"
  callbackToken: "my_token"
  secretKey: "your-real-secret-key"
  appAdmin: "administrator"
  botManager: "timbot_king"

routes:
  - timbotUserId: "bot_a"
    backend: "http://10.0.1.10:3000"
    webhookPath: "/timbot"
    enabled: true
    description: "生产环境 Bot A"
```

> ⚠️ **注意**：`backend` 只需填写到 `host:port`，不要包含路径。网关会自动拼接 `webhookPath`（默认 `/timbot`）。
> 例如：填 `http://10.0.1.10:3000` 而不是 `http://10.0.1.10:3000/timbot`。

### 启动

```bash
pnpm start
# 或指定配置文件路径
node dist/src/index.js --config /path/to/timbot-gateway.yaml
```

## 路由规则

### 单聊

- 网关先校验 `SdkAppid == imApp.sdkAppId`
- 再校验 `Sign == sha256(callbackToken + RequestTime)`
- 单聊使用 `To_Account` 去匹配 `routes[].timbotUserId`
- 如果 `To_Account` 未注册，则直接丢弃并返回 `200 OK`

### 群聊

- 网关读取群消息文本内容
- 若出现 `@all`，**直接丢弃**
- 只有当消息里明确 `@目标 bot`，且这个 bot 存在于 `routes[].timbotUserId` 中，才转发
- 未 `@bot`、`@未知 bot`、或 `To_Account` 与被 `@` 的 bot 不一致时，都会直接丢弃

## 管理命令

只有满足以下条件的单聊消息，才会触发内置命令：

- `CallbackCommand` 为 `Bot.OnC2CMessage` 或 `C2C.CallbackAfterSendMsg`
- `From_Account == imApp.botManager`
- `To_Account == imApp.appAdmin`
- 文本以 `/` 开头，且命中内置命令

命令执行后，网关会通过腾讯 IM REST API 回一条单聊消息：

- `identifier = imApp.appAdmin`
- `From_Account = imApp.appAdmin`
- `To_Account = imApp.botManager`

| 命令 | 说明 | 示例 |
|------|------|------|
| `/addbot <timbot_userid> <url> [描述]` | 添加路由 | `/addbot bot_a http://10.0.1.10:3000 生产Bot` |
| `/removebot <timbot_userid>` | 删除路由 | `/removebot bot_a` |
| `/list` | 列出所有路由 | `/list` |
| `/status` | 查看节点健康状态 | `/status` |
| `/enable <timbot_userid>` | 启用路由 | `/enable bot_a` |
| `/disable <timbot_userid>` | 禁用路由 | `/disable bot_a` |
| `/reload` | 重新加载配置文件 | `/reload` |
| `/help` | 显示帮助信息 | `/help` |

## HTTP 管理接口

```bash
curl http://localhost:8080/gateway/status
```

返回内容会包含当前 `sdkAppId`、`appAdmin`、`botManager`、每条路由的 `timbotUserId`、`backend`、启用状态和健康状态。

## 配置说明

完整配置参考 `timbot-gateway.example.yaml`。

### `imApp`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sdkAppId` | string | ✅ | 被代理 IM 应用的 SDKAppID |
| `callbackToken` | string | ❌ | 回调签名 token，默认 `my_token` |
| `secretKey` | string | ✅ | IM 应用 SecretKey，用于生成 UserSig |
| `appAdmin` | string | ✅ | 发 REST API 时使用的系统账号 |
| `botManager` | string | ✅ | 允许执行内置命令的系统账号 |
| `apiDomain` | string | ❌ | API 域名，默认 `console.tim.qq.com` |

### `routes[]`

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `timbotUserId` | string | - | timbot 的 IM userId / `To_Account`（必填） |
| `backend` | string | - | 后端节点地址，只填 `host:port`，不含路径（必填） |
| `webhookPath` | string | `/timbot` | Webhook 路径 |
| `enabled` | boolean | `true` | 是否启用 |
| `description` | string | - | 备注说明 |

## 开发

```bash
pnpm build
pnpm test
```

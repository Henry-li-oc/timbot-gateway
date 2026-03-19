/**
 * timbot-gateway 类型定义
 */

// ============================================================================
// 配置类型
// ============================================================================

/** 被代理的 IM 应用配置 */
export interface ImAppConfig {
  /** 被代理 IM 应用的 SDKAppID */
  sdkAppId: string;
  /** Webhook 回调签名 token，默认 my_token */
  callbackToken: string;
  /** 腾讯 IM 应用 SecretKey，用于生成 UserSig */
  secretKey: string;
  /** 用于调用 REST API 的系统账号，会填到 identifier / From_Account */
  appAdmin: string;
  /** 允许执行内置命令的系统账号 */
  botManager: string;
  /** 腾讯 IM API 域名，默认 console.tim.qq.com */
  apiDomain?: string;
}

/** 单条路由配置 */
export interface RouteEntry {
  /** timbot 的 IM userId，用于匹配 To_Account 与群聊 @ */
  timbotUserId: string;
  /** 后端 OpenClaw 节点地址，如 "http://10.0.1.10:3000" */
  backend: string;
  /** Webhook 路径，默认 "/timbot" */
  webhookPath: string;
  /** 是否启用 */
  enabled: boolean;
  /** 可选描述 */
  description?: string;
}

/** 健康检查配置 */
export interface HealthCheckConfig {
  /** 是否启用健康检查 */
  enabled: boolean;
  /** 检查间隔（毫秒） */
  intervalMs: number;
  /** 检查超时（毫秒） */
  timeoutMs: number;
}

/** 日志配置 */
export interface LoggingConfig {
  /** 日志级别 */
  level: "debug" | "info" | "warn" | "error";
}

/** 网关完整配置 */
export interface GatewayConfig {
  server: {
    port: number;
    host: string;
  };
  imApp: ImAppConfig;
  routes: RouteEntry[];
  healthCheck: HealthCheckConfig;
  logging: LoggingConfig;
}

// ============================================================================
// 运行时类型
// ============================================================================

/** 路由解析结果 */
export interface ResolvedRoute {
  /** 匹配到的路由条目 */
  route: RouteEntry;
  /** 完整的转发目标 URL（含 query string） */
  targetUrl: string;
  /** 提取的发送者 ID */
  fromAccount?: string;
  /** 原始请求体 Buffer（用于转发） */
  requestBody: Buffer;
}

/** 健康状态 */
export interface HealthStatus {
  /** 后端地址 */
  backend: string;
  /** 对应 timbot userId */
  timbotUserId?: string;
  /** 是否可用 */
  healthy: boolean;
  /** 最后检查时间 */
  lastCheck: number;
  /** 最后错误信息 */
  lastError?: string;
}

/** 转发结果 */
export interface ProxyResult {
  /** 响应状态码 */
  statusCode: number;
  /** 响应头 */
  headers: Record<string, string | string[] | undefined>;
  /** 响应体 */
  body: Buffer;
}

// ============================================================================
// 腾讯 IM Webhook 消息类型
// ============================================================================

/** Webhook 回调消息体 */
export interface WebhookMessage {
  CallbackCommand: string;
  From_Account?: string;
  To_Account?: string;
  MsgBody?: MsgBodyItem[];
  MsgSeq?: number;
  MsgRandom?: number;
  MsgTime?: number;
  MsgKey?: string;
  /** 群消息特有字段 */
  GroupId?: string;
  GroupName?: string;
  /** 群消息中被 @ 的机器人账号列表（Bot.OnGroupMessage 特有） */
  AtRobots_Account?: string[];
  [key: string]: unknown;
}

/** 消息体元素 */
export interface MsgBodyItem {
  MsgType: string;
  MsgContent: {
    Text?: string;
    Data?: string;
    Desc?: string;
    [key: string]: unknown;
  };
}

// ============================================================================
// 管理命令类型
// ============================================================================

/** 管理命令名称 */
export type AdminCommandName =
  | "addbot"
  | "removebot"
  | "list"
  | "status"
  | "enable"
  | "disable"
  | "reload"
  | "help";

/** 解析后的管理命令 */
export interface ParsedCommand {
  name: AdminCommandName;
  args: string[];
  rawText: string;
}

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const { initRouter } = await import("../dist/src/router.js");
const { extractMentionedTimbotUserIds, resolveRouteForWebhook, validateWebhookSignature } = await import("../dist/src/server.js");

function setupRoutes() {
  initRouter({
    server: { port: 8080, host: "0.0.0.0" },
    imApp: {
      sdkAppId: "1600130023",
      callbackToken: "my_token",
      secretKey: "test-secret-key",
      appAdmin: "administrator",
      botManager: "timbot_king",
    },
    routes: [
      {
        timbotUserId: "bot",
        backend: "http://127.0.0.1:18789",
        webhookPath: "/timbot",
        enabled: true,
      },
      {
        timbotUserId: "helper_bot",
        backend: "http://127.0.0.1:28789",
        webhookPath: "/timbot",
        enabled: true,
      },
    ],
    healthCheck: { enabled: false, intervalMs: 30000, timeoutMs: 5000 },
    logging: { level: "error" },
  });
}

describe("Server routing helpers", () => {
  beforeEach(() => {
    setupRoutes();
  });

  it("should extract distinct mentions from group text", () => {
    const mentions = extractMentionedTimbotUserIds("hello @bot and ＠helper_bot and @bot");
    assert.deepEqual(mentions.sort(), ["bot", "helper_bot"]);
  });

  it("should validate webhook signature with configured token", () => {
    const requestTime = "1773643904";
    const sign = createHash("sha256").update(`my_token${requestTime}`).digest("hex");
    const result = validateWebhookSignature(requestTime, sign, "my_token");
    assert.equal(result.ok, true);
  });

  it("should reject invalid webhook signature", () => {
    const result = validateWebhookSignature("1773643904", "bad-signature", "my_token");
    assert.equal(result.ok, false);
    assert.match(result.reason, /signature/);
  });

  it("should resolve C2C route by To_Account", () => {
    const decision = resolveRouteForWebhook({
      CallbackCommand: "Bot.OnC2CMessage",
      From_Account: "zhiheng",
      To_Account: "bot",
      MsgBody: [{ MsgType: "TIMTextElem", MsgContent: { Text: "hello" } }],
    });

    assert.equal(decision.route?.backend, "http://127.0.0.1:18789");
    assert.equal(decision.dropReason, undefined);
  });

  it("should resolve group route only when target bot is explicitly mentioned", () => {
    const decision = resolveRouteForWebhook({
      CallbackCommand: "Bot.OnGroupMessage",
      From_Account: "zhiheng",
      To_Account: "bot",
      GroupId: "group-a",
      MsgBody: [{ MsgType: "TIMTextElem", MsgContent: { Text: "@bot 帮我看一下" } }],
    });

    assert.equal(decision.route?.timbotUserId, "bot");
    assert.equal(decision.dropReason, undefined);
  });

  it("should drop group message without target mention", () => {
    const decision = resolveRouteForWebhook({
      CallbackCommand: "Bot.OnGroupMessage",
      From_Account: "zhiheng",
      To_Account: "bot",
      GroupId: "group-a",
      MsgBody: [{ MsgType: "TIMTextElem", MsgContent: { Text: "大家好" } }],
    });

    assert.equal(decision.route, undefined);
    assert.match(decision.dropReason, /did not mention target bot/);
  });

  it("should drop @all group message", () => {
    const decision = resolveRouteForWebhook({
      CallbackCommand: "Bot.OnGroupMessage",
      From_Account: "zhiheng",
      To_Account: "bot",
      GroupId: "group-a",
      MsgBody: [{ MsgType: "TIMTextElem", MsgContent: { Text: "@all 帮忙处理一下" } }],
    });

    assert.equal(decision.route, undefined);
    assert.equal(decision.dropReason, "@all is not supported");
  });

  it("should route non-message callback by To_Account", () => {
    const decision = resolveRouteForWebhook({
      CallbackCommand: "State.StateChange",
      From_Account: "system",
      To_Account: "bot",
    });

    assert.equal(decision.route?.timbotUserId, "bot");
  });
});

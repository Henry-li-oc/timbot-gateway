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

    assert.equal(decision.routes.length, 1);
    assert.equal(decision.routes[0].backend, "http://127.0.0.1:18789");
    assert.equal(decision.dropReason, undefined);
  });

  it("should resolve group route only when target bot is in AtRobots_Account", () => {
    const decision = resolveRouteForWebhook({
      CallbackCommand: "Bot.OnGroupMessage",
      From_Account: "zhiheng",
      GroupId: "group-a",
      AtRobots_Account: ["@bot"],
      MsgBody: [{ MsgType: "TIMTextElem", MsgContent: { Text: "@bot 帮我看一下" } }],
    });

    assert.equal(decision.routes.length, 1);
    assert.equal(decision.routes[0].timbotUserId, "bot");
    assert.equal(decision.dropReason, undefined);
  });

  it("should drop group message without AtRobots_Account", () => {
    const decision = resolveRouteForWebhook({
      CallbackCommand: "Bot.OnGroupMessage",
      From_Account: "zhiheng",
      GroupId: "group-a",
      MsgBody: [{ MsgType: "TIMTextElem", MsgContent: { Text: "大家好" } }],
    });

    assert.equal(decision.routes.length, 0);
    assert.match(decision.dropReason, /missing AtRobots_Account/);
  });

  it("should drop group message when AtRobots have no matching route", () => {
    const decision = resolveRouteForWebhook({
      CallbackCommand: "Bot.OnGroupMessage",
      From_Account: "zhiheng",
      GroupId: "group-a",
      AtRobots_Account: ["@RBT#unknown_bot"],
      MsgBody: [{ MsgType: "TIMTextElem", MsgContent: { Text: "@unknown_bot hello" } }],
    });

    assert.equal(decision.routes.length, 0);
    assert.match(decision.dropReason, /no matching route for AtRobots/);
  });

  it("should drop unsupported CallbackCommand", () => {
    const decision = resolveRouteForWebhook({
      CallbackCommand: "State.StateChange",
      From_Account: "system",
      To_Account: "bot",
    });

    assert.equal(decision.routes.length, 0);
    assert.match(decision.dropReason, /unsupported CallbackCommand/);
  });

  it("should resolve C2C route via C2C.CallbackAfterSendMsg", () => {
    const decision = resolveRouteForWebhook({
      CallbackCommand: "C2C.CallbackAfterSendMsg",
      From_Account: "zhiheng",
      To_Account: "@bot",
      MsgBody: [{ MsgType: "TIMTextElem", MsgContent: { Text: "hi" } }],
    });

    assert.equal(decision.routes.length, 1);
    assert.equal(decision.routes[0].timbotUserId, "bot");
    assert.equal(decision.dropReason, undefined);
  });

  it("should return ALL matched bots when multiple bots are @mentioned", () => {
    const decision = resolveRouteForWebhook({
      CallbackCommand: "Bot.OnGroupMessage",
      From_Account: "zhiheng",
      GroupId: "group-b",
      AtRobots_Account: ["@unknown_robot", "@helper_bot", "@bot"],
      MsgBody: [{ MsgType: "TIMTextElem", MsgContent: { Text: "@unknown_robot @helper_bot @bot" } }],
    });

    // unknown_robot 无路由，helper_bot 和 bot 都应返回
    assert.equal(decision.routes.length, 2);
    assert.equal(decision.routes[0].timbotUserId, "helper_bot");
    assert.equal(decision.routes[1].timbotUserId, "bot");
    assert.equal(decision.dropReason, undefined);
  });

  it("should drop group message with empty AtRobots_Account array", () => {
    const decision = resolveRouteForWebhook({
      CallbackCommand: "Bot.OnGroupMessage",
      From_Account: "zhiheng",
      GroupId: "group-a",
      AtRobots_Account: [],
      MsgBody: [{ MsgType: "TIMTextElem", MsgContent: { Text: "hello" } }],
    });

    assert.equal(decision.routes.length, 0);
    assert.match(decision.dropReason, /missing AtRobots_Account/);
  });

  it("should drop C2C message with missing To_Account", () => {
    const decision = resolveRouteForWebhook({
      CallbackCommand: "Bot.OnC2CMessage",
      From_Account: "zhiheng",
    });

    assert.equal(decision.routes.length, 0);
    assert.match(decision.dropReason, /missing To_Account/);
  });
});

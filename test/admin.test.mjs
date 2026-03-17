import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const { initRouter } = await import("../dist/src/router.js");
const adminModule = await import("../dist/src/admin.js");

const originalFetch = global.fetch;

function setupTestRouter() {
  initRouter({
    server: { port: 8080, host: "0.0.0.0" },
    imApp: {
      sdkAppId: "1600130023",
      callbackToken: "my_token",
      secretKey: "test-secret-key",
      appAdmin: "administrator",
      botManager: "timbot_king",
      apiDomain: "console.tim.qq.com",
    },
    routes: [
      {
        timbotUserId: "bot-alpha",
        backend: "http://10.0.1.10:3000",
        webhookPath: "/timbot",
        enabled: true,
        description: "Test Bot A",
      },
    ],
    healthCheck: { enabled: false, intervalMs: 30000, timeoutMs: 5000 },
    logging: { level: "error" },
  });
}

function createWebhookMessage(fromAccount, text, toAccount = "administrator") {
  return {
    CallbackCommand: "Bot.OnC2CMessage",
    From_Account: fromAccount,
    To_Account: toAccount,
    MsgBody: [
      {
        MsgType: "TIMTextElem",
        MsgContent: { Text: text },
      },
    ],
  };
}

describe("Admin Command - permission control", () => {
  beforeEach(() => {
    setupTestRouter();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("should reject non-manager user", async () => {
    let fetchCalled = false;
    global.fetch = async () => {
      fetchCalled = true;
      return { json: async () => ({ ActionStatus: "OK" }) };
    };

    const msg = createWebhookMessage("non_admin_user", "/list");
    const result = await adminModule.handleAdminMessage(msg);
    assert.equal(result, false);
    assert.equal(fetchCalled, false);
  });

  it("should reject command sent to non-AppAdmin account", async () => {
    let fetchCalled = false;
    global.fetch = async () => {
      fetchCalled = true;
      return { json: async () => ({ ActionStatus: "OK" }) };
    };

    const msg = createWebhookMessage("timbot_king", "/list", "other-account");
    const result = await adminModule.handleAdminMessage(msg);
    assert.equal(result, false);
    assert.equal(fetchCalled, false);
  });

  it("should allow BotManager to execute command and reply from AppAdmin", async () => {
    let fetchCalled = false;
    global.fetch = async (url, options) => {
      fetchCalled = true;
      const body = JSON.parse(options.body);
      assert.match(String(url), /openim\/sendmsg/);
      assert.match(String(url), /sdkappid=1600130023/);
      assert.equal(body.To_Account, "timbot_king");
      assert.equal(body.From_Account, "administrator");
      assert.equal(Number.isInteger(body.MsgRandom), true);
      assert.ok(body.MsgRandom > 0);
      return { json: async () => ({ ActionStatus: "OK" }) };
    };

    const msg = createWebhookMessage("timbot_king", "/list");
    const result = await adminModule.handleAdminMessage(msg);
    assert.equal(result, true);
    assert.equal(fetchCalled, true);
  });

  it("should ignore empty messages", async () => {
    global.fetch = async () => ({ json: async () => ({ ActionStatus: "OK" }) });
    const msg = {
      CallbackCommand: "Bot.OnC2CMessage",
      From_Account: "timbot_king",
      To_Account: "administrator",
      MsgBody: [],
    };
    const result = await adminModule.handleAdminMessage(msg);
    assert.equal(result, false);
  });

  it("should ignore non-command messages", async () => {
    global.fetch = async () => ({ json: async () => ({ ActionStatus: "OK" }) });
    const msg = createWebhookMessage("timbot_king", "hello, just chatting");
    const result = await adminModule.handleAdminMessage(msg);
    assert.equal(result, false);
  });
});

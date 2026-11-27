const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { randomBytes, createCipheriv, createDecipheriv } = require("node:crypto");
const { createLocalAuth, COOKIE_NAME } = require("../src/localAuth");
const { createRememberedLogin } = require("../src/rememberedLogin");
const { installAuth } = require("../src/authRoutes");

async function temp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "local-auth-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

test("local user is created once and stores only a salted password verifier", async (t) => {
  const filePath = path.join(await temp(t), "user.json");
  const auth = createLocalAuth({ filePath });
  assert.equal(await auth.isConfigured(), false);
  await assert.rejects(auth.setup("contas", "short"), /8 e 256/);
  await auth.setup("Contas", "a-test-password");
  assert.equal(await auth.isConfigured(), true);
  const stored = await fs.readFile(filePath, "utf8");
  assert.doesNotMatch(stored, /a-test-password/);
  assert.equal(JSON.parse(stored).passwordHash.length, 128);
  await assert.rejects(auth.setup("another", "another-password"), (e) => e.status === 409);
  await assert.rejects(auth.login("contas", "wrong-password"), (e) => e.status === 401);
  await assert.rejects(auth.login("someone", "a-test-password"), (e) => e.status === 401);
  const { token } = await auth.login("contas", "a-test-password");
  assert.deepEqual(auth.sessionForToken(token), { username: "Contas" });
  assert.equal(createLocalAuth({ filePath }).sessionForToken(token), null, "sessions do not survive server restart");
});

test("sessions expire and logout revokes the token", async (t) => {
  let clock = 10000;
  const auth = createLocalAuth({ filePath: path.join(await temp(t), "user.json"), now: () => clock });
  const token = auth.createSession("fixture");
  const req = { headers: { cookie: `${COOKIE_NAME}=${token}` } };
  assert.equal(auth.sessionForRequest(req).username, "fixture");
  auth.logout(req);
  assert.equal(auth.sessionForRequest(req), null);
  const expired = auth.createSession("fixture");
  clock += 8 * 60 * 60 * 1000 + 1;
  assert.equal(auth.sessionForToken(expired), null);
});

test("invalid login attempts are bounded", async (t) => {
  let clock = 10000;
  const auth = createLocalAuth({ filePath: path.join(await temp(t), "user.json"), now: () => clock });
  await auth.setup("contas", "a-test-password");
  for (let i = 0; i < 8; i++) await assert.rejects(auth.login("contas", "incorrect"), (e) => e.status === 401);
  await assert.rejects(auth.login("contas", "a-test-password"), (e) => e.status === 429);
  clock += 15 * 60 * 1000 + 1;
  assert.ok((await auth.login("contas", "a-test-password")).token);
});

test("saved login uses the encryption adapter and never falls back to plaintext", async (t) => {
  const dir = await temp(t);
  const filePath = path.join(dir, "remembered.bin");
  const key = randomBytes(32);
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (text) => {
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
      const content = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), content]);
    },
    decryptString: (buffer) => {
      const cipher = createDecipheriv("aes-256-gcm", key, buffer.subarray(0, 12));
      cipher.setAuthTag(buffer.subarray(12, 28));
      return Buffer.concat([cipher.update(buffer.subarray(28)), cipher.final()]).toString("utf8");
    }
  };
  const saved = createRememberedLogin({ filePath, encryption });
  const credentials = { username: "contas", password: "private-fixture-password" };
  await saved.save(credentials);
  assert.equal((await fs.readFile(filePath)).includes(Buffer.from(credentials.password)), false);
  assert.deepEqual(await saved.read(), credentials);
  const unavailable = createRememberedLogin({ filePath, encryption: { isEncryptionAvailable: () => false } });
  assert.equal(await unavailable.read(), null);
  await assert.rejects(unavailable.save(credentials), /Windows/);
  assert.deepEqual(await saved.read(), credentials);
  await saved.clear();
  assert.equal(await saved.read(), null);
});

test("HTTP login protects pages and APIs, blocks foreign origins and revokes logout", async (t) => {
  const app = express();
  app.locals.auth = createLocalAuth({ filePath: path.join(await temp(t), "user.json") });
  app.use(express.json());
  installAuth(app);
  app.use(express.static(path.resolve("public")));
  app.post("/api/private", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (endpoint, data, extra = {}) => fetch(base + endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...extra }, body: JSON.stringify(data) });
  const root = await fetch(base, { redirect: "manual" });
  assert.equal(root.headers.get("location"), "/login");
  assert.equal((await fetch(base + "/menu", { redirect: "manual" })).headers.get("location"), "/login");
  assert.equal((await fetch(base + "/notas-automaticas", { redirect: "manual" })).headers.get("location"), "/login");
  assert.equal((await post("/api/private", {})).status, 401);
  assert.equal((await fetch(base + "/app.js", { redirect: "manual" })).status, 302);
  assert.equal((await post("/api/auth/setup", { username: "contas", password: "test-password" }, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await (await fetch(base + "/api/auth/status")).json()).configured, false);
  const setup = await post("/api/auth/setup", { username: "contas", password: "test-password" });
  assert.equal(setup.status, 200);
  assert.match(setup.headers.get("set-cookie"), /HttpOnly/i);
  assert.match(setup.headers.get("set-cookie"), /SameSite=Strict/i);
  assert.doesNotMatch(JSON.stringify(await setup.json()), /test-password|passwordHash|token/);
  const cookie = setup.headers.get("set-cookie").split(";")[0];
  assert.equal((await post("/api/private", {}, { Cookie: cookie })).status, 200);
  assert.equal((await fetch(base + "/consultas", { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(base + "/menu", { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(base + "/notas-automaticas", { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(base, { redirect: "manual", headers: { Cookie: cookie } })).headers.get("location"), "/menu");
  assert.equal((await post("/api/auth/setup", { username: "other", password: "other-password" })).status, 409);
  assert.equal((await post("/api/auth/login", { username: "contas", password: "incorrect" })).status, 401);
  await post("/api/auth/logout", {}, { Cookie: cookie });
  assert.equal((await post("/api/private", {}, { Cookie: cookie })).status, 401);
});

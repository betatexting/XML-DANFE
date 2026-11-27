const test = require("node:test");
const assert = require("node:assert/strict");
const tls = require("tls");
const path = require("path");
const https = require("https");
const { X509Certificate, createHash } = require("crypto");
const { chromium } = require("playwright-core");
const { loadIcpRoot, ICP_ROOT_SHA256, verifyTlsEndpoint } = require("../src/sefazTls");
const fixture = require("./fixtures/sefaz-tls.json");
async function serverFor(t, certificate) {
  const server = https.createServer({ key: fixture.key, cert: certificate }, (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<input id="login" value="synthetic">'); });
  const sockets = new Set();
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.on("tlsClientError", () => {});
  server.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => { for (const socket of sockets) socket.destroy(); server.close(resolve); }));
  return server.address().port;
}
test("the bundled ICP-Brasil root has the independently published fingerprint and valid self-signature", async () => {
  const certificate = new X509Certificate(await loadIcpRoot());
  assert.equal(certificate.fingerprint256.replace(/:/g, ""), ICP_ROOT_SHA256);
  assert.equal(certificate.ca, true); assert.equal(certificate.verify(certificate.publicKey), true);
});
test("TLS preflight checks chain, hostname and expiration before issuing a leaf-public-key pin", async (t) => {
  const port = await serverFor(t, fixture.valid);
  const verified = await verifyTlsEndpoint({ host: "127.0.0.1", port, servername: "localhost", ca: [fixture.root] });
  const certificate = new X509Certificate(fixture.valid);
  assert.equal(verified.spki, createHash("sha256").update(certificate.publicKey.export({ type: "spki", format: "der" })).digest("base64"));
  assert.equal(verified.fingerprint256, certificate.fingerprint256);
  await assert.rejects(verifyTlsEndpoint({ host: "127.0.0.1", port, servername: "localhost", ca: tls.rootCertificates }));
  await assert.rejects(verifyTlsEndpoint({ host: "127.0.0.1", port, servername: "wrong.invalid", ca: [fixture.root] }));
  const expired = await serverFor(t, fixture.expired);
  await assert.rejects(verifyTlsEndpoint({ host: "127.0.0.1", port: expired, servername: "localhost", ca: [fixture.root] }));
  const wrong = await serverFor(t, fixture.wrongHost);
  await assert.rejects(verifyTlsEndpoint({ host: "127.0.0.1", port: wrong, servername: "localhost", ca: [fixture.root] }));
});
test("headless compatibility is limited to the verified leaf key, with no global ignoreHTTPSErrors", async (t) => {
  const port = await serverFor(t, fixture.valid);
  const verified = await verifyTlsEndpoint({ host: "127.0.0.1", port, servername: "localhost", ca: [fixture.root] });
  const executablePath = path.resolve(".playwright-browsers/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe");
  const browser = await chromium.launch({ executablePath, headless: true, args: [`--ignore-certificate-errors-spki-list=${verified.spki}`] });
  t.after(() => browser.close());
  const context = await browser.newContext(); const page = await context.newPage(); page.setDefaultTimeout(5000);
  assert.equal((await page.goto(`https://localhost:${port}`)).status(), 200);
  assert.equal(await page.locator('#login').inputValue(), 'synthetic');
});

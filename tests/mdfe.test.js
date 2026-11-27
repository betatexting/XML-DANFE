const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { installMdfeRoutes, inspectDownloadPage } = require("../src/mdfeConsulta");
const { downloadOwnManifest } = require("../src/mdfeDownload");

test("MDF-e portal separates access denial, unexpected response, unknown form and challenge", () => {
  const inspect = (httpStatus, data, extra) => inspectDownloadPage({ httpStatus, contentType: "text/html", data, ...extra });
  assert.equal(inspect(403).state, "denied");
  assert.equal(inspect(302, "", { location: "/Erro/Forbidden" }).state, "denied");
  assert.equal(inspect(503).state, "unexpected");
  assert.equal(inspect(429).state, "rate_limited");
  assert.equal(inspect(200, "<p>IP não autorizado devido múltiplas consultas</p>").state, "rate_limited");
  assert.equal(inspect(200, '<form id="frmBuscaGeral"><input name="palavraschave"></form>').state, "unidentified");
  assert.deepEqual(inspect(200, '<form id="frmDownloadXmlDfe"><input name="chave"><input name="data"><div class="g-recaptcha"></div></form>'),
    { state: "form", httpStatus: 200, filters: ["key", "period"], challenge: true });
});

test("MDF-e XML distinguishes navigation failure, refusal, unexpected page and verification", async () => {
  for (const [status, expected] of [
    [null, "mdfe_portal_access_failed"],
    [403, "mdfe_portal_denied"],
    [503, "mdfe_portal_unexpected"],
    [200, "mdfe_challenge_required"],
    [200, "mdfe_portal_rate_limited"]
  ]) {
    let closed = false;
    const page = {
      setDefaultTimeout() {},
      async goto() { if (!status) throw new Error("network"); return { status: () => status }; },
      url: () => "https://dfe-portal.svrs.rs.gov.br/MDFESSL/DownloadXMLDFe",
      getByText: () => ({ count: async () => Number(expected === "mdfe_portal_rate_limited") }),
      locator: () => ({ count: async () => 1 })
    };
    const launch = async () => ({
      newContext: async () => ({ route: async () => {}, newPage: async () => page }),
      close: async () => { closed = true; }
    });
    await assert.rejects(downloadOwnManifest("", {}, { launch }), { code: expected });
    assert.equal(closed, true);
  }
});

test("MDF-e route keeps absence, tax rejection, transport and download failures distinct", async (t) => {
  const app = express();
  app.use(express.json());
  const key = "29261114078646000104580010000000011000000001";
  const outcomes = [];
  let reply;
  let downloadCode = "mdfe_download_unavailable";
  let certificateDocument = key.slice(6, 20);
  app.locals.companyCatalog = {
    list: async () => ({ companies: [{ id: "test", cnpj: key.slice(6, 20) }] }),
    loadCertificate: async () => ({ pfx: Buffer.alloc(1), cnpj: certificateDocument })
  };
  installMdfeRoutes(app, {
    query: async () => { if (reply instanceof Error) throw reply; return reply; },
    download: async () => { throw Object.assign(new Error(), { code: downloadCode }); },
    record: async (row) => outcomes.push(row.result)
  });
  const server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  t.after(() => server.close());
  const post = (mode, accessKey = key) => fetch(`http://127.0.0.1:${server.address().port}/api/companies/test/mdfe/${mode}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: accessKey })
  });
  for (const [mode, status, result] of [
    ["open", "112", "empty"],
    ["open", "203", "svrs_rejected"],
    ["situation", "217", "manifest_not_found"],
    ["status", "109", "svrs_response"]
  ]) {
    reply = { status, manifests: [] };
    const response = await post(mode);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, status);
    assert.equal(outcomes.at(-1), result);
  }
  reply = Object.assign(new Error(), { code: "ETIMEDOUT" });
  assert.equal((await post("open")).status, 502);
  const download = await post("xml");
  assert.equal(download.status, 502);
  assert.equal((await download.json()).code, "mdfe_download_unavailable");
  downloadCode = "mdfe_certificate_not_authorized";
  const denied = await post("xml");
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, downloadCode);
  reply = { status: "100", protocol: "129260000000001" };
  const branchKey = key.slice(0, 14) + "000368" + key.slice(20);
  assert.equal((await post("situation", branchKey)).status, 200);
  assert.equal((await post("xml", branchKey)).status, 403);
  assert.equal(outcomes.at(-1), downloadCode);
  const otherRootKey = key.slice(0, 6) + "99999999" + key.slice(14);
  assert.equal((await post("xml", otherRootKey)).status, 400);
  assert.equal(outcomes.at(-1), "invalid_key");
  certificateDocument = "99999999000100";
  assert.equal((await post("xml", branchKey)).status, 403);
  assert.equal(outcomes.at(-1), "certificate_base_mismatch");
});

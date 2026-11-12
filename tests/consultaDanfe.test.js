const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const {
  extractXmlFromApiPayload,
  processAccessKeys,
  requestXmlForKey
} = require("../src/consultaDanfe");

const originalFetch = global.fetch;

test("extractXmlFromApiPayload should support direct xml and base64 xml", () => {
  const xml = "<?xml version=\"1.0\"?><nfe></nfe>";

  assert.equal(extractXmlFromApiPayload({ xml }), xml);
  assert.equal(
    extractXmlFromApiPayload({
      xml_base64: Buffer.from(xml, "utf8").toString("base64")
    }),
    xml
  );
});

test("requestXmlForKey should return xml from documented payload", async (t) => {
  const xml = "<?xml version=\"1.0\"?><nfe></nfe>";

  global.fetch = async () =>
    new Response(
      JSON.stringify({
        status: "ok",
        chave: "123",
        xml_base64: Buffer.from(xml, "utf8").toString("base64")
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

  t.after(() => {
    global.fetch = originalFetch;
  });

  const result = await requestXmlForKey("35260444823938000187551090000002691092067649");
  assert.equal(result, xml);
});

test("requestXmlForKey should expose API validation messages", async (t) => {
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        error: "chave_invalida",
        message: "A chave enviada nao e valida."
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

  t.after(() => {
    global.fetch = originalFetch;
  });

  await assert.rejects(
    requestXmlForKey("invalida"),
    /A chave enviada nao e valida\./
  );
});

test("processAccessKeys should save xml files returned by the API", async (t) => {
  const xml = "<?xml version=\"1.0\"?><nfe></nfe>";
  const downloadsDir = await fs.mkdtemp(path.join(os.tmpdir(), "consulta-danfe-test-"));

  global.fetch = async () =>
    new Response(
      JSON.stringify({
        status: "ok",
        xml_base64: Buffer.from(xml, "utf8").toString("base64")
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

  t.after(async () => {
    global.fetch = originalFetch;
    await fs.rm(downloadsDir, { recursive: true, force: true });
  });

  const [result] = await processAccessKeys({
    keys: ["35260444823938000187551090000002691092067649"],
    downloadsDir
  });

  assert.equal(result.status, "success");
  assert.equal(result.filePath, path.join(downloadsDir, "44823938000187", "2026-04", "35260444823938000187551090000002691092067649.xml"));
  assert.match(result.filePath, /35260444823938000187551090000002691092067649\.xml$/);

  const savedXml = await fs.readFile(result.filePath, "utf8");
  assert.equal(savedXml, `${xml}\n`);
});

test("processAccessKeys should expose window errors without inventing extra retries", async (t) => {
  const downloadsDir = await fs.mkdtemp(path.join(os.tmpdir(), "consulta-danfe-test-"));

  global.fetch = async () =>
    new Response(
      JSON.stringify({
        error: "data_fora_da_janela",
        message: "A API nao pode coletar essa chave nesta data."
      }),
      {
        status: 422,
        headers: {
          "Content-Type": "application/json",
          "x-error-code": "data_fora_da_janela"
        }
      }
    );

  t.after(async () => {
    global.fetch = originalFetch;
    await fs.rm(downloadsDir, { recursive: true, force: true });
  });

  const [result] = await processAccessKeys({
    keys: ["35260444823938000187551090000002691092067649"],
    downloadsDir
  });

  assert.equal(result.status, "error");
  assert.equal(result.errorCode, "data_fora_da_janela");
  assert.equal(result.fallbackEligible, true);
  assert.equal(result.attemptCount, 1);
  assert.doesNotMatch(result.message, /Falha apos 3 tentativas/i);
  assert.match(result.message, /janela da API publica/i);
});

const { chromium } = require("playwright-core");
const { parseXml } = require("./localXml");

const PORTAL_URL = "https://dfe-portal.svrs.rs.gov.br/MDFESSL/DownloadXMLDFe";
const origin = new URL(PORTAL_URL).origin;
const maxBytes = 4 * 1024 * 1024;
const timeout = 15000;
const child = (node, name) => node?.children.find((item) => item.name === name);
const value = (node, name) => child(node, name)?.text.trim();
const downloadError = (code) => Object.assign(new Error(code), { code });

function validateManifestXml(buffer, key) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > maxBytes) throw downloadError("mdfe_xml_invalid");
  let root;
  try { root = parseXml(buffer.toString("utf8")); }
  catch { throw downloadError("mdfe_xml_invalid"); }
  const info = child(child(root, "mdfe"), "infmdfe");
  const protocol = child(child(root, "protmdfe"), "infprot");
  const issuer = child(info, "emit");
  const issuerDocument = value(issuer, "cnpj") || value(issuer, "cpf") || "";
  if (root.name !== "mdfeproc" || !/^\d{20}58\d{22}$/.test(key) ||
      Object.values(info?.attributes || {}).find(({ local }) => local === "Id")?.value !== `MDFe${key}` ||
      issuerDocument.padStart(14, "0") !== key.slice(6, 20) || value(child(info, "ide"), "mod") !== "58" ||
      value(protocol, "chmdfe") !== key || value(protocol, "cstat") !== "100" ||
      !/^\d{15}$/.test(value(protocol, "nprot") || "")) {
    throw downloadError("mdfe_xml_invalid");
  }
  return buffer;
}

async function launchBrowser() {
  for (const options of [{ channel: "msedge" }, { channel: "chrome" }, {}]) {
    try { return await chromium.launch({ ...options, headless: true, timeout: 8000 }); }
    catch { /* Try the next installed Chromium browser. */ }
  }
  throw downloadError("mdfe_browser_unavailable");
}

async function readDownload(download) {
  const stream = await download.createReadStream();
  if (!stream) throw downloadError("mdfe_download_unavailable");
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > maxBytes) throw downloadError("mdfe_xml_invalid");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function downloadOwnManifest(key, certificate, { launch = launchBrowser } = {}) {
  const browser = await launch();
  try {
    const context = await browser.newContext({
      clientCertificates: [{ origin, pfx: certificate.pfx, passphrase: certificate.passphrase }],
      acceptDownloads: true
    });
    await context.route("**/*", (route) => {
      const target = new URL(route.request().url());
      return target.origin === origin ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    const response = await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout })
      .catch((cause) => { throw Object.assign(downloadError("mdfe_portal_access_failed"), { cause }); });
    const httpStatus = response?.status();
    if (httpStatus === 429) throw Object.assign(downloadError("mdfe_portal_rate_limited"), { httpStatus });
    if ([401, 403].includes(httpStatus) || /^\/erro\/forbidden\/?$/i.test(new URL(page.url()).pathname)) {
      throw Object.assign(downloadError("mdfe_portal_denied"), { httpStatus });
    }
    if (httpStatus !== 200) throw Object.assign(downloadError("mdfe_portal_unexpected"), { httpStatus });
    const rateLimitMessage = page.getByText(/^IP não autorizado devido múltiplas consultas$/i);
    const certificateMismatch = page.getByText(/CNPJ base do certificado digital.*difere do CNPJ base dos envolvidos/i);
    if (await rateLimitMessage.count()) throw downloadError("mdfe_portal_rate_limited");
    const challenge = page.locator(".g-recaptcha, .h-captcha, [data-sitekey], img[id*='captcha' i], iframe[src*='captcha' i]");
    if (await challenge.count()) throw downloadError("mdfe_challenge_required");
    const fields = page.locator("#frmDownloadXmlDfe input[name='ChaveAcessoDfe']:visible");
    if (await fields.count() !== 1) throw downloadError("mdfe_form_unidentified");
    const input = fields.first();
    const form = input.locator("xpath=ancestor::form[1]");
    const submit = form.locator("button:visible, input[type='submit']:visible");
    const labeled = form.getByRole("button", { name: /baixar|download|consultar|buscar/i });
    const button = await labeled.count() === 1 ? labeled : submit;
    if (await button.count() !== 1) throw downloadError("mdfe_form_unidentified");
    await input.fill(key);
    const result = Promise.any([
      page.waitForEvent("download", { timeout }).then(readDownload).then((buffer) => validateManifestXml(buffer, key)),
      page.waitForResponse((item) => {
        if (!item.ok() || new URL(item.url()).origin !== origin) return false;
        const type = item.headers()["content-type"] || "";
        return /^(?:application|text)\/(?:[\w.+-]+\+)?xml\b/i.test(type);
      }, { timeout }).then(async (item) => {
        if (Number(item.headers()["content-length"]) > maxBytes) throw downloadError("mdfe_xml_invalid");
        return validateManifestXml(await item.body(), key);
      }),
      rateLimitMessage.waitFor({ state: "visible", timeout }).then(() => downloadError("mdfe_portal_rate_limited")),
      certificateMismatch.waitFor({ state: "visible", timeout }).then(() => downloadError("mdfe_certificate_not_authorized"))
    ]);
    result.catch(() => {});
    await button.click({ noWaitAfter: true });
    let buffer;
    try { buffer = await result; }
    catch (error) {
      if (error.errors?.some(({ code }) => code === "mdfe_xml_invalid")) throw downloadError("mdfe_xml_invalid");
      if (await challenge.count()) throw downloadError("mdfe_challenge_required");
      throw downloadError("mdfe_download_unavailable");
    }
    if (buffer instanceof Error) throw buffer;
    return buffer;
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { PORTAL_URL, downloadOwnManifest, validateManifestXml };

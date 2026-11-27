const fs = require("fs/promises");
const tls = require("node:tls");
const { chromium } = require("playwright-core");
const { loadIcpRoot, verifySefazTlsTrust } = require("./sefazTls");
const { collectMdfeNfeEvents } = require("./mdfeNfeEvents");
const BASE_URL = "https://nfe.sefaz.ba.gov.br";
const PATH = "/servicos/nfenc/Modulos/Autenticado/Restrito/";
const SELECTORS = {
  login: ["#PHCentro_userLogin", '[name="PHCentro$userLogin"]'],
  password: ["#PHCentro_userPass", '[name="PHCentro$userPass"]'],
  enter: ['label[for="PHCentro_btnLogin"]', "#PHCentro_btnLogin", "button[id$='btnLogin']", "input[id$='btnLogin']"],
  period: ["#rbt_filtro3"], from: ["#txtPeriodoInicial", "input[id$='txtDataAutorizacaoInicio']"],
  to: ["#txtPeriodoFinal", "input[id$='txtDataAutorizacaoFim']"],
  consult: ["#AplicarFiltro", "button[id$='btnConsultar']", "input[id$='btnConsultar']", "xpath=/html/body/table/tbody/tr/td/table[2]/tbody/tr/td/form/div[3]/table[6]/tbody/tr/td[1]/input"],
  export: ["#btn_GeraPlanilha", "#btn_GerarPlanilha", "input[value='Gerar Planilha']"],
  captcha: ["#img_captcha"], captchaInput: ["#txt_cod_antirobo"]
};
class PortalError extends Error { constructor(code, message) { super(message); this.code = code; } }
function checkAbort(signal) { if (signal?.aborted) throw new PortalError("cancelled", "Coleta cancelada."); }
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function within(promise, timeout) {
  let timer;
  try { return await Promise.race([promise, new Promise((resolve) => { timer = setTimeout(resolve, timeout); })]); }
  finally { clearTimeout(timer); }
}
async function visible(page, choices) {
  for (const selector of choices) {
    const items = page.locator(selector);
    for (let index = 0; index < await items.count(); index++) if (await items.nth(index).isVisible()) return items.nth(index);
  }
  return null;
}
async function waitUntil(fn, timeout, signal, code, message) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    checkAbort(signal);
    try { const value = await fn(); if (value) return value; }
    catch (error) { if (error instanceof PortalError || !/execution context|context was destroyed|navigation/i.test(error.message || "")) throw error; }
    await pause(150);
  }
  throw new PortalError(code, message);
}
async function launchPortalBrowser(options = {}) {
  let trust;
  try { trust = await verifySefazTlsTrust(); }
  catch { throw new PortalError("portal_tls_error", "Não foi possível validar a cadeia HTTPS e o domínio da SEFAZ."); }
  const candidates = options.executablePath ? [{ executablePath: options.executablePath }] : options.channel ? [{ channel: options.channel }] : [{ channel: "msedge" }, { channel: "chrome" }, {}];
  for (const candidate of candidates) {
    try {
      // Chromium does not share Node's explicit ICP-Brasil trust anchor and may
      // reject this national chain/CT policy. Scope compatibility to the LEAF
      // public key just verified above, never to all certificates or a CA key.
      const browser = await chromium.launch({ ...candidate, headless: options.headless ?? true, args: ["--lang=pt-BR", `--ignore-certificate-errors-spki-list=${trust.spki}`] });
      browser.sefazTlsTrust = trust;
      return browser;
    } catch { /* Try another installed browser. */ }
  }
  throw new PortalError("browser_unavailable", "Não foi possível iniciar o navegador de consultas.");
}
let portalTrust;
async function installPasswordTransport(context, origin, timeout) {
  if (origin === BASE_URL) {
    portalTrust ||= loadIcpRoot().then((root) => {
      const trusted = tls.getCACertificates();
      if (!trusted.includes(root)) tls.setDefaultCACertificates([...trusted, root]);
    }).catch((error) => { portalTrust = null; throw error; });
    await portalTrust;
  }
  await context.route((url) => url.origin === origin, async (route) => {
    let response;
    try {
      // The password flow uses HTTP requests without a client certificate.
      // Preserve the portal's response and cookies in the browser session.
      response = await route.fetch({ maxRedirects: 0, timeout });
      await route.fulfill({ response });
    } catch {
      await route.abort().catch(() => {});
    } finally {
      await response?.dispose().catch(() => {});
    }
  });
}
async function collectSefazBa({ credentials, from, to, directions = ["saidas", "entradas"], includeMdfeEvents = false, onStage = async () => {}, onFile, onEmpty = async () => {}, solveCaptcha, signal, launch = launchPortalBrowser, baseURL = BASE_URL, timeout = 30000, downloadTimeout = 90000 }) {
  let browser, context, page, closingBrowser, alertCode = null;
  const origin = new URL(baseURL).origin;
  const reportURL = (direction) => `${origin}${PATH}NFENC_consulta_${direction === "saidas" ? "emitente" : "destinatario"}.aspx`;
  const safeOrigin = () => { if (new URL(page.url()).origin !== origin) throw new PortalError("unexpected_origin", "O portal redirecionou para um endereço inesperado."); };
  const stage = async (name, detail = {}) => { checkAbort(signal); await onStage(name, detail); };
  const closeBrowser = () => {
    if (browser && !closingBrowser) closingBrowser = browser.close().catch(() => {});
    return closingBrowser;
  };
  const closeOnAbort = () => { closeBrowser(); };
  try {
    await stage("starting"); browser = await launch();
    context = await browser.newContext({ acceptDownloads: true, locale: "pt-BR", serviceWorkers: "block", viewport: { width: 1365, height: 900 } });
    signal?.addEventListener("abort", closeOnAbort, { once: true });
    await installPasswordTransport(context, origin, timeout);
    page = await context.newPage(); page.setDefaultTimeout(timeout);
    page.on("dialog", async (dialog) => {
      const message = dialog.message().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      alertCode = /supera o limite|excede.*limite/.test(message) ? "record_limit" : /captcha|antirobo|codigo.*(incorreto|invalido)/.test(message) ? "captcha_rejected" : "portal_alert";
      await dialog.accept().catch(() => {});
    });
    await stage("authenticating");
    const loginURL = `${origin}/servicos/NFENC/SSL/ASLibrary/Login?ReturnUrl=${encodeURIComponent(new URL(reportURL("saidas")).pathname)}`;
    const response = await page.goto(loginURL, { waitUntil: "domcontentloaded", timeout }); safeOrigin();
    if (response && response.status() >= 400) throw new PortalError("portal_unavailable", "O portal está indisponível para consulta.");
    const login = await waitUntil(() => visible(page, SELECTORS.login), timeout, signal, "login_not_found", "Não foi possível localizar o formulário de login.");
    await stage("filling_credentials");
    await login.fill(credentials.login);
    const password = await visible(page, SELECTORS.password), enter = await visible(page, SELECTORS.enter);
    if (!password || !enter) throw new PortalError("selector_changed", "O formulário de login do portal mudou.");
    await password.fill(credentials.password);
    await stage("submitting_login"); await enter.click();
    await stage("confirming_login");
    const loginTimeout = "O portal não confirmou a autenticação.";
    const authenticated = await within(waitUntil(async () => {
      safeOrigin(); const error = page.locator("#msgDetalhesErro");
      if (await error.isVisible()) throw new PortalError("invalid_credentials", "O portal recusou o login ou a senha cadastrados.");
      if (await visible(page, SELECTORS.period) && !await visible(page, SELECTORS.login)) return true;
      return false;
    }, timeout, signal, "login_timeout", loginTimeout), timeout);
    if (!authenticated) throw new PortalError("login_timeout", loginTimeout);
    async function requestPeriod(direction, start, end) {
      checkAbort(signal); alertCode = null;
      await stage("consulting", { direction, from: start, to: end });
      await page.goto(reportURL(direction), { waitUntil: "domcontentloaded", timeout }); safeOrigin();
      if (await visible(page, SELECTORS.login)) throw new PortalError("session_expired", "A sessão no portal expirou.");
      const radio = await waitUntil(() => visible(page, SELECTORS.period), timeout, signal, "selector_changed", "O filtro de período não foi localizado.");
      await radio.check();
      const first = await visible(page, SELECTORS.from), last = await visible(page, SELECTORS.to);
      if (!first || !last) throw new PortalError("selector_changed", "Os campos de período não foram localizados.");
      const format = (date) => date.split("-").reverse().join("/");
      await first.fill(format(start)); await first.press("Tab"); await last.fill(format(end)); await last.press("Tab");
      for (let attempt = 1; attempt <= 3; attempt++) {
        const captcha = await visible(page, SELECTORS.captcha), captchaInput = await visible(page, SELECTORS.captchaInput);
        if (captcha && captchaInput) {
          if (!solveCaptcha) throw new PortalError("captcha_required", "O portal solicitou o código da imagem.");
          await stage("awaiting_captcha", { direction, from: start, to: end, attempt });
          const image = await captcha.screenshot();
          const answer = await solveCaptcha({ image: `data:image/png;base64,${image.toString("base64")}`, attempt, direction });
          checkAbort(signal);
          if (!answer) throw new PortalError("captcha_required", "O código da imagem não foi informado.");
          await captchaInput.fill(answer);
        }
        alertCode = null;
        const consult = await visible(page, SELECTORS.consult);
        if (!consult) throw new PortalError("selector_changed", "O botão de consulta não foi localizado.");
        await stage("consulting", { direction, from: start, to: end, attempt }); await consult.click();
        const captchaStart = Date.now();
        const result = await waitUntil(async () => {
          safeOrigin();
          if (alertCode) return alertCode;
          if (await visible(page, SELECTORS.login)) throw new PortalError("session_expired", "A sessão no portal expirou.");
          if (await page.locator("#lblConsultaVazia").isVisible()) return "empty";
          if (await visible(page, [".blockUI", ".blockMsg", ".blockOverlay"])) return false;
          if (await visible(page, SELECTORS.export)) return "export";
          if (Date.now() - captchaStart >= 750) {
            const captchaAfterSubmit = await visible(page, SELECTORS.captcha);
            const captchaInputAfterSubmit = await visible(page, SELECTORS.captchaInput);
            if (captchaAfterSubmit && captchaInputAfterSubmit) return "captcha_rejected";
          }
          return false;
        }, timeout, signal, "query_timeout", "A consulta não retornou resultados no prazo esperado.");
        if (result === "record_limit") throw new PortalError("record_limit", "O período excedeu o limite de registros do portal.");
        if (result === "captcha_rejected") { if (attempt < 3) continue; throw new PortalError("captcha_rejected", "O portal recusou o código da imagem após três tentativas."); }
        if (result === "portal_alert") throw new PortalError("portal_alert", "O portal apresentou um alerta durante a consulta.");
        if (result === "empty") { await onEmpty({ direction, from: start, to: end }); return; }
        const button = await visible(page, SELECTORS.export);
        await stage("downloading", { direction, from: start, to: end });
        let download;
        try { [download] = await Promise.all([page.waitForEvent("download", { timeout: downloadTimeout }), button.click()]); }
        catch { throw new PortalError("download_failed", "O download da planilha não foi iniciado no prazo esperado."); }
        if (await download.failure()) throw new PortalError("download_failed", "O download da planilha falhou.");
        const filename = download.suggestedFilename();
        if (!/\.(csv|xls|xlsx)$/i.test(filename)) throw new PortalError("unexpected_download", "O portal retornou um arquivo diferente de planilha.");
        const source = await download.path(), stat = await fs.stat(source);
        if (stat.size > 20 * 1024 * 1024) throw new PortalError("download_too_large", "A planilha excedeu o tamanho permitido para importação.");
        const buffer = await fs.readFile(source);
        let mdfe;
        if (includeMdfeEvents) {
          await stage("collecting_mdfe", { direction, from: start, to: end });
          mdfe = await collectMdfeNfeEvents(page, { origin, timeout: Math.min(timeout, 10000), signal })
            .catch(() => ({ complete: false, reports: new Map() }));
          checkAbort(signal);
        }
        await onFile({ direction, from: start, to: end, filename, buffer, mdfe }); return;
      }
    }
    let partial = false;
    for (const direction of directions) {
      const queue = [[from, to]]; let requests = 0;
      while (queue.length) {
        if (++requests > 64) { partial = true; await stage("part_failed", { direction, from, to, code: "split_budget" }); break; }
        const [start, end] = queue.shift();
        try { await requestPeriod(direction, start, end); }
        catch (error) {
          if (error.code === "record_limit" && start !== end) {
            const midpoint = new Date((Date.parse(start) + Date.parse(end)) / 2).toISOString().slice(0, 10);
            const next = new Date(Date.parse(midpoint) + 86400000).toISOString().slice(0, 10);
            queue.unshift([start, midpoint], [next, end]); await stage("splitting", { direction, from: start, to: end }); continue;
          }
          if (["record_limit", "query_timeout", "download_failed"].includes(error.code)) { partial = true; await stage("part_failed", { direction, from: start, to: end, code: error.code }); continue; }
          throw error;
        }
      }
    }
    return { partial };
  } catch (error) {
    if (signal?.aborted) throw new PortalError("cancelled", "Coleta cancelada.");
    if (error instanceof PortalError) throw error;
    if (/ERR_CERT|SSL_|TLS_/i.test(error.message || "")) throw new PortalError("portal_tls_error", "O navegador recusou o certificado HTTPS do portal. Nenhuma exceção de segurança foi aplicada.");
    throw new PortalError("portal_navigation_failed", "Não foi possível concluir a navegação no portal. Confira a conexão ou tente mais tarde.");
  } finally {
    signal?.removeEventListener("abort", closeOnAbort);
    // Closing a context first may wait indefinitely on a native TLS/client-cert
    // dialog. Closing our dedicated browser releases all contexts and downloads.
    await within(closeBrowser(), 5000);
  }
}
module.exports = { BASE_URL, SELECTORS, PortalError, collectSefazBa, launchPortalBrowser };

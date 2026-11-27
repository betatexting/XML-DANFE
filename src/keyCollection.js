const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { getUserDataDir } = require("./runtimePaths");
const { collectSefazBa, PortalError } = require("./sefazBaPortal");
const { readCaptcha } = require("./easyOcrWorker");
const { parsePortalSpreadsheet, isoDate } = require("./portalSpreadsheet");
const terminal = new Set(["completed", "partial", "empty", "failed", "cancelled", "interrupted"]);
function validateRange(from, to) {
  if (typeof from !== "string" || typeof to !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || isoDate(from) !== from || isoDate(to) !== to || from > to || Date.parse(to) - Date.parse(from) > 366 * 86400000) throw Object.assign(new Error("Informe um período válido de até 367 dias."), { status: 400 });
}
function createKeyCollection({ root = path.join(getUserDataDir(), "key-collections"), catalog, getCredentials, collector = collectSefazBa, captchaTimeout = 180000 } = {}) {
  const file = path.join(root, "index.json"), active = new Map(), challenges = new Map();
  let state, ready, queue = Promise.resolve();
  const snapshotJob = (job) => ({ ...job, events: job.events.slice(-100) });
  async function persist() {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(file + ".tmp", JSON.stringify(state), { mode: 0o600 }); await fs.rename(file + ".tmp", file);
  }
  async function initialize() {
    try { state = JSON.parse(await fs.readFile(file, "utf8")); if (!Array.isArray(state.jobs) || !Array.isArray(state.sheets)) throw new Error(); }
    catch (error) { if (error.code !== "ENOENT") throw new Error("Não foi possível ler o histórico de planilhas."); state = { version: 1, jobs: [], sheets: [] }; }
    let changed = false;
    for (const job of state.jobs) if (!terminal.has(job.status)) { job.status = "interrupted"; job.code = "application_interrupted"; job.finishedAt = new Date().toISOString(); changed = true; }
    if (changed) await persist();
  }
  function run(task) {
    ready ||= initialize();
    const pending = queue.then(() => ready).then(task); queue = pending.catch(() => {}); return pending;
  }
  async function event(id, stage, detail = {}) {
    return run(async () => {
      const job = state.jobs.find((item) => item.id === id);
      const entry = { at: new Date().toISOString(), stage };
      for (const name of ["direction", "from", "to", "code", "attempt", "count", "duplicateCount", "rejectedCount"]) if (detail[name] !== undefined) entry[name] = detail[name];
      job.events.push(entry); job.events = job.events.slice(-300);
      if (stage !== "part_failed") job.status = stage;
      else { job.failures++; job.code = detail.code; }
      await persist();
    });
  }
  async function execute(job, controller) {
    let credentials;
    try {
      credentials = await getCredentials(job.companyId);
      const result = await collector({ credentials, from: job.from, to: job.to, directions: job.directions, includeMdfeEvents: job.includeMdfeEvents, signal: controller.signal,
        onStage: (stage, detail) => event(job.id, stage, detail),
        onEmpty: (detail) => event(job.id, "empty_part", detail),
        solveCaptcha: ({ image, attempt, direction }) => new Promise((resolve, reject) => {
          const abort = () => finish(null, new PortalError("cancelled", "Coleta cancelada."));
          const timer = setTimeout(() => finish(null, new PortalError("captcha_timeout", "O prazo para informar o código da imagem terminou.")), captchaTimeout);
          function finish(value, error) {
            clearTimeout(timer);
            controller.signal.removeEventListener("abort", abort);
            if (challenges.get(job.id) === challenge) challenges.delete(job.id);
            fs.rm(path.join(root, "captcha.png"), { force: true }).catch(() => {});
            if (error) reject(error);
            else resolve(value);
          }
          const challenge = { token: randomUUID(), image, attempt, direction, answer: (value) => finish(value) };
          if (controller.signal.aborted) { finish(null, new PortalError("cancelled", "Coleta cancelada.")); return; }
          controller.signal.addEventListener("abort", abort, { once: true });
          challenges.set(job.id, challenge);

          const base64Match = /^data:image\/(?:png|jpeg|jpg|gif|bmp|webp);base64,(.+)$/i.exec(image);
          if (!base64Match) return;
          const captchaPath = path.join(root, "captcha.png");
          fs.mkdir(root, { recursive: true })
            .then(() => fs.writeFile(captchaPath, Buffer.from(base64Match[1], "base64"), { mode: 0o600 }))
            .then(() => readCaptcha(captchaPath, { timeout: 30000 }))
            .then((answer) => finish(answer))
            .catch(() => {
              // Mantém o desafio disponível para resposta manual quando o OCR falhar.
            });
        }),
        onFile: async ({ direction, from, to, filename, buffer, mdfe }) => {
          await event(job.id, "importing", { direction, from, to });
          let parsed; try { parsed = parsePortalSpreadsheet(buffer, filename); }
          catch { throw new PortalError("spreadsheet_invalid", "A planilha baixada não contém chaves NF-e válidas para importação."); }
          const inPeriod = parsed.records.filter((record) => !record.authorizationDate || (record.authorizationDate >= from && record.authorizationDate <= to));
          if (parsed.rowCount === 0) {
            await event(job.id, "empty_part", { direction, from, to });
            return;
          }
          parsed.rejectedCount += parsed.records.length - inPeriod.length;
          if (parsed.records.length && !inPeriod.length) throw new PortalError("spreadsheet_invalid", "A planilha recebida não corresponde ao período de autorização solicitado.");
          parsed.records = inPeriod;
          if (mdfe) {
            for (const item of parsed.records) item.mdfe = mdfe.reports.get(item.key) || { status: "unverified", events: [], reason: "nfe_grid_not_read" };
          }
          await run(async () => {
            const id = randomUUID(), relativeFile = `${job.id}/${id}${path.extname(filename).toLowerCase()}`;
            const target = path.join(root, relativeFile); await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, buffer, { flag: "wx", mode: 0o600 });
            const known = new Set(state.sheets.filter((sheet) => sheet.companyId === job.companyId && sheet.direction === direction).flatMap((sheet) => sheet.records.map((record) => record.key)));
            const existingCount = parsed.records.filter((record) => known.has(record.key)).length;
            const sheet = { id, jobId: job.id, companyId: job.companyId, direction, from, to, createdAt: new Date().toISOString(), sourceName: path.basename(filename), relativeFile, sha256: parsed.sha256, recordCount: parsed.records.length, duplicateCount: parsed.duplicateCount + existingCount, rejectedCount: parsed.rejectedCount, records: parsed.records };
            if (mdfe) sheet.hasMdfeReport = true;
            state.sheets.push(sheet); const current = state.jobs.find((entry) => entry.id === job.id);
            if (mdfe && (!mdfe.complete || parsed.records.some((item) => item.mdfe.status === "unverified" || item.mdfe.events.some((event) => event.detailUnavailable)))) current.failures++;
            current.sheetCount++; current.keyCount += sheet.recordCount - existingCount; current.duplicateCount += sheet.duplicateCount; current.rejectedCount += sheet.rejectedCount;
            await persist();
          });
        }
      });
      await run(async () => {
        const current = state.jobs.find((entry) => entry.id === job.id);
        current.status = result.partial || current.failures || current.rejectedCount ? "partial" : current.sheetCount ? "completed" : "empty";
        current.finishedAt = new Date().toISOString(); await persist();
      });
    } catch (error) {
      await run(async () => {
        const current = state.jobs.find((entry) => entry.id === job.id);
        current.status = controller.signal.aborted ? "cancelled" : current.sheetCount ? "partial" : "failed";
        const safeCodes = ["credentials_unavailable", "cancelled", "captcha_timeout", "captcha_required", "captcha_rejected", "browser_unavailable", "portal_unavailable", "login_not_found", "selector_changed", "invalid_credentials", "login_timeout", "session_expired", "record_limit", "query_timeout", "download_failed", "unexpected_download", "download_too_large", "spreadsheet_invalid", "portal_navigation_failed", "unexpected_origin", "portal_alert"];
        current.code = [...safeCodes, "portal_tls_error"].includes(error.code) ? error.code : "collection_failed";
        current.finishedAt = new Date().toISOString();
        current.events.push({ at: current.finishedAt, stage: current.status, code: current.code }); await persist();
      }).catch(() => {});
    } finally {
      if (credentials) { credentials.login = ""; credentials.password = ""; }
      challenges.delete(job.id); active.delete(job.companyId);
    }
  }
  const api = {
    start: async ({ companyId, from, to, directions = ["saidas", "entradas"], includeMdfeEvents = false }) => {
      validateRange(from, to);
      if (!Array.isArray(directions) || !directions.length || directions.some((value) => !["saidas", "entradas"].includes(value))) throw Object.assign(new Error("Selecione entradas ou saídas."), { status: 400 });
      const company = (await catalog.list()).companies.find((item) => item.id === companyId);
      if (!company) throw Object.assign(new Error("Selecione uma empresa cadastrada."), { status: 400 });
      return run(async () => {
        if (active.has(companyId)) throw Object.assign(new Error("Já existe uma coleta em andamento para esta empresa."), { status: 409 });
        const job = { id: randomUUID(), companyId, from, to, directions: [...new Set(directions)], includeMdfeEvents: includeMdfeEvents === true, status: "queued", startedAt: new Date().toISOString(), sheetCount: 0, keyCount: 0, duplicateCount: 0, rejectedCount: 0, failures: 0, events: [] };
        state.jobs.push(job); await persist(); const controller = new AbortController();
        active.set(companyId, { id: job.id, controller });
        setImmediate(() => { execute({ ...job }, controller).catch(() => {}); });
        return snapshotJob(job);
      });
    },
    list: ({ companyId, from, to }) => {
      validateRange(from, to);
      return run(async () => ({
        sheets: state.sheets.filter((sheet) => sheet.companyId === companyId && sheet.from >= from && sheet.to <= to).map(({ records, relativeFile, ...sheet }) => sheet),
        jobs: state.jobs.filter((job) => job.companyId === companyId && job.from >= from && job.to <= to).slice(-50).reverse().map(snapshotJob)
      }));
    },
    sheet: (id, companyId, { allRecords = false } = {}) => run(async () => {
      const sheet = state.sheets.find((entry) => entry.id === id && entry.companyId === companyId);
      if (!sheet) throw Object.assign(new Error("Planilha não encontrada para a empresa selecionada."), { status: 404 });
      return { ...sheet, records: allRecords ? sheet.records : sheet.records.slice(0, 1000), truncated: !allRecords && sheet.records.length > 1000, filePath: path.join(root, sheet.relativeFile) };
    }),
    job: (id) => run(async () => {
      const job = state.jobs.find((entry) => entry.id === id);
      if (!job) throw Object.assign(new Error("Coleta não encontrada."), { status: 404 });
      const challenge = challenges.get(id);
      return { ...snapshotJob(job), challenge: challenge ? { token: challenge.token, image: challenge.image, attempt: challenge.attempt } : null };
    }),
    answer: (id, token, answer) => run(async () => {
      const challenge = challenges.get(id);
      if (!challenge || challenge.token !== token || typeof answer !== "string" || !/^[A-Za-z0-9]{1,16}$/.test(answer)) throw Object.assign(new Error("O código expirou ou não é válido. Atualize a coleta."), { status: 400 });
      challenge.answer(answer); return { ok: true };
    }),
    cancel: (id) => run(async () => {
      const task = [...active.values()].find((entry) => entry.id === id);
      if (task) task.controller.abort(); return { ok: true };
    })
  };
  return api;
}
function installKeyCollectionRoutes(app) {
  const service = () => app.locals.keyCollection ||= createKeyCollection({ catalog: app.locals.companyCatalog, getCredentials: (id) => app.locals.companyCatalog.loadPortalCredentials(id, { encryption: app.locals.companyCredentialEncryption }) });
  const wrap = (action) => async (req, res) => { res.set("Cache-Control", "no-store"); try { await action(req, res, service()); } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : "Não foi possível acessar a coleta de planilhas." }); } };
  app.get("/api/key-sheets", wrap(async (req, res, api) => res.json(await api.list(req.query))));
  app.get("/api/key-sheets/:id", wrap(async (req, res, api) => { const { relativeFile, filePath, ...sheet } = await api.sheet(req.params.id, req.query.companyId); res.json(sheet); }));
  app.get("/api/key-sheets/:id/file", wrap(async (req, res, api) => { const sheet = await api.sheet(req.params.id, req.query.companyId); res.download(sheet.filePath, sheet.sourceName); }));
  app.get("/api/key-sheets/:id/mdfe-events", wrap(async (req, res, api) => {
    const sheet = await api.sheet(req.params.id, req.query.companyId, { allRecords: true });
    if (!sheet.hasMdfeReport) return res.status(404).json({ error: "Esta coleta não inclui eventos de MDF-e." });
    const statusLabel = { found: "Evento encontrado", empty: "Sem evento de autorização identificado", unverified: "NF-e não verificada" };
    const XLSX = require("xlsx");
    const rows = [["Chave NF-e", "UF do emitente (código)", "Resultado", "Código do evento", "Protocolo do evento", "Data do evento", "Observação"]];
    for (const { key, mdfe } of sheet.records) {
      const fields = [key, key.slice(0, 2), statusLabel[mdfe.status]];
      if (!mdfe.events.length) {
        const reasons = {
          nfe_detail_unavailable: "Detalhamento da NF-e indisponível",
          nfe_events_unavailable: "Tabela de eventos indisponível",
          nfe_window_unavailable: "A janela da NF-e não abriu",
          nfe_grid_not_read: "NF-e não localizada na grade consultada",
          unexpected_origin: "O detalhe abriu em um endereço inesperado"
        };
        rows.push([...fields, "", "", "", reasons[mdfe.reason] || ""]);
      }
      for (const event of mdfe.events) {
        rows.push([...fields, event.code, event.protocol, event.date, event.detailUnavailable ? "Detalhe do evento indisponível" : ""]);
      }
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Eventos MDF-e");
    res.attachment("eventos-mdfe-por-nfe.xlsx").send(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  }));
  app.post("/api/key-collections", wrap(async (req, res, api) => res.status(202).json(await api.start(req.body || {}))));
  app.get("/api/key-collections/:id", wrap(async (req, res, api) => res.json(await api.job(req.params.id))));
  app.post("/api/key-collections/:id/captcha", wrap(async (req, res, api) => res.json(await api.answer(req.params.id, req.body?.token, req.body?.answer))));
  app.post("/api/key-collections/:id/cancel", wrap(async (req, res, api) => res.json(await api.cancel(req.params.id))));
}
module.exports = { createKeyCollection, installKeyCollectionRoutes, validateRange };

const { validNfeKey } = require("./portalSpreadsheet");

const eventRows = "table.tabNFe tr";
const datePattern = /\b\d{2}\/\d{2}\/\d{4}\s+(?:às\s+)?\d{2}:\d{2}:\d{2}(?:[-+]\d{2}:\d{2})?/i;

function eventKind(text) {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const code = normalized.match(/\b61061[0145]\b/)?.[0];
  if (code) return ["610610", "610614"].includes(code) ? code : "";
  if (/mdf[\s-]*e.*autoriz/.test(normalized) && !/cancel/.test(normalized)) {
    return /\bct[\s-]*e\b/.test(normalized) ? "610614" : "610610";
  }
  return "";
}

async function openDetail(page, link, origin, timeout, read) {
  const opening = page.waitForEvent("popup", { timeout });
  opening.catch(() => {});
  await link.click({ timeout });
  const popup = await opening;
  try {
    await popup.waitForLoadState("domcontentloaded", { timeout });
    if (new URL(popup.url()).origin !== origin) throw new Error("unexpected_origin");
    return await read(popup);
  } finally {
    await popup.close().catch(() => {});
  }
}

async function inspectNote(page, link, origin, timeout) {
  return openDetail(page, link, origin, timeout, async (note) => {
    const detail = note.locator("#btnNFEDetalhada");
    try { await detail.click({ timeout }); }
    catch { throw new Error("nfe_detail_unavailable"); }
    try { await note.locator("table.tabNFe").first().waitFor({ state: "visible", timeout }); }
    catch { throw new Error("nfe_events_unavailable"); }
    const rows = note.locator(eventRows);
    const events = [];
    for (const row of await rows.all()) {
      const text = await row.innerText({ timeout });
      const code = eventKind(text);
      if (!code) continue;
      const protocol = text.match(/\b\d{15}\b/)?.[0] || "";
      let date = text.match(datePattern)?.[0] || "";
      const protocolLink = row.locator("a").filter({ hasText: /^\s*\d{15}\s*$/ }).first();
      let detailUnavailable = false;
      if (await protocolLink.count()) {
        try {
          const eventDate = await openDetail(note, protocolLink, origin, timeout, async (popup) => {
            const body = await popup.locator("body").innerText({ timeout });
            return body.match(/Data\s+Evento\s*:?\s*([^\n]*(?:\n\s*\d[^\n]*)?)/i)?.[1]?.match(datePattern)?.[0];
          });
          date = eventDate || date;
          detailUnavailable = !date;
        } catch { detailUnavailable = true; }
      }
      events.push({ code, protocol, date, detailUnavailable });
    }
    return { status: events.length ? "found" : "empty", events };
  });
}

async function collectMdfeNfeEvents(page, { origin, timeout, signal }) {
  const reports = new Map();
  const grid = page.locator("#Grid");
  if (!await grid.isVisible()) return { complete: false, reports };
  const pageLabel = page.locator("#lblPagina");
  const pageLinks = page.locator("a[href*='__doPostBack'][href*='Page$']");
  const visitedPages = new Set();
  while (!signal?.aborted) {
    const pageText = await pageLabel.count() ? await pageLabel.innerText({ timeout }) : "";
    const pagination = pageText.match(/P.gina\s+(\d+)\s+de\s+(\d+)/i);
    const current = Number(pagination?.[1] || 1);
    if (visitedPages.has(current)) return { complete: false, reports };
    visitedPages.add(current);
    for (const row of await grid.locator("tr").all()) {
      if (signal?.aborted) return { complete: false, reports };
      const key = (await row.innerText({ timeout })).match(/\b\d{44}\b/)?.[0];
      if (!key || !validNfeKey(key) || reports.has(key)) continue;
      const link = row.locator("td a").first();
      try { reports.set(key, await inspectNote(page, link, origin, timeout)); }
      catch (error) {
        const reason = ["nfe_detail_unavailable", "nfe_events_unavailable", "unexpected_origin"].includes(error.message)
          ? error.message : "nfe_window_unavailable";
        reports.set(key, { status: "unverified", events: [], reason });
      }
    }
    if (!pagination || current >= Number(pagination[2])) {
      return { complete: Boolean(pagination) || !await pageLinks.count(), reports };
    }
    const next = pageLinks.filter({ hasText: new RegExp(`^\\s*${current + 1}\\s*$`) }).first();
    if (!await next.count()) return { complete: false, reports };
    const nextPage = new RegExp(`P.gina\\s+${current + 1}\\s+de\\s+\\d+`, "i");
    try {
      await next.click({ timeout });
      await page.locator("#lblPagina").filter({ hasText: nextPage }).waitFor({ state: "visible", timeout });
    } catch {
      return { complete: false, reports };
    }
  }
  return { complete: false, reports };
}

module.exports = { collectMdfeNfeEvents, eventKind };

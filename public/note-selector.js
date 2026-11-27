import { bindHoverPopover } from "./hover-popover.js";

async function errorSound() {
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    const audio = new Audio();
    await audio.resume();
    const tone = audio.createOscillator(), volume = audio.createGain();
    tone.type = "sine";
    tone.frequency.setValueAtTime(240, audio.currentTime);
    tone.frequency.exponentialRampToValueAtTime(120, audio.currentTime + .14);
    volume.gain.setValueAtTime(.12, audio.currentTime);
    volume.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .18);
    tone.connect(volume); volume.connect(audio.destination);
    tone.onended = () => { audio.close().catch(() => {}); };
    tone.start(); tone.stop(audio.currentTime + .19);
  } catch { /* Audio device unavailable: still do not invoke the note action. */ }
}

export function initializeNoteSelector(companyContext) {
  const group = document.querySelector("#noteToolGroup"), popup = document.querySelector("#notePopover");
  const trigger = document.querySelector("#noteToolButton"), bridge = group.querySelector(".note-hover-bridge");
  const select = document.querySelector("#noteSelectButton"), label = document.querySelector("#noteSelectLabel");
  const dropdown = document.querySelector("#noteDropdown"), options = document.querySelector("#noteOptions");
  const message = document.querySelector("#noteSelectorMessage");
  const buttons = [...group.querySelectorAll("[data-note-type]")];
  let notesByCompany = new Map(), loading = false, failed = false, inventoryLoaded = false, selecting = false;
  const closeDropdown = () => { dropdown.hidden = true; select.setAttribute("aria-expanded", "false"); };
  function position() {
    if (popup.hidden) return;
    const anchor = group.getBoundingClientRect(), card = popup.getBoundingClientRect(), panel = group.closest(".automatic-notes-panel").getBoundingClientRect();
    const top = Math.max(panel.top + 12, Math.min(anchor.top - 16, panel.bottom - card.height - 12));
    popup.style.top = `${top - anchor.top}px`;
    popup.style.setProperty("--note-tail-top", `${Math.max(0, anchor.top - 16 - top)}px`);
    bridge.style.top = popup.style.top; bridge.style.height = `${card.height}px`;
  }
  function render() {
    const { loaded, companies } = companyContext.state;
    const company = companyContext.selectedCompany;
    const notes = notesByCompany.get(company?.id);
    label.textContent = !loaded ? "Carregando empresas…" : company?.legalName || (companies.length ? "Selecionar empresa" : "Nenhuma empresa cadastrada");
    select.title = label.textContent; select.disabled = selecting || !companies.length;
    for (const button of buttons) {
      const available = button.dataset.noteType === "nfs" ? Boolean(company) : !loading && !failed && notes?.[button.dataset.noteType] > 0;
      button.setAttribute("aria-disabled", String(selecting || !available));
    }
    if (!selecting) {
      message.textContent = loading ? "Conferindo as notas baixadas…" :
        failed ? "Não foi possível conferir as notas baixadas." :
        inventoryLoaded && company && !notes ? "Esta empresa ainda não tem notas baixadas." : "";
    }
    position();
  }
  function renderOptions() {
    options.replaceChildren();
    for (const company of companyContext.state.companies) {
      const option = document.createElement("button");
      option.type = "button"; option.className = "company-option"; option.textContent = company.legalName;
      option.setAttribute("role", "option"); option.setAttribute("aria-selected", String(company.id === companyContext.state.selectedCompanyId));
      option.addEventListener("click", async () => {
        if (selecting) return;
        selecting = true; render();
        let selectionFailed = false;
        try { await companyContext.select(company.id); closeDropdown(); }
        catch { selectionFailed = true; }
        finally {
          selecting = false; renderOptions(); render(); if (!popup.hidden) select.focus();
          if (selectionFailed) message.textContent = "Não foi possível selecionar a empresa.";
        }
      });
      options.append(option);
    }
  }
  async function refresh() {
    if (loading) return;
    loading = true; failed = false; render();
    try {
      const response = await fetch("/api/note-filter", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = await response.json();
      notesByCompany = new Map(data.companies.map(({ id, notes }) => [id, notes]));
      inventoryLoaded = true;
    } catch { notesByCompany = new Map(); failed = true; }
    finally { loading = false; render(); }
  }
  const popover = bindHoverPopover({ group, trigger, popup, bridge, onOpen: () => { if (popup.dataset.loaded !== "true") { popup.dataset.loaded = "true"; refresh(); } position(); }, onClose: () => { closeDropdown(); popup.dataset.loaded = "false"; }, isBusy: () => selecting });
  select.addEventListener("click", () => { dropdown.hidden = !dropdown.hidden; select.setAttribute("aria-expanded", String(!dropdown.hidden)); });
  select.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault(); dropdown.hidden = false; select.setAttribute("aria-expanded", "true");
    (event.key === "ArrowUp" ? options.lastElementChild : options.firstElementChild)?.focus();
  });
  options.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault(); const items = [...options.children], index = items.indexOf(document.activeElement);
    items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  });
  for (const button of buttons) button.addEventListener("click", () => {
    const company = companyContext.selectedCompany;
    if (button.getAttribute("aria-disabled") === "true" || !company) { errorSound(); return; }
    if (button.dataset.noteType === "nfs") {
      popover.close();
      document.dispatchEvent(new CustomEvent("company-module:request", { detail: { module: "nfse", company } }));
      return;
    }
    document.dispatchEvent(new CustomEvent("note-filter:request", { detail: { type: button.dataset.noteType, company } }));
  });
  companyContext.subscribe(() => { renderOptions(); render(); });
  window.addEventListener("resize", position);
  document.addEventListener("notes:downloaded", refresh);
}

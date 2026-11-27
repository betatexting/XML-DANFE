import { calendarMonth, calendarToday, selectCalendarDate, companyCalendarPeriod } from "./calendar-period-model.mjs";
import { bindHoverPopover } from "./hover-popover.js";

const today = calendarToday();
let period = Object.freeze({ year: today.year, month: today.month, startDate: null, endDate: null });
const listeners = new Set();
function publish(next) {
  period = Object.freeze(next);
  for (const listener of listeners) listener(period);
  document.dispatchEvent(new CustomEvent("calendar-period:changed", { detail: period }));
}
export const calendarPeriodContext = {
  get state() { return period; },
  subscribe(listener) { listeners.add(listener); listener(period); return () => listeners.delete(listener); },
  setMonth(year, month) { calendarMonth(year, month); publish({ year, month, startDate: null, endDate: null }); },
  selectDate(date) {
    publish(selectCalendarDate(period, date));
  }
};

const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const monthLabels = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function dropdown(root, choices, onChange) {
  const trigger = root.querySelector("button"), list = root.querySelector('[role="listbox"]');
  let value;
  const close = () => { list.hidden = true; trigger.setAttribute("aria-expanded", "false"); };
  function open() {
    list.hidden = false; trigger.setAttribute("aria-expanded", "true");
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }
  for (const choice of choices) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "calendar-select-option";
    button.setAttribute("role", "option"); button.dataset.value = String(choice.value);
    button.textContent = choice.name;
    button.addEventListener("click", () => { onChange(choice.value); close(); trigger.focus(); });
    list.append(button);
  }
  trigger.addEventListener("click", () => { if (list.hidden) open(); else close(); });
  trigger.addEventListener("keydown", (event) => {
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault(); open();
      (list.querySelector('[aria-selected="true"]') || list.firstElementChild)?.focus();
    }
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !list.hidden) { event.preventDefault(); event.stopPropagation(); close(); trigger.focus(); }
  });
  list.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = [...list.children], current = items.indexOf(document.activeElement);
    const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[index]?.focus();
  });
  document.addEventListener("pointerdown", (event) => { if (!root.contains(event.target)) close(); });
  return {
    close,
    setValue(next) {
      value = next;
      trigger.textContent = choices.find((choice) => choice.value === value)?.label || String(value);
      for (const option of list.children) option.setAttribute("aria-selected", String(option.dataset.value === String(value)));
    }
  };
}

export function initializeCalendarSelector(companyContext) {
  const group = document.querySelector("#calendarToolGroup");
  const popup = document.querySelector("#calendar_period_selector");
  const trigger = document.querySelector("#calendarToolButton");
  const bridge = group.querySelector(".calendar-hover-bridge");
  const days = document.querySelector("#calendarDays");
  let rendering = false;
  const monthSelect = dropdown(document.querySelector("#calendarMonthSelect"), monthNames.map((name, index) => ({ value: index + 1, name, label: monthLabels[index] })), (month) => calendarPeriodContext.setMonth(period.year, month));
  const yearSelect = dropdown(document.querySelector("#calendarYearSelect"), Array.from({ length: Math.max(2100, today.year + 20) - Math.min(1900, today.year - 100) + 1 }, (_, index) => {
    const value = Math.min(1900, today.year - 100) + index; return { value, name: String(value), label: String(value) };
  }), (year) => calendarPeriodContext.setMonth(year, period.month));

  function position() {
    if (popup.hidden) return;
    const anchor = group.getBoundingClientRect(), card = popup.getBoundingClientRect();
    const panel = group.closest(".automatic-notes-panel").getBoundingClientRect();
    const top = Math.max(panel.top + 12, Math.min(anchor.top - 16, panel.bottom - card.height - 12));
    popup.style.top = `${top - anchor.top}px`;
    popup.style.setProperty("--calendar-tail-top", `${Math.max(0, anchor.top - 16 - top)}px`);
    bridge.style.top = popup.style.top; bridge.style.height = `${card.height}px`;
  }
  function render() {
    rendering = true;
    try {
      const model = calendarMonth(period.year, period.month);
      const query = companyCalendarPeriod(period, companyContext.selectedCompany);
      const message = document.querySelector("#calendarPeriodMessage");
      message.textContent = query.reason ? "Nenhuma busca concluída registrada. O retorno conterá apenas dados já processados." : query.lastCompletedDate ? `O retorno conterá apenas dados processados até a última busca: ${query.lastCompletedDate.split("-").reverse().join("/")}.` : "";
      document.querySelector("#calendarSearchButton").disabled = false;
      monthSelect.setValue(period.month); yearSelect.setValue(period.year);
      days.setAttribute("aria-label", `Datas de ${monthNames[period.month - 1]} de ${period.year}`);
      days.replaceChildren();
      const todayDate = `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;
      const focusDate = period.endDate || period.startDate || query.lastCompletedDate || model.cells.find(Boolean).date;
      for (const cell of model.cells) {
        if (!cell) { const blank = document.createElement("span"); blank.className = "calendar-empty"; blank.setAttribute("aria-hidden", "true"); days.append(blank); continue; }
        const button = document.createElement("button");
        button.type = "button"; button.className = "calendar-day"; button.dataset.date = cell.date; button.textContent = String(cell.day);
        button.setAttribute("aria-label", `${cell.day} de ${monthNames[period.month - 1].toLowerCase()} de ${period.year}`);
        const selected = period.startDate && cell.date >= period.startDate && cell.date <= (period.endDate || period.startDate);
        button.setAttribute("aria-pressed", String(Boolean(selected)));
        if (cell.date === todayDate) button.setAttribute("aria-current", "date");
        button.tabIndex = cell.date === focusDate ? 0 : -1;
        button.addEventListener("click", () => {
          calendarPeriodContext.selectDate(cell.date);
          days.querySelector(`[data-date="${cell.date}"]`)?.focus({ preventScroll: true });
        });
        days.append(button);
      }
      position();
    } finally { rendering = false; }
  }
  days.addEventListener("keydown", (event) => {
    const movement = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 }[event.key];
    if (!movement || !event.target.matches(".calendar-day")) return;
    event.preventDefault();
    const items = [...days.querySelectorAll("button:not(:disabled)")], index = items.indexOf(event.target);
    const target = items[Math.max(0, Math.min(items.length - 1, index + movement))];
    event.target.tabIndex = -1; target.tabIndex = 0; target.focus({ preventScroll: true });
  });
  calendarPeriodContext.subscribe(render);
  companyContext.subscribe(() => calendarPeriodContext.setMonth(period.year, period.month));
  bindHoverPopover({ group, trigger, popup, bridge, isBusy: () => rendering, onOpen: position, onClose: () => { monthSelect.close(); yearSelect.close(); } });
  window.addEventListener("resize", position);
  document.querySelector("#calendarSearchButton").addEventListener("click", () => {
    const query = companyCalendarPeriod(period, companyContext.selectedCompany);
    if (!query.available) { render(); return; }
    document.dispatchEvent(new CustomEvent("calendar-period:search", { detail: { period: query, company: companyContext.selectedCompany } }));
  });
}

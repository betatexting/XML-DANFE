export function calendarMonth(year, month) {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) throw new Error("Mes ou ano invalido.");
  const first = new Date(0), last = new Date(0);
  first.setUTCFullYear(year, month - 1, 1); first.setUTCHours(0, 0, 0, 0);
  last.setUTCFullYear(year, month, 0); last.setUTCHours(0, 0, 0, 0);
  const firstWeekday = first.getUTCDay(), days = last.getUTCDate();
  const weeks = Math.ceil((firstWeekday + days) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day < 1 || day > days ? null : { day, date: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
  });
  return { year, month, days, firstWeekday, weeks, cells };
}

export function calendarToday(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", { timeZone: "America/Bahia", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now).map(({ type, value }) => [type, value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

export function selectCalendarDate(period, date) {
  if (date !== null && !calendarMonth(period.year, period.month).cells.some((cell) => cell?.date === date)) throw new Error("Data invalida para o mes exibido.");
  if (date === null || (period.startDate === date && !period.endDate)) return { ...period, startDate: null, endDate: null };
  if (!period.startDate || period.endDate) return { ...period, startDate: date, endDate: null };
  return { ...period, startDate: [period.startDate, date].sort()[0], endDate: [period.startDate, date].sort()[1] };
}

export function calendarQueryPeriod(period, limitDate = null) {
  const model = calendarMonth(period.year, period.month);
  const prefix = `${String(period.year).padStart(4, "0")}-${String(period.month).padStart(2, "0")}-`;
  const startDate = period.startDate || `${prefix}01`;
  let endDate = period.endDate || period.startDate || `${prefix}${String(model.days).padStart(2, "0")}`;
  if (limitDate && limitDate.startsWith(prefix) && endDate > limitDate) endDate = limitDate;
  return { year: period.year, month: period.month, startDate, endDate, mode: period.startDate ? "range" : "month", available: startDate <= endDate };
}

export function companyCalendarPeriod(period, company, now = new Date()) {
  const current = calendarToday(now);
  if (period.year !== current.year || period.month !== current.month) return calendarQueryPeriod(period);
  const requested = calendarQueryPeriod(period);
  const timestamp = typeof company?.lastCompletedQueryAt === "string" ? Date.parse(company.lastCompletedQueryAt) : NaN;
  if (Number.isFinite(timestamp) && timestamp <= now.getTime()) {
    const last = calendarToday(new Date(timestamp));
    const limit = `${last.year}-${String(last.month).padStart(2, "0")}-${String(last.day).padStart(2, "0")}`;
    const processedEndDate = requested.endDate < limit ? requested.endDate : limit;
    return { ...requested, lastCompletedDate: limit, processedEndDate: processedEndDate >= requested.startDate ? processedEndDate : null };
  }
  return { ...requested, lastCompletedDate: null, processedEndDate: null, reason: "no_completed_query" };
}

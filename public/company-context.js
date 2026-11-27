let state = Object.freeze({ companies: Object.freeze([]), selectedCompanyId: null, loaded: false });
const listeners = new Set();
let queue = Promise.resolve();

function publish(data) {
  const companies = Object.freeze(data.companies.map((company) => Object.freeze({ ...company })));
  state = Object.freeze({ companies, selectedCompanyId: data.selectedCompanyId, loaded: true });
  for (const listener of listeners) listener(state);
  document.dispatchEvent(new CustomEvent("company-context:changed", { detail: state }));
  return state;
}
function run(task) { const result = queue.then(task); queue = result.catch(() => {}); return result; }
async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Nao foi possivel carregar as empresas.");
  return publish(data);
}

export const companyContext = {
  get state() { return state; },
  get selectedCompany() { return state.companies.find((company) => company.id === state.selectedCompanyId) || null; },
  subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
  refresh() { return run(() => request("/api/companies")); },
  select(companyId) {
    return run(() => request("/api/companies/selection", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId })
    }));
  }
};

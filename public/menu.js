document.querySelector("#manualNotesButton").addEventListener("click", () => {
  window.location.assign("/consultas");
});
document.querySelector("#automaticNotesButton").addEventListener("click", () => {
  window.location.assign("/notas-automaticas");
});
document.querySelector("#keySheetsButton").addEventListener("click", () => window.location.assign("/planilhas-chaves"));

const desktop = window.consultaDanfeDesktop;
if (desktop?.isDesktop) {
  document.body.classList.add("is-desktop");
  document.querySelector(".login-window-actions").hidden = false;
  document.querySelector("#menuMinimize").addEventListener("click", () => desktop.minimizeWindow());
  document.querySelector("#menuClose").addEventListener("click", () => desktop.closeWindow());
}

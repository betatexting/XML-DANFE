const form = document.querySelector("#loginForm");
const username = document.querySelector("#loginUsername");
const password = document.querySelector("#loginPassword");
const remember = document.querySelector("#rememberLogin");
const submit = document.querySelector("#loginSubmit");
const message = document.querySelector("#loginMessage");
const setupDialog = document.querySelector("#setupDialog");
const setupPassword = document.querySelector("#setupPassword");
const setupMessage = document.querySelector("#setupMessage");
const desktop = window.consultaDanfeDesktop;
let configured = true;
let ready = false;
let busy = false;
let canRemember = false;

function updateButton() { submit.disabled = !ready || busy || !username.value.trim() || !password.value; }
function setBusy(value) {
  busy = value;
  username.disabled = password.disabled = value;
  remember.disabled = value || !canRemember;
  for (const button of setupDialog.querySelectorAll("button")) button.disabled = value;
  updateButton();
}
async function authenticate(endpoint) {
  setBusy(true);
  message.textContent = setupMessage.textContent = "";
  try {
    const credentials = { username: username.value.trim(), password: password.value };
    const response = await fetch(`/api/auth/${endpoint}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentials)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Nao foi possivel entrar.");
    configured = true;
    setupDialog.close();
    if (desktop?.isDesktop) {
      try {
        if (remember.checked) await desktop.saveLogin(credentials);
        else await desktop.forgetLogin();
      } catch {
        message.textContent = "Acesso validado, mas nao foi possivel salvar a senha neste computador. Entre novamente sem marcar salvar.";
        remember.checked = false;
        return;
      }
    }
    password.value = setupPassword.value = "";
    window.location.replace("/menu");
  } catch (error) {
    if (setupDialog.open) setupMessage.textContent = error.message;
    else message.textContent = error.message;
  } finally { setBusy(false); }
}

form.addEventListener("input", updateButton);
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || !ready || !form.reportValidity()) return;
  if (!configured) {
    if (password.value.length < 8) { message.textContent = "Para criar o acesso, use uma senha com pelo menos 8 caracteres."; return; }
    setupMessage.textContent = "";
    setupPassword.value = "";
    setupDialog.showModal();
    setupPassword.focus();
    return;
  }
  await authenticate("login");
});
document.querySelector("#setupCancel").addEventListener("click", () => setupDialog.close());
document.querySelector("#setupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  if (setupPassword.value !== password.value) { setupMessage.textContent = "As senhas nao coincidem."; return; }
  await authenticate("setup");
});
remember.addEventListener("change", async () => {
  if (!remember.checked && desktop?.forgetLogin) {
    try { await desktop.forgetLogin(); }
    catch { message.textContent = "Nao foi possivel remover o acesso salvo."; }
  }
});

async function initializeLogin() {
  try {
    const response = await fetch("/api/auth/status");
    if (!response.ok) throw new Error("Nao foi possivel verificar o acesso local.");
    const status = await response.json();
    configured = status.configured;
    if (!configured) message.textContent = "Primeiro acesso: escolha seu login e senha.";
    if (desktop?.isDesktop) {
      document.body.classList.add("is-desktop");
      document.querySelector(".login-window-actions").hidden = false;
      document.querySelector("#loginMinimize").addEventListener("click", () => desktop.minimizeWindow());
      document.querySelector("#loginClose").addEventListener("click", () => desktop.closeWindow());
      const saved = await desktop.restoreLogin();
      canRemember = saved.available;
      remember.disabled = !canRemember;
      if (!saved.available) remember.title = "A protecao de senhas do Windows nao esta disponivel.";
      if (saved.credentials) {
        username.value = saved.credentials.username;
        password.value = saved.credentials.password;
        remember.checked = true;
      }
      if (saved.warning) message.textContent = saved.warning;
    } else {
      remember.disabled = true;
      remember.title = "Salvar login e senha esta disponivel no aplicativo desktop.";
    }
    ready = true;
    updateButton();
  } catch (error) { message.textContent = error.message || "Nao foi possivel abrir o acesso local."; }
}
initializeLogin();

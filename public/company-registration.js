(() => {
  const desktop = window.consultaDanfeDesktop;
  const form = document.querySelector("#companyRegistrationForm"), message = document.querySelector("#registrationMessage");
  const documentInput = document.querySelector("#companyDocument"), documentType = document.querySelector("#companyDocumentType"), documentMessage = document.querySelector("#documentValidationMessage");
  function checkDocument() {
    const result = window.CompanyDocumentValidation.validateDocument(documentType.value, documentInput.value);
    const error = documentInput.value.trim() ? result.message : "";
    documentInput.setCustomValidity(error);
    documentInput.setAttribute("aria-invalid", String(Boolean(error)));
    documentMessage.textContent = error;
    return result.valid;
  }
  documentInput.addEventListener("blur", checkDocument);
  documentType.addEventListener("change", checkDocument);
  documentInput.addEventListener("input", () => {
    documentInput.setCustomValidity(""); documentInput.removeAttribute("aria-invalid"); documentMessage.textContent = "";
    if (message.textContent) message.textContent = "";
  });
  documentInput.addEventListener("invalid", checkDocument);
  let saving = false, importing = false, certificate = null;
  const certificatePassword = document.querySelector("#companyCertificatePassword"), importCertificate = document.querySelector("#registrationImportCertificate"), removeCertificate = document.querySelector("#registrationRemoveCertificate");
  const nfseProxy = document.querySelector("#companyNfseProxy");
  function renderProxy() {
    form.elements.portalLogin.required = !nfseProxy.checked;
    form.elements.portalPassword.required = !nfseProxy.checked;
  }
  nfseProxy.addEventListener("change", renderProxy);
  function renderCertificate() {
    document.querySelector("#registrationCertificateFile").textContent = certificate?.fileName || "Nenhum certificado selecionado.";
    certificatePassword.disabled = saving || importing || !certificate;
    removeCertificate.disabled = saving || importing || !certificate;
    importCertificate.disabled = saving || importing;
  }
  importCertificate.addEventListener("click", async () => {
    if (saving || importing) return;
    if (!desktop?.selectCompanyCertificate) { message.textContent = "Abra o aplicativo desktop para importar o certificado."; return; }
    importing = true; renderCertificate();
    try {
      const result = await desktop.selectCompanyCertificate();
      if (result?.error) { message.textContent = result.error; return; }
      if (result?.token) { certificate = { token: result.token, fileName: result.fileName }; certificatePassword.value = ""; message.textContent = ""; }
    } catch { message.textContent = "Não foi possível importar o certificado."; }
    finally { importing = false; renderCertificate(); if (certificate) certificatePassword.focus(); }
  });
  removeCertificate.addEventListener("click", async () => {
    if (saving || importing) return;
    importing = true; renderCertificate();
    try { await desktop.clearCompanyCertificate(); certificate = null; certificatePassword.value = ""; message.textContent = ""; }
    catch { message.textContent = "Não foi possível remover o certificado selecionado."; }
    finally { importing = false; renderCertificate(); }
  });
  function close() { if (!saving) { if (desktop?.isDesktop) desktop.closeWindow(); else window.close(); } }
  if (desktop?.isDesktop) document.body.classList.add("is-desktop");
  else document.querySelector("#registrationMinimize").hidden = true;
  document.querySelector("#registrationMinimize").addEventListener("click", () => desktop?.minimizeWindow());
  for (const id of ["registrationBack", "registrationClose", "registrationCancel"]) document.getElementById(id).addEventListener("click", close);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving || importing) return;
    const validDocument = checkDocument();
    if (!form.reportValidity() || !validDocument) return;
    if (!desktop?.createCompany) { message.textContent = "Abra o aplicativo desktop para salvar o cadastro com proteção das credenciais."; return; }
    const input = Object.fromEntries(new FormData(form));
    if (nfseProxy.checked) {
      if (!certificate) { message.textContent = "Importe o certificado A1 do procurador."; return; }
      input.nfseProxy = true;
    }
    if (certificate) input.certificateToken = certificate.token;
    saving = true; message.textContent = "Salvando cadastro…";
    const controls = [...document.querySelectorAll("button, input, select")];
    for (const control of controls) control.disabled = true;
    try {
      const result = await desktop.createCompany(input);
      if (!result?.ok) { message.textContent = result?.error || "Não foi possível salvar o cadastro."; return; }
      form.reset();
      renderProxy();
      certificate = null; renderCertificate();
      documentInput.setCustomValidity(""); documentInput.removeAttribute("aria-invalid"); documentMessage.textContent = "";
      message.textContent = "Empresa cadastrada com sucesso.";
    } catch { message.textContent = "Não foi possível salvar o cadastro. Tente novamente."; }
    finally {
      input.portalPassword = "";
      input.certificatePassword = "";
      saving = false; for (const control of controls) control.disabled = false;
      renderCertificate();
    }
  });
})();

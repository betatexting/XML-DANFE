const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("consultaDanfeDesktop", {
  isDesktop: true,
  openCompanyRegistration: () => ipcRenderer.invoke("company-window:open"),
  createCompany: (input) => ipcRenderer.invoke("company:create", input),
  selectCompanyCertificate: () => ipcRenderer.invoke("company-certificate:select"),
  clearCompanyCertificate: () => ipcRenderer.invoke("company-certificate:clear"),
  onCompanyRegistered: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("company:registered", listener);
    return () => ipcRenderer.removeListener("company:registered", listener);
  },
  restoreLogin: () => ipcRenderer.invoke("login:restore"),
  saveLogin: (credentials) => ipcRenderer.invoke("login:save", credentials),
  forgetLogin: () => ipcRenderer.invoke("login:forget"),
  selectDownloadsDir: () => ipcRenderer.invoke("downloads-dir:select"),
  selectCertificate: () => ipcRenderer.invoke("certificate:select"),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  getWindowState: () => ipcRenderer.invoke("window:get-state"),
  startWindowResize: (edge) => ipcRenderer.invoke("window:resize-start", edge),
  resizeWindow: () => ipcRenderer.invoke("window:resize"),
  endWindowResize: () => ipcRenderer.invoke("window:resize-end"),
  onWindowStateChange: (callback) => {
    const listener = (_event, state) => {
      if (typeof callback === "function") {
        callback(state);
      }
    };

    ipcRenderer.on("window:state-changed", listener);

    return () => {
      ipcRenderer.removeListener("window:state-changed", listener);
    };
  }
});

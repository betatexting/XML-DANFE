const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("consultaDanfeDesktop", {
  isDesktop: true,
  selectDownloadsDir: () => ipcRenderer.invoke("downloads-dir:select"),
  selectCertificate: () => ipcRenderer.invoke("certificate:select"),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  getWindowState: () => ipcRenderer.invoke("window:get-state"),
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

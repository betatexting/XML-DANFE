(() => {
  const desktop = window.consultaDanfeDesktop;
  for (const button of document.querySelectorAll("[data-back-target]")) {
    button.addEventListener("click", () => window.location.assign(button.dataset.backTarget));
    const group = button.closest(".login-window-actions");
    if (group) {
      group.hidden = false;
      group.classList.add("screen-navigation");
      if (!desktop?.isDesktop) for (const control of group.querySelectorAll("[data-native-window-control]")) control.hidden = true;
    } else if (!desktop?.isDesktop) {
      button.classList.add("standalone-screen-back");
      document.body.append(button);
    }
  }
  const panel = document.querySelector(".login-panel");
  if (!panel || !desktop?.startWindowResize) return;
  const layer = document.createElement("div");
  layer.className = "window-resize-layer";
  layer.setAttribute("aria-hidden", "true");
  let drag = null;
  let pending = false;
  function end() {
    if (drag) drag.finished = true;
    drag = null;
    desktop.endWindowResize().catch(() => {});
  }
  for (const edge of ["n", "s", "w", "e", "nw", "ne", "sw", "se"]) {
    const handle = document.createElement("div");
    handle.className = "window-resize-handle";
    handle.dataset.edge = edge;
    handle.addEventListener("pointerdown", async (event) => {
      if (event.button !== 0 || drag) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const current = { finished: false, ready: false };
      drag = current;
      try {
        const accepted = await desktop.startWindowResize(edge);
        if (!accepted || current.finished) { end(); return; }
        current.ready = true;
      } catch { end(); }
    });
    handle.addEventListener("pointermove", () => {
      if (!drag?.ready || pending) return;
      pending = true;
      requestAnimationFrame(async () => {
        try { if (drag?.ready) await desktop.resizeWindow(); }
        catch { end(); }
        finally { pending = false; }
      });
    });
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("lostpointercapture", end);
    layer.append(handle);
  }
  panel.append(layer);
})();

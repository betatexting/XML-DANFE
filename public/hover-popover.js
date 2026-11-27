export function bindHoverPopover({ group, trigger, popup, bridge, onClose = () => {}, onOpen = () => {}, isBusy = () => false }) {
  let closeTimer = null;
  function open() {
    clearTimeout(closeTimer); closeTimer = null;
    const wasHidden = popup.hidden;
    popup.hidden = false; group.dataset.open = "true"; trigger.setAttribute("aria-expanded", "true");
    if (wasHidden) document.dispatchEvent(new CustomEvent("tool-popover:opened", { detail: { id: popup.id } }));
    onOpen();
  }
  function close() {
    clearTimeout(closeTimer); closeTimer = null;
    popup.hidden = true; group.dataset.open = "false"; trigger.setAttribute("aria-expanded", "false"); onClose();
  }
  function leave(event) {
    if (event.pointerType === "touch" || group.contains(event.relatedTarget)) return;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { if (!group.matches(":hover")) close(); }, 120);
  }
  for (const area of [group, popup, bridge].filter(Boolean)) {
    area.addEventListener("pointerenter", (event) => { if (event.pointerType !== "touch") open(); });
    area.addEventListener("pointerleave", leave);
  }
  group.addEventListener("focusin", open);
  group.addEventListener("focusout", (event) => { if (!isBusy() && !group.contains(event.relatedTarget) && !group.matches(":hover")) close(); });
  trigger.addEventListener("click", open);
  document.addEventListener("pointerdown", (event) => { if (!group.contains(event.target)) close(); });
  document.addEventListener("tool-popover:opened", (event) => { if (event.detail.id !== popup.id) close(); });
  group.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); trigger.focus(); close(); }
  });
  return { open, close };
}

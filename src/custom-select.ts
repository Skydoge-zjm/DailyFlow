const ENHANCED = "customSelectEnhanced";
let closeListenerInstalled = false;
const menus = new WeakMap<HTMLElement, HTMLElement>();
const openWrappers = new Set<HTMLElement>();

function closeAll(except?: HTMLElement): void {
  openWrappers.forEach((wrapper) => {
    if (wrapper !== except) close(wrapper);
  });
}

function close(wrapper: HTMLElement): void {
  wrapper.classList.remove("is-open");
  openWrappers.delete(wrapper);
  const trigger = wrapper.querySelector<HTMLButtonElement>(".custom-select-trigger");
  const menu = menus.get(wrapper);
  trigger?.setAttribute("aria-expanded", "false");
  if (menu) {
    menu.hidden = true;
    if (wrapper.isConnected) wrapper.append(menu);
    else menu.remove();
  }
}

function positionMenu(menu: HTMLElement, trigger: HTMLElement): void {
  const rect = trigger.getBoundingClientRect();
  const gap = 6;
  const estimatedHeight = Math.min(320, Math.max(42, menu.scrollHeight + 2));
  const roomBelow = window.innerHeight - rect.bottom;
  const top = roomBelow >= estimatedHeight || rect.top < estimatedHeight
    ? rect.bottom + gap
    : rect.top - estimatedHeight - gap;
  menu.style.left = `${Math.round(rect.left)}px`;
  menu.style.top = `${Math.round(Math.max(8, top))}px`;
  menu.style.minWidth = `${Math.round(rect.width)}px`;
  menu.style.maxWidth = `${Math.round(Math.max(rect.width, 320))}px`;
}

function sync(wrapper: HTMLElement, select: HTMLSelectElement): void {
  const trigger = wrapper.querySelector<HTMLButtonElement>(".custom-select-trigger");
  const selected = select.options[select.selectedIndex];
  if (!trigger) return;
  const selectedText = selected?.textContent || selected?.value || "选择选项";
  const label = select.getAttribute("aria-label") || "";
  trigger.textContent = selectedText;
  trigger.setAttribute("aria-label", label ? `${label}: ${selectedText}` : selectedText);
  trigger.disabled = select.disabled;
  trigger.setAttribute("aria-disabled", String(select.disabled));
  wrapper.classList.toggle("is-disabled", select.disabled);
  menus.get(wrapper)?.querySelectorAll<HTMLElement>(".custom-select-option").forEach((option) => {
    const active = option.dataset.value === select.value;
    option.classList.toggle("is-selected", active);
    option.setAttribute("aria-selected", String(active));
  });
}

function enhance(select: HTMLSelectElement): void {
  if (select.dataset[ENHANCED] === "true" || !select.options.length) return;
  select.dataset[ENHANCED] = "true";

  const wrapper = document.createElement("div");
  wrapper.className = "custom-select";
  select.parentElement?.insertBefore(wrapper, select);
  wrapper.append(select);
  select.classList.add("native-select-source");
  select.setAttribute("aria-hidden", "true");
  select.tabIndex = -1;

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "custom-select-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", select.getAttribute("aria-label") || "选择选项");
  wrapper.append(trigger);

  const menu = document.createElement("div");
  menu.className = "custom-select-menu";
  menu.hidden = true;
  menu.setAttribute("role", "listbox");
  wrapper.append(menu);
  menus.set(wrapper, menu);

  Array.from(select.options).forEach((option) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "custom-select-option";
    item.dataset.value = option.value;
    item.textContent = option.textContent || option.value;
    item.setAttribute("role", "option");
    item.addEventListener("click", (event) => {
      event.preventDefault();
      if (select.disabled || option.disabled) return;
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      sync(wrapper, select);
      close(wrapper);
      trigger.focus({ preventScroll: true });
    });
    menu.append(item);
  });

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    if (select.disabled) return;
    const open = wrapper.classList.contains("is-open");
    if (open) {
      close(wrapper);
      return;
    }
    closeAll();
    {
      wrapper.classList.add("is-open");
      openWrappers.add(wrapper);
      // Mount outside transformed/scrollable dialogs so fixed coordinates use the viewport.
      document.body.append(menu);
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      positionMenu(menu, trigger);
      const selected = menu.querySelector<HTMLElement>(`.custom-select-option[data-value="${CSS.escape(select.value)}"]`);
      if (selected) menu.scrollTop = Math.max(0, selected.offsetTop - menu.clientHeight / 2);
    }
  });

  select.addEventListener("change", () => sync(wrapper, select));
  select.addEventListener("input", () => sync(wrapper, select));
  const onEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !openWrappers.has(wrapper)) return;
    event.preventDefault();
    event.stopPropagation();
    close(wrapper);
    trigger.focus({ preventScroll: true });
  };
  trigger.addEventListener("keydown", onEscape);
  menu.addEventListener("keydown", onEscape);
  const attributes = new MutationObserver(() => sync(wrapper, select));
  attributes.observe(select, { attributes: true, attributeFilter: ["disabled", "aria-label"] });
  sync(wrapper, select);
}

export function enhanceCustomSelects(root: ParentNode = document): void {
  root.querySelectorAll<HTMLSelectElement>("select:not([data-custom-select-enhanced])").forEach(enhance);
  if (!closeListenerInstalled) {
    closeListenerInstalled = true;
    document.addEventListener("pointerdown", (event) => {
      if (!(event.target instanceof Element) || !event.target.closest(".custom-select, .custom-select-menu")) closeAll();
    });
    window.addEventListener("resize", () => closeAll());
    window.addEventListener("scroll", (event) => {
      if (event.target instanceof Element && event.target.closest(".custom-select-menu")) return;
      closeAll();
    }, true);
  }
}

export function observeCustomSelects(): MutationObserver {
  const observer = new MutationObserver((records) => {
    for (const wrapper of openWrappers) {
      if (!wrapper.isConnected) close(wrapper);
    }
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node instanceof Element) enhanceCustomSelects(node);
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  enhanceCustomSelects(document);
  return observer;
}

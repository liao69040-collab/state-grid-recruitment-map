export const MAP_CANVAS_WIDTH = 1920;
export const MAP_CANVAS_HEIGHT = 1080;
export const MAP_CANVAS_SENTINEL = "1920x1080";

// The user holds the device in landscape. Never simulate that by rotating a
// portrait page: the only chart transform is a uniform, axis-aligned scale.
export function getCanvasFit(width, height) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const rotated = false;
  const fittedWidth = MAP_CANVAS_WIDTH;
  const fittedHeight = MAP_CANVAS_HEIGHT;
  const scale = Math.min(safeWidth / fittedWidth, safeHeight / fittedHeight);
  const left = (safeWidth - fittedWidth * scale) / 2;
  const top = (safeHeight - fittedHeight * scale) / 2;
  const matrix = [scale, 0, 0, scale, left, top];
  return { scale, rotated, left, top, width: fittedWidth * scale, height: fittedHeight * scale, matrix };
}

export function isPortraitViewport(width, height, { editing = false, keyboardSettling = false, previousWidth, previousPortrait } = {}) {
  // A keyboard can resize the layout viewport too (older Android WebViews).
  // Preserve direction while typing, including the delayed IME resize after
  // hiding/blurring an input. Ordinary split-view height changes are not an
  // IME transition and must still re-evaluate the real available layout area.
  if ((editing || keyboardSettling) && typeof previousPortrait === "boolean" && Math.abs(Number(width) - Number(previousWidth)) < 2) {
    return previousPortrait;
  }
  return Number(height) > Number(width);
}

export function getVisibleBounds(layoutWidth, layoutHeight, visualViewport) {
  const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : Math.max(1, Number(fallback) || 1);
  const offset = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  return {
    width: positive(visualViewport?.width, layoutWidth),
    height: positive(visualViewport?.height, layoutHeight),
    left: offset(visualViewport?.offsetLeft),
    top: offset(visualViewport?.offsetTop),
  };
}

export function createCanvasUrl(locationHref) {
  const url = new URL(locationHref);
  url.searchParams.set("__map_canvas", MAP_CANVAS_SENTINEL);
  return url.href;
}

export function responsivePageUrl(locationHref, hash) {
  if (!/^#\/(?:information|mobile)(?:[/?]|$)/.test(hash)) return null;
  const url = new URL(locationHref);
  url.searchParams.delete("__map_canvas");
  url.hash = hash;
  return url.href;
}

export function informationModalUrl(locationHref, requestedUrl) {
  try {
    const base = new URL(locationHref);
    const url = new URL(requestedUrl, base);
    if (url.origin !== base.origin || url.pathname !== base.pathname || !/^#\/information(?:[/?]|$)/.test(url.hash)) return null;
    url.searchParams.delete("__map_canvas");
    url.searchParams.set("__information_modal", "1");
    return url.href;
  } catch { return null; }
}

function mountTouchHost() {
  if (document.getElementById("map-touch-host")) return;
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = new URL("./map-touch-host.css", import.meta.url).href;
  document.head.append(stylesheet);

  const host = document.createElement("main");
  host.id = "map-touch-host";
  host.setAttribute("aria-label", "国家电网地图横向桌面画布");
  const viewport = document.createElement("div");
  viewport.id = "map-touch-viewport";
  viewport.hidden = true;
  const frame = document.createElement("iframe");
  frame.id = "map-desktop-frame";
  frame.title = "全国电网招聘数据地图（桌面等比例横屏）";
  frame.width = String(MAP_CANVAS_WIDTH);
  frame.height = String(MAP_CANVAS_HEIGHT);
  frame.allow = "fullscreen";
  // No sandbox: same-origin session cookies, normal form controls, external
  // source links and user-opened windows retain the existing app behavior.
  // Do not fetch/mount the expensive business app until the viewport really
  // becomes landscape. Once mounted, keep this exact node across rotations.

  const prompt = document.createElement("section");
  prompt.id = "map-landscape-prompt";
  prompt.setAttribute("aria-labelledby", "map-landscape-title");
  const icon = document.createElement("div");
  icon.className = "landscape-device";
  icon.setAttribute("aria-hidden", "true");
  const heading = document.createElement("h1");
  heading.id = "map-landscape-title";
  heading.textContent = "请将手机或平板横过来";
  const description = document.createElement("p");
  description.textContent = "横屏后自动显示完整数据地图，布局与电脑端保持一致。";
  const action = document.createElement("button");
  action.id = "map-landscape-action";
  action.type = "button";
  action.textContent = "尝试开启横屏";
  action.hidden = typeof window.screen?.orientation?.lock !== "function";
  const help = document.createElement("p");
  help.id = "map-landscape-help";
  help.setAttribute("role", "status");
  help.textContent = "没有自动旋转？请关闭手机的方向锁定。微信内仍无法横屏时，可在手机浏览器中打开。";
  prompt.append(icon, heading, description, action, help);

  const status = document.createElement("div");
  status.id = "map-touch-status";
  status.setAttribute("role", "status");
  status.textContent = "正在载入横向数据地图…";
  viewport.append(frame, status);
  host.append(viewport, prompt);
  document.body.append(host);

  let animationId = 0;
  let childWindow = null;
  let started = false;
  let previousWidth;
  let previousPortrait;
  let keyboardSettling = null;
  let informationDialog = null;
  let informationFrame = null;
  let informationTrigger = null;
  const closeInformation = () => {
    const wasOpen = Boolean(informationDialog);
    informationDialog?.remove();
    informationDialog = null;
    informationFrame = null;
    host.inert = false;
    try { informationTrigger?.focus(); } catch { frame.focus(); }
    informationTrigger = null;
    if (wasOpen) {
      try { childWindow?.dispatchEvent(new childWindow.Event("grid-information-auth-refresh")); } catch { /* Session is rechecked by the map, no credentials cross windows. */ }
    }
  };
  const handleInformationMessage = (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type === "grid-information-close" && informationFrame && event.source === informationFrame.contentWindow) {
      closeInformation();
      return;
    }
    if (event.source !== frame.contentWindow || event.data?.type !== "grid-information-open") return;
    const url = informationModalUrl(window.location.href, event.data.url);
    if (!url) return;
    if (informationFrame) { informationFrame.src = url; return; }
    try { informationTrigger = frame.contentDocument?.activeElement; } catch { informationTrigger = null; }
    informationDialog = document.createElement("dialog");
    informationDialog.className = "touch-information-dialog";
    informationDialog.setAttribute("aria-label", "2026年信息汇总");
    const toolbar = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = "2026年信息汇总";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "关闭";
    close.setAttribute("aria-label", "关闭信息汇总，返回地图");
    close.addEventListener("click", closeInformation);
    toolbar.append(title, close);
    informationFrame = document.createElement("iframe");
    informationFrame.title = "电网招聘信息汇总";
    informationFrame.src = url;
    informationDialog.append(toolbar, informationFrame);
    informationDialog.addEventListener("cancel", (cancelEvent) => { cancelEvent.preventDefault(); closeInformation(); });
    document.body.append(informationDialog);
    host.inert = true;
    informationDialog.showModal();
    close.focus();
  };
  const isEditing = () => {
    try {
      const active = frame.contentDocument?.activeElement;
      // The original reference page is a sandboxed nested iframe. Its DOM is
      // intentionally unreadable; focused content may be an input, so preserve
      // the current orientation conservatively through keyboard-only resizes.
      return active?.isContentEditable === true || /^(INPUT|TEXTAREA|SELECT|IFRAME)$/.test(active?.tagName || "");
    } catch { return false; }
  };
  const updateFit = () => {
    animationId = 0;
    // IME and native zoom can change only the visual viewport, leaving 100dvh
    // unchanged. Fit its visible rectangle in layout CSS pixels; safe-area
    // padding stays on the host, outside the area used to fit the iframe.
    const visible = getVisibleBounds(window.innerWidth, window.innerHeight, window.visualViewport);
    host.style.width = `${visible.width}px`;
    host.style.height = `${visible.height}px`;
    host.style.left = `${visible.left}px`;
    host.style.top = `${visible.top}px`;
    // The viewport is authoritative, including split-screen/WeChat containers.
    // screen.orientation can lag a layout event; its events only request a fit.
    if (keyboardSettling) {
      if (Math.abs(window.innerWidth - keyboardSettling.width) >= 2) keyboardSettling = null;
      else if (window.innerHeight < keyboardSettling.height - 2) keyboardSettling.sawShrink = true;
      else if (keyboardSettling.sawShrink) keyboardSettling = null;
    }
    const editing = isEditing();
    const portrait = isPortraitViewport(window.innerWidth, window.innerHeight, {
      editing, keyboardSettling: Boolean(keyboardSettling), previousWidth, previousPortrait,
    });
    previousWidth = window.innerWidth;
    previousPortrait = portrait;
    host.dataset.orientation = portrait ? "portrait" : "landscape";
    prompt.hidden = !portrait;
    viewport.hidden = portrait;
    frame.inert = portrait;
    if (portrait) {
      if (editing && !keyboardSettling) {
        keyboardSettling = { width: window.innerWidth, height: window.innerHeight, sawShrink: false };
      }
      try { frame.contentDocument?.activeElement?.blur?.(); } catch { /* External navigation. */ }
      return;
    }
    const fit = getCanvasFit(viewport.clientWidth, viewport.clientHeight);
    frame.style.transform = `matrix(${fit.matrix.join(",")})`;
    host.dataset.scale = String(fit.scale);
    if (!started) {
      started = true;
      frame.src = createCanvasUrl(window.location.href);
    }
  };
  const scheduleFit = () => {
    if (!animationId) animationId = window.requestAnimationFrame(updateFit);
  };
  const syncHostHash = () => {
    try {
      const responsiveUrl = childWindow && responsivePageUrl(window.location.href, childWindow.location.hash);
      if (responsiveUrl) { window.location.assign(responsiveUrl); window.location.reload(); return; }
      if (childWindow && childWindow.location.hash !== window.location.hash) {
        const next = new URL(window.location.href);
        next.hash = childWindow.location.hash;
        window.history.replaceState(window.history.state, "", next.href);
      }
    } catch { /* A user-followed external navigation is not a route to mirror. */ }
  };
  const syncFrameHash = () => {
    try {
      if (responsivePageUrl(window.location.href, window.location.hash)) { window.location.reload(); return; }
      if (childWindow && childWindow.location.hash !== window.location.hash) childWindow.location.hash = window.location.hash;
    } catch { /* Do not navigate an external page a second time. */ }
  };
  const notifyFullscreen = () => {
    scheduleFit();
    try {
      childWindow?.dispatchEvent(new childWindow.Event("map-host-fullscreenchange"));
    } catch { /* Only the same-origin map can receive this UI notification. */ }
  };
  const handleLoad = () => {
    if (!started) return; // The initial empty iframe is not a failed map load.
    try {
      if (!frame.contentDocument?.documentElement.classList.contains("touch-desktop-canvas")) {
        status.textContent = "地图画布未能加载，请刷新重试或联系管理员。";
        return;
      }
      childWindow?.removeEventListener("hashchange", syncHostHash);
      childWindow = frame.contentWindow;
      childWindow?.addEventListener("hashchange", syncHostHash);
      syncHostHash();
      status.hidden = true;
    } catch {
      status.textContent = "地图载入失败，请刷新页面重试。";
    }
    scheduleFit();
  };
  const requestLandscape = async () => {
    if (action.disabled) return;
    action.disabled = true;
    try {
      if (typeof window.screen?.orientation?.lock !== "function") throw new Error("orientation-lock-unavailable");
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
      await window.screen.orientation.lock("landscape");
      // Do not hide the prompt on promise resolution. Only a real landscape
      // viewport authorizes showing the map, even if a WebView lies about lock.
      help.textContent = "请将设备横过来，横屏后会自动进入地图。";
    } catch {
      help.textContent = "当前浏览器不支持自动横屏。请关闭手机方向锁定后横过来；仍无法旋转时，请在手机浏览器中打开。";
    } finally {
      action.disabled = false;
      scheduleFit();
    }
  };
  action.addEventListener("click", requestLandscape);
  frame.addEventListener("load", handleLoad);
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(scheduleFit) : null;
  observer?.observe(viewport);
  window.addEventListener("resize", scheduleFit);
  window.addEventListener("orientationchange", scheduleFit);
  window.screen?.orientation?.addEventListener?.("change", scheduleFit);
  window.addEventListener("hashchange", syncFrameHash);
  window.addEventListener("message", handleInformationMessage);
  window.visualViewport?.addEventListener("resize", scheduleFit);
  window.visualViewport?.addEventListener("scroll", scheduleFit);
  document.addEventListener("fullscreenchange", notifyFullscreen);
  stylesheet.addEventListener("load", scheduleFit);
  updateFit();

  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    if (animationId) window.cancelAnimationFrame(animationId);
    observer?.disconnect();
    window.removeEventListener("resize", scheduleFit);
    window.removeEventListener("orientationchange", scheduleFit);
    window.screen?.orientation?.removeEventListener?.("change", scheduleFit);
    window.removeEventListener("hashchange", syncFrameHash);
    window.removeEventListener("message", handleInformationMessage);
    closeInformation();
    window.visualViewport?.removeEventListener("resize", scheduleFit);
    window.visualViewport?.removeEventListener("scroll", scheduleFit);
    document.removeEventListener("fullscreenchange", notifyFullscreen);
    childWindow?.removeEventListener("hashchange", syncHostHash);
    action.removeEventListener("click", requestLandscape);
  });
  window.addEventListener("pageshow", scheduleFit);
}

if (typeof document !== "undefined" && document.documentElement.classList.contains("touch-desktop-host")) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountTouchHost, { once: true });
  else mountTouchHost();
}

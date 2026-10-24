(() => {
  // Query/reading routes use real device pixels, never a scaled desktop iframe.
  if (/^#\/(?:mobile|information)(?:[/?]|$)/.test(window.location.hash)) return;
  const qaProfile = new URLSearchParams(window.location.search).get("qa");
  const qaTouchTablet = qaProfile === "touch-tablet";
  const qaTouchPhone = qaProfile === "touch-phone";
  const qaTouchProfile = qaTouchTablet || qaTouchPhone;
  const embeddedCanvas = new URLSearchParams(window.location.search).get("__map_canvas") === "1920x1080"
    && window.parent !== window;
  const hasTouch = Number(navigator.maxTouchPoints || 0) > 0;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches === true;
  const anyCoarsePointer = window.matchMedia?.("(any-pointer: coarse)").matches === true;

  // Resolve the default before Vue starts. A hash query is deliberately used so
  // a shared desktop URL remains an explicit choice on a phone. Tablet and
  // laptop map behavior is unchanged; rotating a phone does not undo its route.
  const routeQuery = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const explicitDesktop = routeQuery.get('view') === 'desktop';
  const defaultMapRoute = /^(?:#\/?|#\/index(?:[/?].*)?)$/.test(window.location.hash) || !window.location.hash;
  const phoneSize = Math.min(window.innerWidth || 0, window.innerHeight || 0) > 0
    && Math.min(window.innerWidth, window.innerHeight) <= 640;
  const phoneAgent = /iPhone|iPod|Android.*Mobile|Windows Phone/i.test(navigator.userAgent || '');
  if (!embeddedCanvas && !explicitDesktop && defaultMapRoute
    && (qaTouchPhone || phoneAgent || (phoneSize && (hasTouch || coarsePointer || anyCoarsePointer)))) {
    const url = new URL(window.location.href);
    url.searchParams.delete('__map_canvas');
    routeQuery.delete('view');
    url.hash = `/mobile${routeQuery.size ? `?${routeQuery}` : ''}`;
    window.history.replaceState(window.history.state, '', url.href);
    return;
  }

  // Some WeChat/HarmonyOS WebViews expose real touch points but report pointer
  // media queries incompletely. Any positive touch signal enables the lighter
  // rendering path before the application mounts.
  if (!embeddedCanvas && !qaTouchProfile && !hasTouch && !coarsePointer && !anyCoarsePointer) return;

  document.documentElement.classList.add("touch-performance-mode");

  if (embeddedCanvas) {
    // The same-origin iframe supplies a real 1920×1080 layout viewport, so vw,
    // vh and media queries all use the desktop composition. It must never host
    // another iframe or change the desktop viewport back to device-width.
    document.documentElement.classList.add("touch-desktop-canvas");
    return;
  }

  // The outer touch document is only a lightweight viewport host. main.ts sees
  // this class before it runs and does not load/mount a second Vue application.
  document.documentElement.classList.add("touch-desktop-host");
  const hostModule = new URL("./map-touch-host.js", document.currentScript?.src || window.location.href);
  void import(hostModule.href);
})();

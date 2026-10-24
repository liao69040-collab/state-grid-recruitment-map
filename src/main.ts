// A touch device's outer page only fits the same-origin desktop canvas. Load
// Vue/data/chart code exactly once, in that canvas (or normally on desktop).
if (!document.documentElement.classList.contains('touch-desktop-host')) {
  void import('./bootstrap')
}

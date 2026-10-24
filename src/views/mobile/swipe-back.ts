/** Rightward content swipe. Browser edge back uses the same real route history. */
export function createSwipeBack(options: { canGoBack: () => boolean; goBack: () => void }) {
  let origin: { id: number; x: number; y: number; at: number } | null = null;
  let claimed = false;
  const cancel = () => { origin = null; claimed = false; };
  const ignored = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    if (target.closest('input,textarea,select,[contenteditable="true"],[data-swipe-ignore],.mq-guide-tabs,.info-flat-nav')) return true;
    for (let element: Element | null = target; element; element = element.parentElement) {
      if (element.scrollWidth > element.clientWidth + 4 && /auto|scroll/.test(getComputedStyle(element).overflowX)) return true;
    }
    return false;
  };
  const start = (event: TouchEvent) => {
    cancel();
    if (!options.canGoBack() || event.touches.length !== 1 || ignored(event.target)) return;
    const touch = event.touches[0]!;
    origin = { id: touch.identifier, x: touch.clientX, y: touch.clientY, at: event.timeStamp };
  };
  const displacement = (touches: TouchList) => {
    if (!origin) return null;
    const touch = Array.from(touches).find(item => item.identifier === origin!.id);
    return touch ? { x: touch.clientX - origin.x, y: touch.clientY - origin.y } : null;
  };
  const move = (event: TouchEvent) => {
    if (!origin) return;
    if (event.touches.length !== 1) { cancel(); return; }
    const delta = displacement(event.touches);
    if (!delta) { cancel(); return; }
    if (Math.abs(delta.y) > 24 && Math.abs(delta.y) > Math.abs(delta.x)) { cancel(); return; }
    if (delta.x > 18 && Math.abs(delta.y) < delta.x * .55) {
      claimed = true;
      if (event.cancelable) event.preventDefault();
    }
  };
  const end = (event: TouchEvent) => {
    const delta = displacement(event.changedTouches);
    const accepted = origin && claimed && delta && delta.x >= 60 && Math.abs(delta.y) < Math.max(18, delta.x * .55) && event.timeStamp - origin.at < 900 && options.canGoBack();
    cancel();
    if (accepted) { if (event.cancelable) event.preventDefault(); options.goBack(); }
  };
  return { start, move, end, cancel };
}

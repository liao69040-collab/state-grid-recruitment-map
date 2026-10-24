import { onBeforeUnmount, watch, type Ref } from 'vue';

const activeDialogs: HTMLElement[] = [];
const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** Only rendered controls participate: closed details and inert content do not. */
export function dialogFocusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(focusableSelector)].filter(element =>
    element.tabIndex >= 0 && element.getClientRects().length > 0 && !element.closest('[inert]'));
}

/** Pure DOM controller, also used by the isolated keyboard regression tests. */
export function activateDialogFocus(root: HTMLElement, cancel: () => void, isBusy: () => boolean = () => false): () => void {
  const doc = root.ownerDocument;
  const previous = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  activeDialogs.push(root);
  const isTop = () => activeDialogs.at(-1) === root;
  const initial = () => {
    const items = dialogFocusables(root);
    return items.find(element => element.hasAttribute('data-dialog-initial')) || root;
  };
  const focusInside = () => initial().focus({ preventScroll: true });
  const onKey = (event: KeyboardEvent) => {
    if (!isTop()) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (!isBusy()) cancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = dialogFocusables(root);
    const first = items[0], last = items.at(-1);
    if (!first || !last) { event.preventDefault(); root.focus({ preventScroll: true }); return; }
    if (!root.contains(doc.activeElement) || doc.activeElement === root) {
      event.preventDefault(); (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && doc.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && doc.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  };
  const onFocus = (event: FocusEvent) => {
    if (isTop() && !root.contains(event.target as Node)) focusInside();
  };
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('focusin', onFocus);
  focusInside();
  return () => {
    const wasTop = isTop();
    const index = activeDialogs.lastIndexOf(root);
    if (index !== -1) activeDialogs.splice(index, 1);
    doc.removeEventListener('keydown', onKey);
    doc.removeEventListener('focusin', onFocus);
    if (wasTop && previous?.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
  };
}

/** Follows v-if / Teleport lifetime; does not make any API or data changes. */
export function useDialogFocus(root: Ref<HTMLElement | null>, cancel: () => void, isBusy: () => boolean = () => false) {
  let cleanup: (() => void) | undefined;
  watch(root, element => {
    cleanup?.(); cleanup = undefined;
    if (element) cleanup = activateDialogFocus(element, cancel, isBusy);
  }, { flush: 'post' });
  onBeforeUnmount(() => { cleanup?.(); cleanup = undefined; });
}

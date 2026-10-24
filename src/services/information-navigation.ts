export interface InformationPageTarget {
  province?: string;
  city?: string;
  tab?: 'batches' | 'regions' | 'schools';
  targetCohortYear?: number;
}

export const INFORMATION_OPEN_EVENT = 'grid-information-open';

export function informationPageUrl(href: string, target: InformationPageTarget = {}): string {
  const url = new URL(href);
  url.searchParams.delete('__map_canvas');
  const query = new URLSearchParams();
  if (target.province) query.set('province', target.province);
  if (target.city) query.set('city', target.city);
  if (target.tab) query.set('tab', target.tab);
  if (target.targetCohortYear) query.set('targetCohortYear', String(target.targetCohortYear));
  url.hash = `/information${query.size ? `?${query}` : ''}`;
  return url.href;
}

function navigateDocument(url: string) {
  // Mobile maps use a same-origin desktop canvas. Reading pages must leave it
  // so text, scrolling and form fields use the phone's real viewport.
  if (window.parent !== window && document.documentElement.classList.contains('touch-desktop-canvas')) {
    window.top!.location.assign(url);
  } else {
    window.location.assign(url);
    // Hash-only navigation does not rerun the pre-bootstrap host selector.
    window.location.reload();
  }
}

export function navigateInformationPage(target: InformationPageTarget = {}) {
  if (/^#\/index(?:[/?]|$)/.test(window.location.hash)) {
    if (window.parent !== window && document.documentElement.classList.contains('touch-desktop-canvas')) {
      // The outer phone host owns the real viewport; never scale reading text
      // with the 1920px desktop map canvas.
      window.parent.postMessage({ type: INFORMATION_OPEN_EVENT, url: informationPageUrl(window.location.href, target) }, window.location.origin);
    } else {
      window.dispatchEvent(new CustomEvent<InformationPageTarget>(INFORMATION_OPEN_EVENT, { detail: target }));
    }
    return;
  }
  navigateDocument(informationPageUrl(window.location.href, target));
}

export function navigateMapPage() {
  const url = new URL(window.location.href);
  if (window.parent !== window && url.searchParams.get('__information_modal') === '1') {
    window.parent.postMessage({ type: 'grid-information-close' }, window.location.origin);
    return;
  }
  url.searchParams.delete('__information_modal');
  url.searchParams.delete('__map_canvas');
  // Keep the applicant cohort when returning from a standalone reading page.
  // On phones the pre-bootstrap selector turns this map route into /mobile.
  const cohort = new URLSearchParams(url.hash.split('?')[1] ?? '').get('targetCohortYear');
  url.hash = `/index${cohort && /^\d{4}$/.test(cohort) ? `?targetCohortYear=${cohort}` : ''}`;
  navigateDocument(url.href);
}

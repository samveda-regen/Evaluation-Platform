// Cross-browser fullscreen helpers. Safari (<16.4) and old Edge only expose
// vendor-prefixed variants, so the unprefixed APIs alone silently no-op there.

type PrefixedDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
  msFullscreenElement?: Element | null;
  msExitFullscreen?: () => Promise<void>;
};

type PrefixedElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void>;
  msRequestFullscreen?: () => Promise<void>;
};

export function isFullscreenActive(): boolean {
  const doc = document as PrefixedDocument;
  return !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement);
}

export function requestFullscreen(el: HTMLElement = document.documentElement): void {
  const target = el as PrefixedElement;
  const request = target.requestFullscreen || target.webkitRequestFullscreen || target.msRequestFullscreen;
  if (!request) return;
  request.call(target)?.catch?.(() => {});
}

export function exitFullscreen(): void {
  if (!isFullscreenActive()) return;
  const doc = document as PrefixedDocument;
  const exit = document.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen;
  if (!exit) return;
  exit.call(document)?.catch?.(() => {});
}

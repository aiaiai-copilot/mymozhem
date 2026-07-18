// DI token for the manifests compiled into this artifact. Empty in phase 1 — this is
// the seam where phase-2 app-modules contribute their defineApp() manifests (design §5).
export const APP_MANIFESTS = Symbol('APP_MANIFESTS');

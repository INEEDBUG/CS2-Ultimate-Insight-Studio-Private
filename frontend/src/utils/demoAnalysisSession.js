const SESSION_PREFIX = "cs2-session-";

export function demoAnalysisSessionIdentity(demo, fallback = "demo-0") {
  return encodeURIComponent(String(
    demo?.path
    || demo?.id
    || demo?.demo_filename
    || demo?.filename
    || fallback,
  ));
}

export function resetDemoAnalysisDefaultView(demos, storage = globalThis.sessionStorage) {
  if (!storage) return;
  for (const [index, demo] of (Array.isArray(demos) ? demos : [demos]).entries()) {
    const identity = demoAnalysisSessionIdentity(demo, `demo-${index}`);
    storage.removeItem(`${SESSION_PREFIX}demo-analysis:${identity}:tab`);
  }
}

export function setDemoAnalysisDefaultView(demos, view = "replay", storage = globalThis.sessionStorage) {
  if (!storage) return;
  const normalizedView = String(view || "replay").trim() || "replay";
  for (const [index, demo] of (Array.isArray(demos) ? demos : [demos]).entries()) {
    const identity = demoAnalysisSessionIdentity(demo, `demo-${index}`);
    storage.setItem(
      `${SESSION_PREFIX}demo-analysis:${identity}:tab`,
      JSON.stringify(normalizedView),
    );
  }
}

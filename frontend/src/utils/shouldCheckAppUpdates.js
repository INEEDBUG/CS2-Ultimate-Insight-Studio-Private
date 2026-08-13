export const AUTO_UPDATE_POLL_INTERVAL_MS = 15 * 60 * 1000;

/** Only packaged Tauri clients may consume this repository's signed update channel. */
export async function shouldCheckAppUpdates() {
  return Boolean(globalThis.window?.__TAURI_INTERNALS__);
}

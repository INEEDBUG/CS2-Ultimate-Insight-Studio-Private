/**
 * This private fork must never consume the upstream project's update channel:
 * doing so could replace the customized build with an unrelated upstream build.
 * Private candidates are distributed as authenticated GitHub Actions artifacts.
 */
export async function shouldCheckAppUpdates() {
  return false;
}

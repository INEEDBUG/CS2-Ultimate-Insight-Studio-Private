import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const STABLE_TAG_PATTERN = /^[vV]?(\d+)\.(\d+)\.(\d+)$/;

export function resolveReleaseVersion({
  eventName,
  refType,
  refName,
  requestedVersion,
  latestReleaseTag,
}) {
  let version;
  if (eventName === "workflow_dispatch") {
    version = String(requestedVersion || "").trim();
  } else if (refType === "tag") {
    version = String(refName || "").trim().replace(/^[vV]/, "");
  } else {
    const latest = String(latestReleaseTag || "v0.0.0").trim();
    const match = STABLE_TAG_PATTERN.exec(latest);
    if (!match) {
      throw new Error(`Latest release tag is not a stable semantic version: ${latest}`);
    }
    version = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
  }

  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }
  return version;
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(
    resolveReleaseVersion({
      eventName: process.env.GITHUB_EVENT_NAME,
      refType: process.env.GITHUB_REF_TYPE,
      refName: process.env.GITHUB_REF_NAME,
      requestedVersion: process.env.REQUESTED_VERSION,
      latestReleaseTag: process.env.LATEST_RELEASE_TAG,
    }),
  );
}

import semver from 'semver';

// App/version metadata. The semver dependency is pinned at a version with a
// known advisory (used by the Dependabot-remediation slice); the comparison
// logic itself is small but real, so a bump touches code, not just the lock.

export const APP_VERSION = '1.0.0';
export const MIN_CLIENT_VERSION = '1.0.0';

export function isClientCompatible(clientVersion: string | undefined): boolean {
  if (!clientVersion || !semver.valid(clientVersion)) return false;
  return semver.gte(clientVersion, MIN_CLIENT_VERSION);
}

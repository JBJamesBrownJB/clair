import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import semver from 'semver';

const require = createRequire(import.meta.url);
const root = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const allDeps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };

function installedVersion(name: string): string {
  return require(`${name}/package.json`).version as string;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}
const SRC_FILES = walk(join(root, 'src'));

describe('slice 4 — Dependabot remediation (zero seeded advisories remain)', () => {
  // The four advisories seeded into the base, with their first patched version.
  const PATCHED: Record<string, string> = {
    jsonwebtoken: '9.0.0',
    lodash: '4.17.21',
    semver: '6.3.1',
    minimist: '1.2.6',
  };

  it.each(Object.entries(PATCHED))('%s is at or past its patched version (%s)', (name, patched) => {
    const v = installedVersion(name);
    expect(semver.gte(v, patched), `${name}@${v} must be >= ${patched}`).toBe(true);
  });

  it('no seeded advisory is still pinned to a vulnerable version in package.json', () => {
    // The base pinned exact vulnerable versions (e.g. "8.5.1"); after the bump
    // the manifest must allow a patched range.
    expect(allDeps.jsonwebtoken).not.toBe('8.5.1');
    expect(allDeps.lodash).not.toBe('4.17.20');
    expect(allDeps.semver).not.toBe('6.3.0');
    expect(allDeps.minimist).not.toBe('1.2.5');
  });
});

describe('slice 5 — framework major upgrade (no pre-upgrade API remains)', () => {
  it('react-router is on v7+ and react-router-dom is gone', () => {
    expect(allDeps['react-router-dom']).toBeUndefined();
    expect(allDeps['react-router']).toBeDefined();
    expect(semver.gte(installedVersion('react-router'), '7.0.0')).toBe(true);
  });

  it('@tanstack/react-query is on v5+', () => {
    expect(semver.gte(installedVersion('@tanstack/react-query'), '5.0.0')).toBe(true);
  });

  it('no source file imports the pre-upgrade "react-router-dom"', () => {
    const offenders = SRC_FILES.filter((f) => readFileSync(f, 'utf8').includes('react-router-dom'));
    expect(offenders, `still importing react-router-dom: ${offenders.join(', ')}`).toEqual([]);
  });

  it('no source file uses the v4 array-form invalidateQueries', () => {
    const offenders = SRC_FILES.filter((f) => /invalidateQueries\(\s*\[/.test(readFileSync(f, 'utf8')));
    expect(offenders, `v4 invalidateQueries([...]) left in: ${offenders.join(', ')}`).toEqual([]);
  });
});

# clair — Arena Build & Test Environment (decision log)

> **Status: decision pending — Option 1 is the frontrunner.** Where/how we run the
> `system-register` revive + upgrade, given it needs a Linux + Docker toolchain the dev host
> doesn't have. Pick up here after the break. Context: [benchmark-arena.md](benchmark-arena.md)
> (build order), [value-benchmark.md](value-benchmark.md) (why the arena must run at all).

## The constraint

- Dev machine is **Windows** (gaming rig). **WSL2 is off and staying off** — it forces the
  Hyper-V hypervisor on, which disables Resizable BAR / hurts gaming. Not negotiable.
- There **is** a Linux install — but it's **dual-boot on the same machine**, so booting it means
  abandoning the Windows Claude session, and there's no SSH (Linux isn't running concurrently).
- Host today: Java **17**, Node **24**, **no Docker, no WSL, no Maven**.

## Empirical recon (2026-06-27)

- **Frontend: builds green.** `react-scripts build` on Node 24 with `--openssl-legacy-provider`
  + `CI=false` → *"Compiled successfully,"* a real ~240 KB bundle. `npm install` also clean
  (2532 pkgs). **Not dead** — modernization is improvement, not rescue.
- **Backend: needs Docker.** Test suite pulls `org.testcontainers:postgresql` (+ `quarkus-flyway`,
  `quarkus-jdbc-postgresql`, `quarkus-oidc`) → tests spin up a **real Postgres container**. So the
  163-test safety net **cannot run without Docker**, and the host has neither Docker nor Maven.
- Repo has **no CI of its own** (the only `.github/workflows` hits are inside `node_modules`).
- **`legacy` branch already cut** locally from `main` (freezes the Quarkus 1.7 / CRA3 original).

## Options

### Option 1 — GitHub Actions as the Linux+Docker test bed ⭐ FRONTRUNNER

Do the work on Windows (keep full file tools); let **CI be the Linux box**.
- Install **Maven + JDK11** on Windows → local **compile + non-Docker unit tests** = fast inner
  loop (the `javax`→`jakarta` compile needs *no* Docker; only the test *run* does).
- Author a **GitHub Actions workflow** (`ubuntu-latest` has Docker) running `mvn verify` (the
  testcontainers Postgres suite on real Linux) + the frontend build.
- Push branches to `system-register` → **CI is the safety net**, green/red per push.
- **Wins for these constraints:** no reboot, gaming rig untouched, Claude keeps rich editing, and
  the tests run on real Linux/Docker where they belong. **First deliverable:** push `legacy` +
  workflow → **green-on-legacy in CI** = the empirical "it still works" proof, costing nothing.
- **Cost:** outer loop is push→CI (minutes), not instant. Fine for a batched upgrade.

### Option 2 — Cloud Linux running Claude

A **GitHub Codespace** on `system-register` (full Linux + Docker + Claude in-browser), or a cheap
droplet driven over SSH. Native, fast loop, zero local impact — but it's a second session/context
and a little setup/cost.

### Option 3 — Remote cloud agent (availability unconfirmed)

The Agent tool's `isolation: "remote"` runs an agent in a **cloud Linux env**. If enabled for the
session, the **entire arena upgrade could be offloaded** to a background remote agent with Docker
— zero setup. Needs an availability check before relying on it.

## Recommendation & next step

**Go with Option 1.** It's the only option that keeps Claude driving with full tools *and* gives
real Linux/Docker validation with no touch to the machine. Sequence on resume:

1. Install Maven + JDK11 on Windows (point `JAVA_HOME` at 11 for the backend).
2. Write the GitHub Actions workflow (`mvn verify` + FE build).
3. Push `legacy` + workflow → confirm **green-on-legacy in CI** (the safety-net proof).
4. Then bring in the upgrade team (frontend / Quarkus+`jakarta` / Keycloak), every push CI-gated.

*(Optional accelerator: confirm whether Option 3's remote agent is available — if so, it could
run the whole upgrade in the background instead.)*

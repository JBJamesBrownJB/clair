# clair — Benchmark Test Scenarios: how the agents are deployed

> **Status: draft for review.** This doc answers one question: **how are the agents set up
> and coordinated when a benchmark run executes?** It is the *deployment topology* — the real-world
> shapes teams actually run multi-agent coding in. It is **orthogonal** to the *workload* (which
> features get built), which lives in [value-benchmark.md](value-benchmark.md) as the *Standard* and
> *Migration-concurrent* scenario configs. Every topology here can run either workload.

## Two independent axes — don't conflate them

A benchmark run is defined by **two** choices, picked independently:

| Axis | Question | Where it's defined | Options |
|------|----------|--------------------|---------|
| **Workload** | *What* do the agents build? | [value-benchmark.md](value-benchmark.md) | Standard (3 features) · Migration-concurrent (3 features + 2 maintenance) |
| **Topology** *(this doc)* | *How* are the agents deployed & coordinated? | here | Naive-shared · Local-worktrees · Remote-agents |

This doc is the **topology** axis. The point of nailing it down: a benchmark only matters if it
mirrors how engineers *actually* run these tools. Below are the three shapes the industry uses, why
each exists, and what each one tests.

---

## Scenario 1 — Naive shared checkout *(the floor / "what not to do")*

**Plain description.** One folder, one git checkout. You point several agents (or one agent that
spawns several helpers) at it and tell them to build everything at once. They all edit the **same
files in the same directory** at the same time.

**Who runs it this way.** Beginners, and anyone who fires off parallel sub-agents without thinking
about isolation. It's the default if you don't opt into anything — Claude's sub-agents share the
working directory unless told otherwise.

**Why it exists in the benchmark.** It's the **floor**. Agents don't just collide at merge time —
they corrupt each other *while typing*, because two of them save the same file seconds apart. It's
the disaster that worktrees were invented to prevent. We include it to show the baseline mess, not
because it's a fair fight.

**What it stresses.** Live, mid-build clobbering on top of the usual conflicts. This is the messiest
condition and the hardest to attribute cleanly.

**How clair attaches.** Weakly. clair can warn "someone is in this file right now," but it can't stop
two agents physically overwriting one file — that's a filesystem problem isolation solves, not
awareness. So this scenario mostly motivates *why isolation exists*; it's not where clair shines.

**Verdict.** Useful as an illustration / sanity floor. **Not** a primary measurement arm — too
chaotic to attribute, and not the disciplined incumbent clair must actually beat.

---

## Scenario 2 — Local worktrees *(the mainstream best practice → the benchmark's baseline)*

**Plain description.** Same machine, same repository, but each agent gets its **own copy of the
working folder** (a *worktree*) on its **own branch**. Agent A edits files in folder A, agent B in
folder B — they physically cannot touch each other's files. When everyone's done, the branches are
merged back together.

**Who runs it this way.** This is the **default recommended workflow** in 2026. Claude Code supports
it natively (`--worktree`, `isolation: worktree` on a sub-agent, or just asking "use worktrees for
your agents"). Real-world scale: most developers run 3–8 worktrees at once; Claude Code's own creator
runs ~5 simultaneously.

**Why it exists in the benchmark.** Because it's what good teams actually do — so it's the **fair
control clair has to beat**. Worktrees + small PRs + one-writer-per-module already cut conflicts by
~80% (the proof-of-problem finding). If clair can't beat *this*, it isn't earning its keep. This
scenario **is Arm A** in [value-benchmark.md](value-benchmark.md).

**What it stresses.** Filesystem isolation removes the *textual* collisions (git defuses those at
merge). What's left is the dangerous kind: **semantic** conflicts — code that merges cleanly but is
broken because two agents made incompatible assumptions (the unlocked-door / duplicated-work
failures). That residue is exactly what clair targets.

**How clair attaches.** **Tightest fidelity.** Local worktrees share one underlying git directory,
so clair's awareness refs (`refs/clair/*`) are visible across worktrees **instantly, with no
fetch** (see [data-model.md, Identity](data-model.md#identity--principal-and-instance) and
[scenarios.md](../scenarios.md)). Each agent sees what its siblings are doing in real time. This is
clair's home turf.

**Verdict.** **Primary measurement arm.** The realistic best-practice baseline, and the topology
where clair's awareness is strongest.

---

## Scenario 3 — Remote agents, shared remote only *(the scaled / cloud reality)*

**Plain description.** Each agent runs in its **own separate environment** — its own machine,
container, or cloud/browser session — each with its **own full clone** of the repo. They do **not**
share a filesystem. The only thing they have in common is the **remote** (e.g. GitHub). They learn
about each other only when someone **pushes** and someone else **fetches**. Integration happens via
**pull requests**.

**Who runs it this way.** Anyone scaling past one laptop: cloud agents, browser/mobile Claude
sessions, CI-spawned agents, or a team of people each driving their own agents. The same creator who
runs 5 local worktrees also runs 5–10 *additional* sessions this way — it's how you get past the
single-machine ceiling.

**Why it exists in the benchmark.** It's the **production deployment shape** for multi-agent at
scale, and it has a property the local case doesn't: **coordination latency**. Awareness is only as
fresh as the last push/fetch cycle, not instant. If clair's value survives here, it survives in the
deployment that matters most commercially.

**What it stresses.** Same semantic-conflict residue as Scenario 2, **plus staleness**: an agent's
picture of its peers can lag reality by a push/fetch interval. This is where "I didn't know auth had
already landed" failures get *more* likely, not less.

**How clair attaches.** clair is designed **"over git, ephemeral, no server"** — it rides the shared
remote, so it works here without new infrastructure. But fidelity is **cadence-bound**: awareness
propagates at push/fetch speed, not instantly. The honest variable to measure here is therefore
**awareness latency / staleness**, not the topology label itself.

**Verdict.** **Second measurement arm — but only if it adds signal beyond Scenario 2.** See the
caution below.

---

## What actually differs across the three (and what to run)

The uncomfortable truth, stated plainly so we don't waste expensive trials:

- For the **build + merge artifacts** — the diffs each agent produces and the merged result the
  hidden gate scores — **Scenario 2 and Scenario 3 are nearly identical.** An agent blind to its
  peers produces the same code whether its isolation is a local worktree or a remote clone, and the
  merge is the same `git merge` either way. So the **headline outcome metrics** (all-pass rate,
  semantic-conflict rate, RCC) will look the same in both **unless clair is on**.
- **clair is the thing that makes them differ.** Its awareness is **instant** in Scenario 2 (shared
  local refs, no fetch) and **cadence-bound** in Scenario 3 (push/fetch latency). So the *only*
  reason to run Scenario 3 as a separate arm is to measure **whether clair's value degrades as
  awareness gets staler.** That's a real and important question — but it's a *clair-latency* knob,
  not a fresh workload.

**Recommended run plan:**

| Scenario | In the benchmark? | Status |
|----------|-------------------|--------|
| 1 · Naive shared | **No** | Documented only — a "floor" demo of why isolation exists, not a scored arm |
| 2 · Local worktrees | **Yes — the benchmark** | The primary baseline (Arm A) and clair's best-case channel |
| 3 · Remote agents | **No (for now)** | Documented; a future arm to stress awareness staleness once Scenario 2 shows signal |

**Decision (current):** the benchmark runs **Scenario 2 only**. It is the cheapest topology, the
real best-practice baseline, and the channel where clair's awareness is strongest — so it's where we
prove (or kill) the thesis first. Scenarios 1 and 3 stay **documented but out of scope**: Scenario 1
isn't a fair arm, and Scenario 3 (the staleness stress test) only earns its trial cost *after*
Scenario 2 has shown there is value to degrade. Revisit Scenario 3 then.

## The one engineering requirement this surfaces

Scenario 2 (local) and Scenario 3 (remote) are only comparable if **clair's awareness travels over
the shared remote**, not over any same-machine shortcut. If clair ever depended on a local
filesystem trick, the local benchmark would measure a fidelity that **doesn't exist** in the remote
deployment teams actually ship. As long as clair rides git refs that sync through the remote, the
local-worktree benchmark is a faithful proxy and Scenario 3 cleanly isolates the cost of latency.
**Watch-item:** keep clair's channel git-remote-native end to end.

## Sources

Industry-practice claims above (worktrees as the mainstream local pattern, native Claude Code
support, 3–8 worktrees per developer, the remote/cloud-session shape, conflict handling at merge)
are drawn from:

- [Run parallel sessions with worktrees — Claude Code Docs](https://code.claude.com/docs/en/worktrees)
- [Git Worktrees + Claude Code: The 2026 Playbook for Running Parallel Agents — Developers Digest](https://www.developersdigest.tech/blog/git-worktrees-claude-code-parallel-agents-guide)
- [How to Use Git Worktrees for Parallel AI Agent Execution — Augment Code](https://www.augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution)
- [Parallel Agentic Development With Git Worktrees: A Practical Playbook — MindStudio](https://www.mindstudio.ai/blog/parallel-agentic-development-git-worktrees)
- [Run multiple coding agents safely with git worktrees — Google Cloud Community (Medium)](https://medium.com/google-cloud/run-multiple-coding-agents-safely-with-git-worktrees-c2d237dbd6b2)

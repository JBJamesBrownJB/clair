# clair — Proof of Problem

> **Status: research finding (evidence-backed).** Does the problem clair targets — parallel AI
> agents colliding in one codebase, wasting tokens/time and producing contradictory work —
> actually exist, who feels it, and *what metrics prove it*? Produced by a 7-angle web-research
> fleet (69 findings → adversarial verification of 16 load-bearing claims → synthesis); all
> angles had full web access. The **metrics section is the instrument list** for the
> [value benchmark](../architecture/value-benchmark.md). Confidence tags: **[V]** verified
> verbatim against source · **[M]** medium / one-hop provenance · **[A]** anecdotal/unverified.

## Verdict: STRONG — but read the caveat

**The problem is real, large-scale, and well-measured.** The *solution thesis* (an ambient
awareness layer beats worktrees + discipline) is **plausible but unproven** — and there's a
direct warning against assuming it. That split is the whole story:

- ✅ **Problem exists, strongly evidenced.** Parallel AI agents collide, duplicate work, and
  produce semantic/contradictory conflicts at a measured rate, across the tool ecosystem, at
  market scale.
- ⚠️ **Solution unproven, with a caution flag.** **CooperBench found inter-agent communication
  cut merge conflicts (+14.6pp) but did *not* raise task success.** Awareness is not
  automatically a fix. The closest evidence that workspace awareness helps is *Palantír* (2012)
  — **human** developers, not agents.

> **The one-line consequence for clair:** the benchmark must prove **end-to-end task success /
> fewer post-merge regressions**, not merely "fewer textual conflicts" — or clair could post a
> metric win with no real outcome gain. This is exactly the kill-criterion, now sharpened by
> evidence.

## Evidence the problem is real

- **27.67% of real AI-agent PRs produce textual merge conflicts** at scale, and they're not
  one-liners: mean ~11.36 conflict regions, ~540 conflicting lines, 4.36 files per conflicting
  PR. (AgenticFlict, 142K+ agent PRs.) **[V]**
- **It's ecosystem-wide, not one vendor's bug:** Copilot 15.24% → Cursor 19.75% → Devin 22.85%
  → Claude Code 25.93% → Codex 31.85%. **[V]**
- **Two agents on one codebase score ~30% lower than doing both tasks solo** ("curse of
  coordination"), degrading monotonically: 68.6% → 46.5% → 30.0% success at 2/3/4 agents.
  (CooperBench.) **[V]**
- **Coordination cost is large even at k=2:** Relative Coordination Cost (RCC) 15–49% at two
  agents, up to 100% at fifty. (Silo-Bench.) **[V]**
- **Semantic conflicts persist (5–10%)** that pass textual merge but break composition; naive
  parallelism doesn't reliably yield speedup. (CodeCRDT.) **[V]**
- **Classic-SE baseline:** ~1-in-5 merges conflict, 75% need program-logic reasoning, and
  conflict-touched code is **2× bug-prone (26× for semantic conflicts)**. (Ahmed et al.) **[V]**
- **Vendors document it themselves:** Anthropic's subagents duplicated each other's work and
  multi-agent burns **~15× the tokens of chat**; Cognition (Devin) describes parallel agents
  making "conflicting implicit decisions." **[V]**
- **Microsoft validated the premise at scale:** concurrent edits in different PRs are more
  bug-prone; their ConE tool shipped to 234 repos, 70% of recommendations rated useful. **[V]**
- **A concrete waste event:** 14 background agents overflowed and killed the lead session —
  ~0.7–1.1M tokens billed for zero usable output. (claude-code issue #25714.) **[V]**
- **Demand signal:** practitioners are hand-building workarounds — shared-state files, message
  buses (`claude-peers-mcp`), pre-merge conflict detectors (`clash`). Purpose-built tools = pain.

## The honest counter-case

- **Worktrees largely solve the *file-level* case.** Git worktrees (native to Claude Code,
  Codex, Cursor) eliminate write collisions during active work; git auto-merges unambiguous
  changes. The market treats filesystem collision as solved. **[V]**
- **Discipline designs out conflicts.** One-writer-per-module / small-PR hygiene; orchestration
  guides claim ~80% conflict reduction — implying awareness may be redundant for well-run teams.
- **Conflicts scale with PR size:** ~9.9% at ~2 LOC vs ~30% at ~25 LOC — argues "rare and cheap
  with good hygiene," and warns the benchmark could be *gamed by inducing smaller PRs*.
- **The solution-thesis warning (the big one):** CooperBench — communication cut conflicts but
  **not** task success. Awareness ≠ outcome. **[V]**
- *(Mixed, not counter:)* METR RCT found AI made experienced devs 19% slower — but single-dev,
  not multi-agent.

→ **Net:** the residual problem clair must own is specifically the **semantic/logical conflict
and duplication layer** — exactly where evidence is strong *and* where isolation+git can't help.

### Reading the CooperBench caution precisely — it aims *at* clair's lever

The headline "communication didn't help" is real but **narrower than it sounds**, and the detail
is favourable. CooperBench's "communication" was **unstructured free-text messages between
agents that were BLIND to each other** (isolated containers, no visibility into each other's
workspaces/diffs/files). Its residual failures were **work-overlap/duplication (33.2%)** and
**divergent architecture (29.7%)**, and ~42% of root causes were **"Expectation"** — failure to
*model what the partner is doing*. The authors' prescribed fix is to *"turn conversation into
verifiable shared state — pasted signatures, insertion-point contracts, integration checks."*

That is **the gap clair is built for**, on two axes their setup lacked: **visibility** (ambient
partner-state via presence + `about`) and **structure** (a typed `about` key + context-swap of
concrete signatures, not prose). The two residual failures map onto clair's cheapest wins —
duplication → the presence/beacon ("someone's already here"); divergent architecture →
decision-emit + context-swap. So CooperBench indicts *unstructured chat between blind agents*,
**not awareness** — but the warning stands: clair must still **prove** structured visibility
beats the disciplined baseline on **task success**, not conflict count. *(Mechanism details
verified against arXiv:2601.13295v1, §2.1/§3/§6.2; the often-cited "~14.6pp" conflict-reduction
figure is figure-derived and unverified — cite only the direction.)*

## The metrics that prove it — the benchmark instrument list

This is the foundation for the [value benchmark](../architecture/value-benchmark.md). Each has a
real-world baseline and a measurement method.

| Metric | Baseline seen | How to instrument |
|--------|---------------|-------------------|
| **Semantic / dynamic conflict rate** ⭐ | 5–10% (CodeCRDT); classic 3–35% | For every *cleanly* merged pair, run compile + lint + full tests; count merges that regress though each branch passed alone. **The headline metric isolation can't catch.** |
| **Feature-deletion / silent-regression** ⭐ | qualitative (export filter overwritten, RBAC reverted) | **Cumulative behavioral suite that grows as each agent ships**; re-run the full suite after every merge; count features green-before / failing-after. |
| **Textual merge-conflict rate** | 27.67% (AgenticFlict) | Deterministic `git merge --no-commit --no-ff` across all branch pairs + base; parse conflict markers. Report overall / per-agent / per-task. |
| **Conflict magnitude (tail!)** | 11.36 regions, 540 lines/PR | Count regions/lines/files from merge sim; report **p90/p99**, not just mean — the tail drives rework. |
| **Work-overlap / duplication** | 33.2% overlap failures; ~23% of PR failures | Detect duplicate implementations via symbol/AST similarity; report % tasks with redundant work + tokens spent on it. |
| **Relative Coordination Cost (RCC)** ⭐ | 15–49% at k=2 (Silo-Bench) | `RCC = 1 − SR(k)/SR(1)`: single full-context agent (ceiling) vs k isolated agents. Sweep k=2,3,4,5,8 → degradation curve, with/without clair. |
| **Success-rate degradation curve** | 68.6→46.5→30.0% at 2/3/4 | Hold task fixed, vary agent count, measure end-to-end success (tests pass + requirement met). clair should *flatten the slope*. |
| **Token overhead / wasted-token ratio** | 15× vs chat; 29k vs 10k at 3 agents | Sum tokens across all agents + coordination; ÷ single-agent baseline; separately attribute **rework tokens after a detected collision**. Report $ at API rates. |
| **Coordination latency share** | 950ms coord vs 500ms work (4 agents) | Timestamp coordination reads/msgs vs tool execution; report coordination share of steps/time. |
| **Post-merge defect rate** | 2× (26× semantic) bug-prone | After merge, run a fixed quality gate + bug oracle; count merges introducing new failures. |
| **Merge/rejection + rework rate** | 63% merge; 15.4% needed intervention | With a simulated reviewer gate, log merge outcome + whether human-equivalent fixes were needed. |
| **Conflict rate vs churn size** (control) | ~9.9% @2 LOC vs ~30% @25 LOC | **Bin all metrics by induced churn** so a tool can't "win" by inducing smaller PRs. |

⭐ = the differentiating metrics where clair's value (if real) actually lives.

## Market

- **Who:** everyone running 2+ agents on a shared codebase — solo devs with 3–8 worktree agents
  to enterprises running fleets — across Cursor, Devin, Copilot/Agent HQ, Claude Code agent
  teams, OpenHands.
- **Scale:** Copilot 20M users / ~4.7M paid / ~1.2M agent PRs/month; Cursor >30% of its *own*
  merged PRs agent-authored (up to 8 parallel); Devin at thousands of companies (merge rate
  34%→67% YoY); OpenHands 64k stars, $18.8M Series A; GitHub **Agent HQ** and Anthropic **agent
  teams** ship parallel orchestration natively.
- **Pain:** merge conflicts, duplicated/fragmented implementations, semantic contradictions that
  pass CI but break composed, silent feature deletion, 15× token overhead (~$500–650/day for a
  50-agent team), review burden, and a **practical ceiling of 3–5 agents** where coordination
  overhead offsets speed. Practitioners say *coordination — not more agents — is the bottleneck.*

## What this means for the benchmark

1. **Headline on SEMANTIC conflict, not textual.** Textual proves collisions happen, but
   worktrees + git auto-merge genuinely defuse the file-level case. clair's value lives in
   clean-merge-into-broken-build and silent feature deletion — so run compile+lint+full-test+
   behavioral-regression on **every cleanly-merged pair**.
2. **RCC is the cleanest single headline.** Full-context single agent (ceiling) vs k isolated,
   with/without clair; sweep k for the curve.
3. **Cumulative, growing behavioral suite** re-run after every merge — the only instrument that
   catches "globally incoherent" regressions per-branch tests miss.
4. **Instrument the tail (p90/p99)** — conflict distributions are heavy-tailed; the tail is the
   cost.
5. **Control for churn size** (bin by LOC) so awareness gains aren't confounded with PR-size.
6. **Keep a per-agent axis** (conflict behavior varies 2×); be agent-agnostic.
7. **Measure cost separately from correctness** — token-overhead ratio + rework tokens.
8. **Design to FALSIFY the awareness thesis.** Success = end-to-end task success / fewer
   post-merge regressions, never just "fewer textual conflicts" (the CooperBench trap).

## Honest gaps

- **No measured evidence an ambient-awareness layer improves *agent* outcomes.** Closest is
  Palantír (humans, 2012); CooperBench is a direct caution. **This is the hole the benchmark
  exists to close.**
- AgenticFlict measures PR-vs-base conflicts by *simulation*, not genuinely simultaneous live
  multi-agent collisions — a strong proxy, not a direct measurement.
- **No dollar figure cleanly attributable to collisions specifically** (token-burn figures are
  list-price for running agents, not collision-caused waste).
- Some cost figures are anecdotal and must not anchor the case (50× retry inflation; "Amazon 4
  Sev-1/90 days"; a dropped "78%/30–50%" stat absent from its source).
- **No head-to-head of clair vs the incumbent stack** (worktrees + one-writer discipline +
  sequential merge) — the ~80% conflict-reduction skeptic claim is unrefuted and **must be the
  control arm.**

## Key sources

| Source | Shows |
|--------|-------|
| [AgenticFlict (arXiv 2604.03551)](https://arxiv.org/abs/2604.03551) | 27.67% conflict rate over 142K+ agent PRs; per-agent + magnitude + churn curve. **[V]** |
| [CooperBench (arXiv 2601.13295)](https://arxiv.org/abs/2601.13295) | ~30% lower success collaborating; **comms cut conflicts but not success** (the caution). **[V]** |
| [Silo-Bench (arXiv 2603.01045)](https://arxiv.org/html/2603.01045v1) | Reusable **RCC = 1 − SR(k)/SR(1)** metric; 15–49% loss at k=2. **[V]** |
| [CodeCRDT (arXiv 2510.18893)](https://arxiv.org/abs/2510.18893) | 5–10% semantic conflict; naive parallelism ≠ speedup. **[V]** |
| [Ahmed et al. merge-conflict quality study](https://ics.uci.edu/~iftekha/pdf/J4.pdf) | Classic baseline: ~20% conflict, 2× (26× semantic) bug-prone. **[V]** |
| [ConE — Microsoft (arXiv 2101.06542)](https://arxiv.org/abs/2101.06542) | Vendor-scale concurrent-edit risk; tool in 234 repos. **[V]** |
| [Palantír (IEEE TSE 2012)](https://ieeexplore.ieee.org/document/5928359/) | Closest precedent that workspace awareness *helps* — but human devs. **[V]** |
| [Anthropic multi-agent system](https://www.anthropic.com/engineering/multi-agent-research-system) | Vendor-documented subagent duplication; 15× token overhead. **[V]** |
| [Cognition — Don't Build Multi-Agents](https://cognition.com/blog/dont-build-multi-agents) | Parallel agents make "conflicting implicit decisions." **[V]** |
| [Agentic-PR study (arXiv 2605.22534)](https://arxiv.org/html/2605.22534) | 9,799 PRs: 63% merge, 15.4% need intervention, ~23% duplicates. **[M]** |

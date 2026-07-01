# Agent roles at registration (IDEA / speculative)

**Status:** idea · speculative · not built. Relates to
[../../core-features.md](../../core-features.md) #1 (Zero-config enrollment) and the
**human-first escalation** principle in [../../product.md](../../product.md).

## The seed

When an agent enrolls with clair, give it a **role**. The role tells clair what this
participant is *for*, which lets clair route escalations and resolutions to the right
place instead of surfacing everything to everyone equally.

## Proposed roles (starting set)

- **`change`** — the default. This agent is here to make changes: features, bug fixes,
  refactors. The vast majority of agents in an agent-majority repo are `change` agents.
  They emit and receive blips; escalations they can't resolve get routed onward.
- **`human-in-the-loop`** — the orchestrator. **All escalations that need a resolution
  decision route here.** When two `change` agents collide in a merge region, or a
  decision needs a judgement call, the human-in-the-loop role is the destination for
  "someone needs to decide." This is the human-as-fleet-orchestrator from product.md,
  made concrete as a routing target.
- **`auto-resolution`** — agentic resolution management. Instead of (or before) a human,
  an agent whose *job* is to triage and resolve escalations: reconcile collisions,
  answer "who owns this decision?", nudge two agents to sync. The autonomous counterpart
  to `human-in-the-loop`.
- **…and more** — roles are an open set. Others might include `observer` (read-only
  awareness, never a routing target), `reviewer`, `incident-responder`, etc.

## Why this fits clair

- It rides on **registration**, which already exists conceptually (zero-config
  enrollment derives identity and mints a session instance). A role is one more field
  on that identity — cheap to carry in a blip's front matter.
- It sharpens **escalation**. Today escalation is "relevant blip rises to *you*." Roles
  make "*you*" precise when there are many participants: escalations flow to the
  `human-in-the-loop` / `auto-resolution` roles rather than spamming every `change`
  agent.
- It keeps the **human-first** gate intact — `human-in-the-loop` is literally the gate,
  named. `auto-resolution` is an explicit, opt-in way to delegate that gate to an agent.

## Open questions

- **Where does the role live?** `git config clair.role`, like `clair.alias`? Per-session
  override? Derived (a human's session defaults to `human-in-the-loop`, an agent session
  to `change`)?
- **Routing semantics.** Does an escalation go to *all* `human-in-the-loop` roles in the
  repo, the nearest by proximity, or a designated one? What happens when there are zero
  such roles enrolled — does it fall back to broadcast?
- **`auto-resolution` scope.** How much is it allowed to *do* vs. merely *recommend*?
  This is the same human-first tension as emitting — awareness is automatic, action is
  deliberate. An auto-resolver that acts needs explicit authority.
- **Role vs. identity vs. team.** Is a role a property of the participant, the session,
  or a team? (Teams were deferred — see the archived
  [0005-identity-alias-with-teams-deferred](../../archive/decisions/0005-identity-alias-with-teams-deferred.md).)
- **Do roles change the five clair kinds?** E.g. incidents/P1s might route preferentially
  to `incident-responder`; decisions to `human-in-the-loop`.
- **Simplicity check (AGENTS.md).** Can roles stay "just a field + a routing rule," with
  the smarts offloaded to git and the local claude, rather than becoming a policy engine?

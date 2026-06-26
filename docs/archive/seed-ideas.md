# clair — Seed Ideas

> 🗄️ **Historical / superseded.** The committed product spirit now lives in
> [product.md](product.md) — repo-level ambient awareness via progressive disclosure.
> This page is the original branch-scoped, pairing-first vision, kept for provenance.
>
> ⚠️ **Speculative.** This is thought-provoking starter material, not a spec or a
> committed design. Some of it is probably wrong. Mine it for ideas; don't treat it
> as architecture. The living architecture lives elsewhere once we build it.

## The dream

```
clair with @rajiv
```

It feels like you and Rajiv are typing into — and sharing — one Claude conversation,
plus a side channel to talk to each other directly. Scoped to the branch/PR you're on.
First run should feel like magic.

## Principles worth keeping

- **Fat client, dumb pipe.** Logic runs in each person's local AI harness. No servers.
- **Git is the pipe.** Use Git as the sync/storage layer; nothing else to run.
- **Branch/PR-scoped.** Shared context maps to the code branch you're working on.
- **Ephemeral.** Live collaboration, *not* an audit log. Archiving summaries is a
  possible future, not a requirement.
- **Harness-agnostic ambition.** Claude first; avoid Claude-only assumptions.

## Loose mechanics being floated (unproven)

- Separate "lanes" for shared AI context vs. human-to-human chat (e.g. `/pair` messages).
- A contributor registry so `clair init` advertises you as open-to-pair, and
  `clair with @name` fuzzy-matches a real collaborator.
- Some shared store kept in Git, sync'd on each interaction (pull before, push after).

## Explicitly discarded from the original dump

The original brief over-specified a persistent conversation **DAG**, a custom Git merge
driver, and auto-compaction. That contradicts **ephemeral** and is heavier than we want.
Don't carry it forward without a real reason.

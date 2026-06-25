Architecture Brief: Collaborative AI Context Sharing via Plugin

1. Executive Summary & Core Principles

The goal is to create a seamless AI collaboration environment where remote developers share an identical AI context, alongside a direct developer-to-developer chat, all tied to the specific feature or PR they are working on.

To keep the system highly robust and simple, we adhere strictly to a Fat Client / Dumb Pipe model:

Offload to the Harness: All logic (context assembly, branching logic, compaction, and routing) is executed entirely by the users' local AI harnesses (Claude via MCP/plugins).

Git as the Dumb Pipe: Git is used purely as a robust, conflict-resolving transport and storage layer.

No Central Servers: There are no websockets, background daemons, or centralized sync servers to maintain.

2. Branch & PR Isolation (Namespace Mapping)

AI context must be relevant to the code being worked on. We achieve Branch and PR isolation natively by mapping the shadow branches to the active Git working branch.

The Mechanism: When the local Claude plugin fires, it reads the current working branch (e.g., git rev-parse --abbrev-ref HEAD -> feature/new-login).

The Mapping: It dynamically targets shadow branches prefixed with this name:

.ai-sync/feature/new-login

.ai-pair-chat/feature/new-login

PR Workflow: Because the shadow branches map 1:1 with the code branches, when developers collaborate on a PR, simply checking out the PR's branch automatically loads the correct, shared AI context and pair-chat history.

3. Architecture: Dual Shadow Branches

We utilize two separate, orphaned Git branch prefixes to strictly separate AI context from human meta-conversation, preventing token bloat.

refs/heads/.ai-sync/[branch-name] (The AI Context Branch):

Stores prompts, AI responses, generated code rationale, and semantic checkpoints.

refs/heads/.ai-pair-chat/[branch-name] (The Human Chat Branch):

Stores direct messages between users.

Ignored by the AI context assembler unless explicitly referenced.

4. The @pair / /pair Direct Chat Feature

Users can communicate directly within the Claude UI using a specific prefix.

Routing: When a user types a prompt starting with /pair or @pair (e.g., /pair Did you run the tests?), the local Claude plugin intercepts this command.

Execution: Instead of passing the prompt to the LLM, the plugin wraps the message in a JSON node and commits it only to the .ai-pair-chat/... branch, then pushes.

UI Integration: The local client renders these nodes distinctly (e.g., as a secondary chat panel or different visual bubble) so users know it's a direct message from their pair.

5. The Sync Pipeline: The Pre-Flight Hook

Every time a user interacts with the UI (either an AI prompt or a /pair chat), the plugin executes a standard pipeline hook:

Pre-Flight Pull: The plugin runs git fetch and git merge on the relevant .ai-sync and .ai-pair-chat branches based on the active working directory.

Context Assembly:

If an AI prompt, the plugin reads .ai-sync/..., flattens the active DAG path, and constructs the system prompt.

If a /pair chat, it simply renders the latest nodes to the UI.

Execution: Claude processes the prompt (if applicable).

Post-Flight Push: The plugin writes the new interaction as a JSON node to the appropriate branch, commits, and runs git push.

Cleanup Hook: If the graph depth exceeds the compaction threshold $n$, it triggers auto-compaction.

6. Handling Concurrency: The Conversation DAG

Interactions are stored as a Directed Acyclic Graph (DAG) to handle simultaneous prompts from different users.

Node Structure:

{
  "id": "hash-abc",
  "parent_id": "hash-xyz",
  "author": "User A",
  "role": "user",
  "type": "ai_prompt", // or "pair_chat"
  "content": "Make the button blue."
}


If User A and User B type at the same time, the graph forks. A custom Git merge driver configured for the shadow branches ensures concurrent JSON node additions never result in standard text merge conflicts.

7. Token Management: Auto-Compaction

To prevent unbounded token growth, the local plugin manages graph compaction:

Trigger: max_depth exceeded (e.g., $n = 10$ turns).

Synthesize: The plugin calls the local LLM to compress the oldest $n$ nodes into a single semantic summary.

Checkpoint: A new SUMMARY node is committed.

Re-parent: Active branches are re-parented to the new Checkpoint node, pruning the old raw nodes from the active context window.

8. Handling "Live" Updates (Idle State)

To pull in new /pair messages or AI responses while a user is idle:

The MCP server/plugin utilizes a lightweight local file watcher on the .git directory or runs a passive 30-second git fetch cron.

When upstream changes are detected, it emits a standard notifications/resources/updated event, seamlessly refreshing the local UI.
Feature: The shared pair brain — the full v0 user scenario
  Two developers, two Claudes, kept aware of each other's work through git.
  Every step drives the REAL clair-core hooks via the in-process harness — no LLM,
  deterministic. (clair-core ↔ a local bare repo as the remote, per spec §9.)

  Background:
    Given a fresh pairing world on the shared remote

  # ── ① Discovery: repo-wide and branch-aware ──────────────────────────────

  Scenario: ready registers me in this repo and pair lists me
    Given JB has a clone on branch "feature/login"
    And Rajiv has a clone on branch "main"
    When JB runs ready
    And Rajiv runs pair
    Then Rajiv sees JB ready on branch "feature/login"

  Scenario: pair lists ready peers regardless of my own branch
    Given JB has a clone on branch "feature/login"
    And Sam has a clone on branch "fix/cache-bug"
    And Rajiv has a clone on branch "main"
    When JB runs ready
    And Sam runs ready
    And Rajiv runs pair
    Then Rajiv sees JB ready on branch "feature/login"
    And Rajiv sees Sam ready on branch "fix/cache-bug"

  # ── with: checkout + join signal, and the dirty-guard ───────────────────

  Scenario: with checks out the peer's branch and signals the join
    Given JB has a clone on branch "feature/login"
    And Rajiv has a clone on branch "main"
    And JB runs ready
    When Rajiv runs with jb
    Then Rajiv's HEAD is on branch "feature/login"
    And JB's injected context shows Rajiv joined on "feature/login"

  Scenario: with aborts on a dirty working tree and never moves my work
    Given JB has a clone on branch "feature/login"
    And Rajiv has a clone on branch "main"
    And JB runs ready
    And Rajiv's working tree is dirty
    When Rajiv runs with jb
    Then the with command is rejected for a dirty tree
    And Rajiv's HEAD is on branch "main"

  # ── ② Prompt shared on ask, conclusion shared on finish ─────────────────

  Scenario: a prompt propagates and is framed as passive background
    Given JB has a clone on branch "feature/login"
    And Rajiv has a clone on branch "feature/login"
    When JB submits the prompt "refactor the auth guard to use the new middleware"
    And Rajiv interacts
    Then Rajiv's injected context shows JB asked "refactor the auth guard to use the new middleware"
    And Rajiv's injected context is framed as passive background

  Scenario: a summary propagates and renders
    Given JB has a clone on branch "feature/login"
    And Rajiv has a clone on branch "feature/login"
    When JB submits the prompt "refactor the auth guard"
    And JB finishes a turn concluding "Moved the guard into AuthMiddleware; 1 test still failing on the expired-token case."
    And Rajiv interacts
    Then Rajiv's injected context shows JB concluded "Moved the guard into AuthMiddleware; 1 test still failing on the expired-token case."
    And Rajiv's injected context is framed as passive background

  # ── ③ Reciprocal awareness the other direction ──────────────────────────

  Scenario: reciprocal awareness the other direction
    Given JB has a clone on branch "feature/login"
    And Rajiv has a clone on branch "feature/login"
    When Rajiv submits the prompt "add a rate limiter to the login route"
    And Rajiv finishes a turn concluding "Added a token-bucket limiter; covered by two new tests."
    And JB interacts
    Then JB's injected context shows Rajiv asked "add a rate limiter to the login route"
    And JB's injected context shows Rajiv concluded "Added a token-bucket limiter; covered by two new tests."

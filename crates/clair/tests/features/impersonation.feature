Feature: Impersonation — one git account, two aliases, two identities
  A solo developer reviews the pair-brain by acting as two different aliases in two
  sessions. Both clones share ONE git account (same user.email) but adopt distinct
  clair aliases "JB" and "Rajiv". Provenance keys on the ALIAS, so the two sessions
  are distinct identities that see each other — exactly as two real people would.
  Deterministic, no LLM (clair-core ↔ a local bare remote, per spec §9).

  Background:
    Given a fresh pairing world on the shared remote

  Scenario: two aliases on one git account see each other's prompts and conclusions
    Given JB has a clone on branch "feature/login" using git account "solo@dev.local"
    And Rajiv has a clone on branch "feature/login" using git account "solo@dev.local"
    When JB submits the prompt "refactor the auth guard to use the new middleware"
    And JB finishes a turn concluding "Moved the guard into AuthMiddleware; 1 test still failing on the expired-token case."
    And Rajiv interacts
    Then Rajiv's injected context shows JB asked "refactor the auth guard to use the new middleware"
    And Rajiv's injected context shows JB concluded "Moved the guard into AuthMiddleware; 1 test still failing on the expired-token case."
    And Rajiv's injected context is framed as passive background
    When Rajiv submits the prompt "add a rate limiter to the login route"
    And Rajiv finishes a turn concluding "Added a token-bucket limiter; covered by two new tests."
    And JB interacts
    Then JB's injected context shows Rajiv asked "add a rate limiter to the login route"
    And JB's injected context shows Rajiv concluded "Added a token-bucket limiter; covered by two new tests."

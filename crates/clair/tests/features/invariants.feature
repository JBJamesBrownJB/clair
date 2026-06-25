Feature: The clair invariants — loop-guard and branch-scope
  The two structural guarantees from spec §7 (loop prevention) and §10 (scope),
  exercised through the real clair-core hooks via the in-process harness.

  Background:
    Given a fresh pairing world on the shared remote

  Scenario: LOOP-GUARD — receiving an entry writes nothing back and is not re-delivered
    Given JB has a clone on branch "feature/login"
    And Rajiv has a clone on branch "feature/login"
    And JB submits the prompt "the only peer entry"
    When Rajiv submits the prompt "rajiv's own prompt"
    Then exactly one new entry was written by Rajiv this turn
    And no JB-authored entries were written by Rajiv
    And Rajiv's injected context shows JB asked "the only peer entry"
    When Rajiv interacts again
    Then Rajiv's injected context is empty

  Scenario: BRANCH-SCOPE — entries on branch A are invisible on branch B
    Given JB has a clone on branch "feature/login"
    And Rajiv has a clone on branch "feature/login"
    And Sam has a clone on branch "main"
    When JB submits the prompt "scoped to feature/login only"
    And Sam interacts
    Then Sam's injected context is empty
    And for every dev the read ref, write ref and cursor key derive from one branch

  Scenario: concurrency — a peer entry sorting below my own latest is still delivered
    Given JB has a clone on branch "feature/login"
    And Rajiv has a clone on branch "feature/login"
    When Rajiv submits the prompt "rajiv goes first"
    And JB submits the prompt "jb's concurrent entry"
    And Rajiv interacts again
    Then Rajiv's injected context shows JB asked "jb's concurrent entry"

# Prompt-injection red-team gate

`JOL-SEC-008` makes prompt-injection evaluation reproducible and release
blocking. It does not claim that prompt injection is solved.

## Evidence classes

| Evidence class | Current local evidence | Release state |
|---|---|---|
| Deterministic | Cross-channel suite v1.1.0: 17 blocker cases, 17 surfaces, 12 attack families, 100% required | Pass |
| Live model | Suite hash `a71ae1e505e1305c38c1e5bef0aec37dfdbcad44dfa612b29e0f4b0676d47f2b`: 4/4 cases and all 13 blocker metrics passed against `gpt-5.6-terra` | Pass |
| Human review | Owner-only review packet exists, but no matching human decision exists | Missing; blocks release |
| Deployment | No preview or production red-team evidence was run | Missing; blocks release |

The live run used three provider requests, 3,955 input tokens, 328 output
tokens, 4,283 total tokens, an estimated 7,404 micro-USD, and a maximum measured
latency of 3,010 ms. Those measurements apply only to the exact suite, model,
corpus, and hash above.

## Stable commands

```bash
npm run security:prompt-injection:red-team:validate
npm run test:security:red-team
npm run eval:public:live -- --live
```

The live command is inert without `--live`, exact separate public configuration,
and an API key. It writes the content-minimizing machine report and owner-review
packet to ignored mode-0600 files. Tests use injected providers and never spend
tokens.

## Fail-closed boundaries

- Every retrieved, quoted, tool-returned, external-AI, memory, task, Obsidian,
  and evidence fixture remains authority `none` with preserved taint lineage.
- Deterministic cases require exact expected tool exposure, calls, arguments,
  evidence scope, output behavior, and non-content reason codes.
- Measured public output retains support IDs and must pass the production
  semantic grounding validator. Correct claim cards cannot mask unsupported
  generated prose.
- Suite, model, corpus, review-packet, harness, and provider drift block release.
- Missing human review or deployment evidence is a failed release gate, not a
  skipped test and not development evidence.

## Residual risk

Finite patterns and fixtures can miss novel paraphrases, languages, homoglyphs,
steganography, long-horizon attacks, provider behavior changes, or unsupported
prose that closely overlaps selected evidence. Boundary-test references prove
the linked channel regressions exist; they do not turn every synthetic case into
a live end-to-end execution on every channel. The live suite is small and public
only. Private-channel live tests, representative owner review, operational
telemetry, incident response, and deployed-environment verification remain
separate gates. No passing local or live-model run authorizes deployment.

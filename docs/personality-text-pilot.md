# Personality text pilot

JOL-PER-010 completes the local text-only pilot gate without activating a new
service, sending a Slack message, calling a model, or deploying anything.

## Readiness evidence

- Carl's exact nine-case sample remains owner-approved at 9/9, with no hard
  failures and a weighted mean of 3.93/4. The private packet is referenced by
  its SHA-256 in `docs/conversational-quality-evaluation.md`; it is not copied
  into the repository.
- `evaluations/personality-evaluation-baseline-v1.json` binds the current
  behavior specification, trust review, runtime policy, renderer, admissions,
  and neutral invariance suite. Its current evaluation fingerprint is
  `sha256:18968c77c449a4d62bfa8dfe25644de505652bf91b8fe795c604e646468a91fc`.
- Private chat, CLI, Slack DM, private Slack, shared Slack, the isolated public
  delegate, and the Vercel delegate all consume the same
  `JOLENE_PERSONALITY_MODE` setting.
- The default is `jolene`. Setting the value to `neutral` removes the
  personality presentation instructions while preserving the base safety,
  privacy, evidence-grounding, capability, authorization, and channel rules.
- Any value other than the exact `jolene` or `neutral` values fails
  configuration validation.

## One-setting rollback

Set the runtime configuration to:

```text
JOLENE_PERSONALITY_MODE=neutral
```

Then restart the affected local process or container. Returning to the reviewed
personality uses the same single setting with the value `jolene`.

This is a configuration rollback, not an authorization to edit a hosted
environment or create a deployment. Hosted configuration changes and live
Slack or portfolio verification remain separate release work.

## Verification

```sh
npm run eval:personality:baseline:v1
npm run check
npm run build
```

Focused regression coverage also verifies neutral private/Slack instruction
construction, public OpenAI request construction, private and public config
parsing, container propagation, and invalid-value rejection.

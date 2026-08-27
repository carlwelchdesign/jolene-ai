# Personality tuning decision

`JOL-PER-004D` adds a local owner control for recording Carl's explicit
personality preferences without changing Jolene's runtime behavior.

The tuning contract is versioned and hashed. It covers wit intensity, terms of
endearment, faith language, challenge style, private and Slack response length,
inspiration strength, vault retrieval preference, and client-AI disclosure.
The recommended profile remains restrained: wit level one, no default terms of
endearment, user-led faith language, direct evidence-based challenge, adaptive
private responses, concise Slack, subtle inspiration, explicit vault allowlists,
and purpose-limited client-AI task packets.

A tuning decision can be written only by the configured owner and only after
the exact current personality-research snapshot has an approved relevance
decision. The saved record is bound to the research snapshot hash and tuning
contract hash. Changed research or contract content makes it stale; malformed
state fails closed. Identical retries are idempotent and conflicting decisions
require an explicit refresh.

The decision file is written atomically with owner-only permissions. The HTTP
write route is same-origin protected. The screen never modifies the prompt,
renderer, model, Slack, public delegate, vault allowlists, disclosure approvals,
or voice. Runtime activation still requires the remaining research, rights,
evaluation, human-review, and rollout gates.

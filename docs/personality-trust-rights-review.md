# Personality trust and rights review

`research/personality-trust-rights-review-v1.json` is the explicit trust-control review
for Jolene's text personality research. It is bound to the exact admission audit,
character graph, behavior specification, and pattern-rejection log.

The review covers ten areas: impersonation and perceived endorsement; recognizable
expression, quotations, and lyrics; dialect and accent imitation; biography, belief, and
identity transfer; intimacy and emotional dependency; sexualized workplace and body
material; humor in sensitive or urgent contexts; public/private disclosure; voice,
singing, and audio training; and the boundary between engineering review and legal
clearance.

Every area is release-blocking if weakened. Text research controls are satisfied locally,
but this artifact does not activate runtime behavior, authorize public release, establish
legal clearance, or permit voice work. Voice remains a separate gate requiring an original
voice brief plus provider, performer, disclosure, and rights review.

Generate and validate the artifact with:

```sh
npm run research:personality:trust-rights:v1:generate
npm run research:personality:trust-rights:v1
```

Validation reconstructs the review from its exact source artifacts. Changed fingerprints,
weakened decisions, missing risk areas, constraint drift, or source-content safeguard
regression fail closed.

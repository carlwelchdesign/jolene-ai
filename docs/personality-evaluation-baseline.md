# Personality evaluation baseline

`evaluations/personality-evaluation-baseline-v1.json` binds Jolene's evaluation contract
to the exact behavior specification, trust review, conversational-quality fixture,
renderer, runtime-personality policy, runtime admission bundle, and invariance suite.

The manifest proves local coverage of seven behavior contexts, nine conversational
categories, eleven renderer contexts, eighteen hard-failure codes, the human-review
thresholds, and paired neutral/Jolene semantic invariance. The deterministic neutral
baseline passes all eleven renderer contexts with a semantic-invariance rate of 1,
no hard failures, and at most one ornamental segment.

Generate and validate it with:

```sh
npm run eval:personality:baseline:v1:generate
npm run eval:personality:baseline:v1
```

The approved nine-case human-review packet remains private and is neither embedded nor
recaptured by this command. This artifact detects stale source contracts; it does not call
a model, alter prompts or runtime behavior, authorize activation, or authorize deployment.

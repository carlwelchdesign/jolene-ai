# Public character realization

`JOL-CHAT-REL-006D` connects the reviewed personality research to public answer
generation without converting source transcripts into a runtime style corpus.

The existing character graph already indexes 111 observation references, eight trait
families, support and counterexample edges, and anti-caricature constraints. A separate
graph database would not improve answer voice: the production failure was that the graph
was non-activating and the public answer path could fall back to fixed evidence prose.

The runtime correction therefore uses an owner-authorized original-character profile:

- the profile is fingerprint-bound to the reviewed graph for provenance;
- it synthesizes high-level behavior such as bounded warmth, calibrated wit, candid
  repair, grounded optimism, disciplined agency, and uncertainty humility;
- it contains no transcript wording, quotations, biography, catchphrases, or real-person
  identity instructions;
- it selects an advocacy, biography, skeptical, boundary, or explanatory register from
  the visitor's question;
- it tells the model to reject a draft that could be pasted unchanged under a different
  portfolio question; and
- it preserves one short, non-factual conversational reaction through the existing
  grounding validator while keeping every material sentence tied to selected evidence.

Hybrid lexical and OpenAI-embedding retrieval remains the factual RAG layer. It is not a
personality store. MCP remains private and is not exposed to the public delegate.

Deterministic fallback remains mandatory for provider, budget, and validation failures.
The fallback now recognizes broader hiring-advocacy language and routes strongest-project
questions toward shipped work before a prototype. That prevents degraded operation from
returning a generic evidence dump or selecting a project merely because its embedding was
near a vague superlative.

Release requires the full automated suite, graph and behavior-spec validation, runtime
admission validation, personality-baseline validation, preview deployment, and direct
review of representative live answers on the portfolio surface.


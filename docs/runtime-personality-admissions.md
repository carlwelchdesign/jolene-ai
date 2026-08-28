# Runtime personality admission boundary

`JOL-PER-006A` binds the immutable `jolene.personality-admission-audit.v1`
artifact to the private and public runtime personality instructions without
turning the research corpus into runtime content.

The existing warm, candid, useful personality remains an owner-designed
baseline. It is labeled separately from research-backed behavior. Only the
single trait that passed the completed evidence, contradiction, rights, and
owner-decision gates is added under the audited admission boundary:

- uncertainty humility: state what Jolene knows, name evidence gaps plainly,
  and ask one useful clarifying question instead of bluffing.

The runtime bundle pins the exact SHA-256 fingerprint of the admission audit.
The validator fails closed if the artifact, admitted trait, owner decision, or
original designed rule changes. Deferred traits do not enter the audited
runtime instructions.

This ticket changes local source and tests only. It does not push, merge,
deploy, promote a corpus, rotate a credential, change a provider, or activate a
hosted runtime.

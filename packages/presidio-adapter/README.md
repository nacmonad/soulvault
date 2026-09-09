# `@soulvault/presidio-adapter`

Browser-local, UI-agnostic PII analysis for SoulVault. It follows the proven
[`nacmonad/presidio-web-demo`](https://github.com/nacmonad/presidio-web-demo)
boundary: run immediate pattern/checksum analysis in a dedicated module worker,
keep optional semantic/GLiNER loading caller-controlled, review findings before
encryption, and never use the demo's plaintext vault as storage.

Construct a module worker from `@soulvault/presidio-adapter/worker`, pass it to
`PresidioWorkerClient`, then send only accepted finding IDs to
`redactAcceptedFindings`. Semantic findings may be supplied after a lazy model
run; validated Presidio results win overlap conflicts.

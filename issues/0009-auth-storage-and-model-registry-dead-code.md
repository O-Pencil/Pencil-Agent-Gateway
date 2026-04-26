---
id: 0009
title: AuthStorage / ModelRegistry are constructed but never wired into PencilAgent
severity: medium
status: open
area: src/engine/nano-adapter.ts
reported: 2026-04-26
updated: 2026-04-26
related-files:
  - src/engine/nano-adapter.ts
---

## DIP Metadata

```text
[WHO]  Gateway engine adapter maintainer
[FROM] NanoPencilEngineAdapter constructor
[TO]   PencilAgent — currently bypasses the AuthStorage and ModelRegistry that the adapter sets up
[HERE] /issues/0009 — open backlog item: either remove the dead state or actually wire it through
```

## Symptom

`NanoPencilEngineAdapter` builds:

```ts
const authStorage = AuthStorage.inMemory();
this.modelRegistry = new ModelRegistry(authStorage);
if (this.apiKey) {
  authStorage.set(this.provider, { type: 'api_key', key: this.apiKey });
}
```

…but neither `authStorage` nor `this.modelRegistry` is passed to the
`PencilAgent` constructor (current `PencilAgentOptions` does not accept them).
The agent gets credentials only via the `apiKey` field, which makes
`authStorage.set(...)` effectively dead. `this.modelRegistry.find(...)` is
called in `resolveModel()` purely for a pre-flight sanity check — it does not
influence what the SDK does.

The misleading state encourages future readers to assume credentials flow
through `AuthStorage`, which they do not.

## Root cause

Vestigial scaffolding from an earlier adapter sketch where a richer SDK
contract was anticipated.

## Proposed fix

Pick one of:

- **(preferred) Remove**: drop the `authStorage` / `this.modelRegistry`
  fields. Replace `resolveModel()` with a lightweight check against the
  static model list (or simply rely on the SDK to surface the error). Update
  the smoke test accordingly.
- **Wire through**: only if and when `PencilAgentOptions` gains
  `authStorage` / `modelRegistry` parameters upstream. Track the upstream
  request in the nano-pencil repo, then revisit.

## Notes

- Original review numbering: problem #9.
- Removing this code also simplifies the pre-flight error path: `resolveModel`
  currently throws on unknown models, but for OAuth-style providers without
  static model lists this would produce false negatives. Better to let the
  SDK be authoritative.

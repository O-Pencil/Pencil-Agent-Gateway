---
id: 0011
title: default.yaml is shipped but YAML loading is rejected at runtime
severity: medium
status: open
area: src/config.ts, config/default.yaml
reported: 2026-04-26
updated: 2026-04-26
related-files:
  - src/config.ts
  - config/default.yaml
  - README.md
---

## DIP Metadata

```text
[WHO]  Gateway configuration loader maintainer
[FROM] Operators expecting documented YAML support
[TO]   Gateway runtime that needs deterministic, parseable config
[HERE] /issues/0011 — open backlog item: align documented format with implemented format
```

## Symptom

`config/default.yaml` is committed to the repository and references an
`API_KEY` env var as if YAML configuration were a supported format. However,
`loadConfig()` in `src/config.ts` explicitly rejects any path ending in
`.yaml`:

```ts
if (existsSync(configFilePath) && configFilePath.endsWith('.yaml')) {
  throw new InvalidRequestError(
    'YAML support requires js-yaml dependency. Using default.json instead.'
  );
}
```

In addition, `default.yaml` uses `${CORS_ORIGINS:*}` (missing the `-` for the
default-value form `${CORS_ORIGINS:-*}`) — i.e. even if YAML were enabled, the
file would not behave as written.

## Root cause

YAML support was scaffolded ahead of adding the runtime parser, but the
follow-up never landed. Documentation and `README.md` both imply YAML works.

## Proposed fix

Pick one of:

- **(preferred) Remove**: delete `config/default.yaml`, drop the `.yaml`
  branch in `loadConfig`, and adjust README/docs to be JSON-only for v0.1.
  Add YAML as a v0.2 enhancement.
- **Implement**: add `js-yaml` (or `yaml`) as a dependency, parse YAML files
  alongside JSON, fix the env-var default syntax in `default.yaml`, and add
  tests for both formats.

## Notes

- Original review numbering: problem #11.
- Because `default.json` and `default.yaml` would otherwise drift apart, if
  YAML is implemented, treat one as the source of truth and generate the
  other (or pick a single canonical format and stop shipping both).

# Issue #8 — expanded immutable Web2Json template catalog

## Scope

Catalog revision `2` adds immutable replay-only JSONPlaceholder todo and SWAPI
C-3PO revisions. Open-Meteo and Coinbase revision-`1` manifest bytes, digests,
and introduction provenance remain unchanged.

## Causal RED

`packages/domain/test/issue008-expanded-template-catalog.contract.test.ts`
initially reported five expected failures: catalog revision remained `1`, both
new IDs were absent, and neither exact manifest existed.

## Source and verifier acceptance

On 2026-08-16 each exact HTTPS URL was fetched five times with redirects
disabled, a 15-second request bound, and a 1 MiB response cap. No response body
was stored in Git.

| Template | HTTP/content type | Bytes | Stable body SHA-256 |
| --- | --- | ---: | --- |
| `jsonplaceholder-todo-1` | `200 application/json; charset=utf-8` | 83 | `6079a162cf49972bbcf2fb4001f31dd7cc80b2f3fdd626a708093758cddb2bd7` |
| `swapi-c3po` | `200 application/json` | 662 | `e13bcd8a901d11c1414008d06543c2cd9fa831baf36ab52d7c4a889ede4d8b83` |

The existing official Coston2 verifier client boundary then prepared each exact
manifest using an already-installed credential without printing or copying the
credential. Both returned HTTP `200` and verifier status `VALID`. Only hashes
of returned request bytes were retained:

- JSONPlaceholder: `sha256:30f1e19858b28c17aefb5cffa54f23c3ea92cfcbaa8b86e41b8727c8ea4808c2`;
- SWAPI: `sha256:7b848ccba01d28144004bd8cc916c17019cc674307ee3993cb7d98a793a6cce4`.

The verifier contract follows the official Flare Web2Json prepare flow:
<https://dev.flare.network/fdc/guides/hardhat/web2-json>. No wallet, relayer,
Coston2 transaction, persisted run, source response, or production mutation was
created by these probes. All local and remote temporary probe files were
removed.

Provider review used the primary public upstream repositories. JSONPlaceholder
documents the hosted endpoint as free for development and publishes its source
under MIT at <https://github.com/typicode/jsonplaceholder>. SWAPI.info publishes
the exact hosted API implementation under MIT at
<https://github.com/SivaramPg/swapi.info>; the official Flare Web2Json guide also
uses its `/api/people/3` endpoint. Orivra stores only the request definition and
does not redistribute either provider's response data.

## GREEN gates

- focused contracts/domain/API/Web/MCP: 115/115 PASS;
- contracts/domain coverage: 677/677 and 100% statements/branches/functions/lines;
- backend coverage: 1247/1247, 91.81% lines and 86.99% branches;
- Web coverage: 626/626, 92.26% lines and 85.48% branches;
- MCP build, Web build, Sites 46/46, Action artifact 1/1: PASS;
- open-source readiness, typecheck, and diff check: PASS.

The first sandboxed backend coverage attempt failed only because loopback
socket creation was denied with `listen EPERM 127.0.0.1`; the exact command
passed outside that socket sandbox. This is not hosted CI, a production release,
or a security audit.

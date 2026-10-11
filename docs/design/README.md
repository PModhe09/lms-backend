# Design docs

Read in order. Each doc gives the decision, the alternatives, and why.

| Doc | Covers | Needed before slice |
|---|---|---|
| [00-requirements](00-requirements.md) | Actors, flows, rules, open questions answered, scope | all |
| [01-hld](01-hld.md) | Containers, request path, upload path, scaling, environments | (a) |
| [02-domain-model](02-domain-model.md) | Collections, fields, indexes, why embed vs reference | (a), (b) |
| [03-loan-state-machine](03-loan-state-machine.md) | States, transition table, concurrency, payment transaction | (d)–(g) |
| [04-api-contract](04-api-contract.md) | Every route, status codes, error envelope | all |
| [05-rbac](05-rbac.md) | Permissions map, middleware chain, ownership, frontend guards, seed users | (a) |

ADRs: [0001 auth cookie across domains](adr/0001-auth-cookie-across-domains.md) ·
[0002 salary slip storage](adr/0002-salary-slip-storage.md) ·
[0003 money as integer paise](adr/0003-money-as-integer-paise.md) ·
[0004 BRE server-authoritative](adr/0004-bre-server-authoritative.md) ·
[0005 audit log + outbox (deferred)](adr/0005-audit-log-and-outbox.md) ·
[0006 KYC provider adapter (deferred)](adr/0006-kyc-provider-adapter.md)

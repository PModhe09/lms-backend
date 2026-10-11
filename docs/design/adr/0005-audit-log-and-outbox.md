# ADR 0005 — Append-only audit log and transactional outbox

Status: Proposed, deferred · 2026-10-10. Not built: scope cut to the spec to submit fast. Kept as the design for the next step.

## Context
Lending is regulated. "Who approved this loan, when, and from what state?" must always have an answer.
Later, events like "loan disbursed" must trigger SMS/email without the API calling a provider mid-request.

## Decision

### Audit log
Collection `audit_events`, insert-only (no update/delete in code; the app's DB user could be restricted further in prod):
```ts
type AuditEvent = {
  actor: { id: ObjectId | 'SYSTEM'; role: Role };
  action: 'LOAN_APPLIED' | 'LOAN_SANCTIONED' | 'LOAN_REJECTED' | 'LOAN_DISBURSED' | 'LOAN_CLOSED'
        | 'PAYMENT_RECORDED' | 'BRE_RULESET_CREATED' | 'BRE_RULESET_SHADOWED' | 'BRE_RULESET_ACTIVATED'
        | 'BRE_LOCK_CLEARED' | 'USER_LOGIN' | 'USER_LOGIN_FAILED';
  entity: { type: 'LOAN' | 'PAYMENT' | 'BRE_RULE_SET' | 'USER'; id: ObjectId };
  before?: object; after?: object;   // only the changed fields
  requestId: string; ip?: string; at: Date;
};
```
Written **in the same transaction** as the change it describes. A change without its audit row cannot commit.
Index `{ 'entity.id': 1, at: -1 }` for "history of this loan", `{ action: 1, at: -1 }` for reports.
Admin reads it via `GET /admin/audit-events` (`AUDIT_READ`).

`loans.statusHistory` stays: it is a small, denormalized copy for the borrower timeline UI. The audit log is the source of truth.

### Transactional outbox
Problem it solves (the "dual write" problem): if the API commits "DISBURSED" to Mongo and then calls an SMS provider,
a crash in between means a disbursed loan with no SMS. If it sends the SMS first and the DB write fails, the borrower gets
an SMS for money that never moved.

Fix: the business write and an `outbox` insert commit together. A separate relay reads pending rows and publishes them.
```ts
type OutboxEvent = { type: string; payload: object; status: 'PENDING' | 'PUBLISHED' | 'FAILED'; attempts: number; createdAt: Date; publishedAt?: Date };
```
Relay: an in-process loop every 5 s, claims a batch with `findOneAndUpdate({status: 'PENDING'}, {status: 'PROCESSING'})`,
"publishes" (today: structured log line), marks `PUBLISHED`, retries with backoff up to 5 attempts, then `FAILED`.
Delivery is **at-least-once**, so consumers must be idempotent (use the event `_id` as the dedupe key).

## How big tech does it
- Audit: append-only event tables or ledgers, often streamed to write-once storage (S3 Object Lock, BigQuery) for compliance.
- Outbox: the standard pattern for reliable events in microservice systems (documented at microservices.io). The relay is usually Debezium
  reading the DB change log (Mongo change streams, Postgres WAL) and publishing to Kafka. Our in-process poller is the
  same idea without the infrastructure.

## Consequences
- Every write path is a transaction (already needed for payments), so the Mongo replica set is now a hard requirement.
- Upgrade path: replace the poller with a change-stream consumer publishing to a queue. Business code does not change.

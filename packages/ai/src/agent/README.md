# JBox AI Actor Authority Layer

This package defines the authorization boundary between intelligent actors and JBox application capabilities.

## Core rule

> No intelligence without identity. No action without authority. No consequential reasoning without auditability.

The model is not the authority. A model may request a tool invocation, but the application decides whether the actor is authorized to invoke that tool.

## Execution model

```text
Model / AI Actor
      ↓
AiToolRegistry
      ↓
authorize()
      ↓
confirmation gate
      ↓
execute()
      ↓
JBox domain service
      ↓
scoped database access / RLS
```

## Contracts

`types.ts` defines:

- `AiActorContext` — request, organization, actor, role, source, and conversation context.
- `AiRiskLevel` — `read`, `write`, `financial`, and `destructive`.
- `AuthorizationResult` — explicit allow/deny result.
- `AiToolDefinition` — tool metadata, authorization function, and execution function.
- `AiToolAuditEvent` — durable-audit event shape.

## Registry

`registry.ts` provides:

- explicit tool registration;
- duplicate-registration protection;
- tool discovery metadata;
- authorization before execution;
- confirmation gating;
- audit hooks for authorization, denial, confirmation, execution, and failure.

## Policy

`policy.ts` provides the baseline risk policy:

- reads: authenticated JBox roles;
- writes and financial actions: manager or owner;
- destructive actions: owner.

Individual tools can impose stricter rules.

## Important boundary

This layer should remain independent of JBox's database implementation. Product-specific tools belong in the application layer and should call existing JBox domain services. The AI layer must never construct arbitrary SQL or bypass existing business rules.

## Actor identity

AI actor identity is supplied by the application. Model output must never be trusted to manufacture an actor identity.

The product-layer bridge is implemented in:

`apps/product/src/lib/ai-actor-context.ts`

AI actors use the `ai:` namespace. Persistent identity resolution should replace the initial in-process registry before production activation.

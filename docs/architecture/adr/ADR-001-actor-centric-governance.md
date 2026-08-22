# ADR-001: Actor-Centric Governance for Intelligent Application Behavior

- **Status:** Proposed
- **Date:** 2026-08-21
- **Scope:** JBox application and reusable ELEANOR governance architecture
- **Decision type:** Foundational architecture

## Context

JBox increasingly incorporates intelligent components capable of reasoning, inference, planning, recommendation, content generation, tool selection, and potentially autonomous or semi-autonomous action.

Traditional application architecture often treats these capabilities as implementation details. That creates a governance gap: the application may know which human initiated a request while losing track of which intelligence reasoned about it, what authority that intelligence possessed, which tools it invoked, what decision it produced, whether confirmation was required, and what actually changed in the system.

The distinction matters whenever intelligence moves beyond drafting text and begins participating in consequential application behavior such as modifying estimates, scheduling appointments, recording payments, changing customer data, invoking external services, or orchestrating workflows.

Governance cannot reliably be added after the fact if the runtime architecture does not preserve actor identity and causal provenance.

## Decision

JBox adopts an **Actor-Centric Governance Architecture**.

> **Any intelligence that participates in consequential application behavior SHALL be represented as an identifiable actor with explicit authority, attributable actions, and durable auditability.**

An intelligent component SHALL NOT operate as an anonymous or implicit component of application control flow when its reasoning, inference, recommendation, planning, or execution can materially affect application state, users, organizations, or external systems.

The foundational execution invariant is:

```text
Identity
   ↓
Authority
   ↓
Reasoning
   ↓
Action
   ↓
Audit
```

## Principles

### 1. No intelligence without identity

Every intelligent actor receives a unique, auditable identity. Actor identity is separate from the underlying model implementation.

Examples:

```text
ai:assistant:jbox
ai:agent:scheduling
ai:agent:estimating
ai:workflow:invoice-followup
```

Replacing Gemma with Llama, or another model with a future model, does not inherently change the application's actor identity.

### 2. No action without authority

Identity does not grant authority. Authorization is evaluated against actor identity, human principal where applicable, organization/tenant, role, requested operation, resource, risk, and applicable policy.

**Identity != Authority.**

### 3. No consequential reasoning without auditability

Where intelligence materially contributes to a consequential action, the system SHALL preserve sufficient provenance to reconstruct the causal chain:

```text
Human Principal
      ↓
AI Actor
      ↓
Request
      ↓
Decision / Recommendation
      ↓
Tool
      ↓
Authorization
      ↓
Execution
      ↓
Result
```

This requires decision provenance, not unrestricted storage of model chain-of-thought. The architecture should record what was requested, what was authorized, what action was taken, and the evidence/context necessary to reconstruct that action without requiring private model deliberation to be persisted.

### 4. Human and AI actors remain distinct

When a human initiates an AI-mediated operation, both identities should be preserved where applicable:

```text
initiated_by = human:<id>
acted_by     = ai:<id>
```

The AI must not impersonate the human, and the human must not be falsely represented as directly executing an action actually performed by an AI actor.

### 5. Governance is an execution property

Governance requirements should be enforced by runtime architecture wherever feasible rather than relying exclusively on policy documents, developer intent, or post-hoc review.

The intended control path is:

```text
AI
 ↓
Tool Registry
 ↓
Authorization
 ↓
Confirmation
 ↓
Domain Logic
 ↓
Database
 ↓
Audit
```

The model is never the final authority for its own permissions.

## JBox implementation

JBox will expose explicit tools rather than granting the model direct database authority.

Initial read-only tools:

- `search_customers`
- `get_customer`
- `list_estimates`
- `get_schedule`

Higher-risk tools will use stronger authorization and, where appropriate, explicit human confirmation. Examples include:

- `send_estimate`
- `create_invoice`
- `record_payment`
- `issue_refund`
- destructive record operations

The intended execution path is:

```text
Contractor
    ↓
JBox AI Actor
    ↓
Tool Registry
    ↓
Authorization
    ↓
Confirmation Policy
    ↓
JBox Domain Services
    ↓
PostgreSQL / RLS
    ↓
Audit
```

AI tools must use existing JBox domain services and tenant-scoped data access rather than inventing SQL or bypassing application business rules.

## Actor-context bridge

AI execution is propagated through the same request/organization context mechanism used by the application, but AI receives its own explicit actor identity.

The bridge is implemented in:

`apps/product/src/lib/ai-actor-context.ts`

The actor identity must originate from an authoritative JBox identity source. Model output cannot manufacture an actor ID.

AI actor IDs use the `ai:` namespace as an additional guardrail.

The organization context remains distinct from actor identity:

- `organizationId` answers **where / for whom** execution occurs.
- `actorId` answers **who is acting**.
- `requestId` provides request-level provenance.

Anonymous execution is prohibited for actor-sensitive operations.

## Relationship to ELEANOR

This ADR establishes a runtime foundation for reusable ELEANOR governance capabilities.

Applications should expose standardized governance primitives:

```text
Actor Identity
Authority
Context
Action
Evidence
Decision
Outcome
```

ELEANOR can then evaluate, enforce, or audit governance against those primitives without requiring every application to embed a monolithic governance implementation.

The architecture therefore separates governance capabilities from application-specific business logic while keeping governance inside the runtime control path.

## Alternatives considered

### Treat AI as ordinary application code

**Rejected.** This obscures AI participation and weakens attribution.

### Attribute all AI actions to the initiating human

**Rejected.** This destroys the causal distinction between human and machine action.

### Give AI unrestricted application privileges

**Rejected.** Identity without explicit authority is an unacceptable security and governance boundary.

### Govern AI exclusively through external policy

**Rejected.** Static policy cannot reliably enforce runtime behavior.

### Make governance model-specific

**Rejected.** Governance should survive model replacement.

## Consequences

### Positive

- Model-independent governance
- Explicit causal attribution
- Stronger tenant and authorization boundaries
- Portable governance primitives
- Better forensic and incident-response capability
- Easier model replacement
- Clear separation between reasoning, authority, and execution

### Negative

- Additional actor lifecycle management
- Additional authorization and audit infrastructure
- More explicit provenance requirements
- Additional implementation and operational complexity

Auditability does not mean logging everything. Evidence should be proportional to risk and purpose.

## Architectural maxim

> **No intelligence without identity.**  
> **No action without authority.**  
> **No consequential reasoning without auditability.**

## Status

Proposed for adoption. Initial implementation is being developed on `feat/jbox-ai-tool-authority`.

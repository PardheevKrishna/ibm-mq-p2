

# IBM MQ API Hackathon #3: Topology Migration and Validation Automation

## 1. Problem Description

Enterprise IBM MQ environments are difficult to evolve because queue managers, queues, channels, listeners, security settings, and application bindings accumulate over time into complex, tightly coupled topologies. Once these topologies are in place, even a relatively small migration can become a high-risk exercise involving manual coordination, undocumented dependencies, and brittle cutover steps that may break producers and consumers.

This challenge is not just about wrapping IBM MQ native APIs. It is about building an operational control plane for topology lifecycle management. Teams will be given a source topology, a target topology, and an MQ queue manager image, and must use those inputs to stand up the environment, model the current state, provision MQ objects, execute a controlled migration toward the target state, and test the target state to prove it is good.

The core problem is that IBM MQ's native APIs provide low-level object management (create, edit, delete, test) but do not provide higher-order capabilities for multi-queue-manager topology orchestration, migration planning, dependency tracking, validation, rollback, or user-facing operational visibility. As a result, teams cannot automate migrations safely, validate message flows programmatically, or recover cleanly when issues are detected.

This problem therefore challenges you to build that missing control plane as two connected parts:

* A **Business Control Layer (BCL)** that provides the governed API surface for creating, editing, deleting, testing, and migrating MQ objects across the queue manager fleet.
* A **UI control plane** that gives users a clear operational view of topology state, migration progress, validation outcomes, and rollback status.

The solution must support incremental migration of applications from the source topology to the target topology, including transparent rewiring of flows when queues move between queue managers. Producers and consumers should continue to work without requiring application-level connection changes, and the system must validate each migration step and roll back to a known good state if a problem is detected.

**Hackathon requirement:** Your solution must demonstrate production-quality engineering. This includes automated end-to-end testing of key user flows, comprehensive logging and observability, and standard health checks (liveness and readiness probes) on all components. The BCL and UI control plane are not just proof-of-concepts; they should be operable.

## 2. Prerequisites

Before registering, teams must ensure they can meet the following environment and access prerequisites:

* OpenShift access is required. The hackathon team will not provision OpenShift clusters for participating teams.
* Teams may either:
  * Create a self-service lab OCP project against their App ID for the duration of the hackathon.
  * Use an existing OCP project that they already have access to.
* The selected OCP project must have enough quota to run the solution, with capacity for at least 10 pods, each sized at `200m` CPU and `512 MiB` memory.
* Teams will need edit access for their non-production App ID by applying the following entitlement:
  `DTCA_OCP_NP_PROJ_EDIT_<APPID>`
* Teams should speak with their manager and confirm that using the required OCP resources, App ID entitlements, and non-production access is acceptable before registering.

## 3. The Challenge

You will be given:

* **A source topology:** a multi-queue-manager configuration where applications share queue managers, queues are co-located, and connections are interleaved.
* **A target topology:** a stricter, more desired configuration where each application owns its own dedicated queue manager.
* **An IBM MQ queue manager image:** a single container image representing one queue manager instance. You will run this image multiple times to cover the queue managers required by the provided topologies.
* **A schema of IBM MQ Raw/Core APIs:** available on the internet (see Section 7).

Your task is to build a system that can:

* Provision the source topology programmatically across the fleet of queue managers using the BCL.
* Plan and execute a migration from the source topology to the target topology.
* Validate that messaging works correctly before, during, and after the migration.
* Roll back safely if migration fails or validation detects issues.
* Expose a UI control plane that allows users to observe topology state, migration progress, validation status, and rollback state.

**Critical constraint:** producers and consumers must not need to be changed if they are not part of the migration. If a queue moves from one queue manager to another, the BCL must handle the rewiring transparently.

## 4. Requirements

### 4.1 Business Control Layer (BCL) — Core Requirement

Teams must build a BCL API on top of the IBM MQ raw APIs. This is the foundational layer that everything else depends on. The BCL must:

* Build and run the environment on OpenShift (OCP) using the provided MQ image.
* Deploy the provided MQ image as many times as required by the source and target topologies to create a fleet of independent queue managers.
* Expose a single, unified control API that manages all queue manager instances collectively, abstracting away the complexity of addressing individual queue managers.
* Expose interfaces to create, edit, delete, and test MQ objects through the control layer.
* Treat the fleet of queue managers as a single logical plane; callers interact with one API regardless of how many queue managers are running.
* Route provisioning and migration operations to the correct queue manager(s) based on topology intent.
* Enforce naming conventions for all MQ objects (queue managers, queues, channels, listeners).
* Enforce security boundaries:
  * Mandatory Dead Letter Queue (DLQ) per queue manager.
  * Encryption requirements for authentication (auth'n).
  * MCA-based authorization (auth'z).
  * Cross-region traffic must flow via queue manager channels.
  * Cross-zone connections must use server-connection channels.
* Validate all property configurations and block unsafe or non-compliant settings.
* Provide well-defined error responses, validation feedback, and an audit trail for all operations.

### 4.2 UI Control Plane — Core Requirement

Teams must build a UI control plane as a first-class part of the solution. The UI must:

* Provide a consolidated view of the queue manager fleet managed by the BCL.
* Display the current source or target topology, including queue managers, queues, channels, and application-to-queue-manager relationships.
* Show migration progress, validation results, and rollback state in a clear and operationally useful way.
* Allow users to trigger or observe major lifecycle steps such as topology provisioning, migration execution, validation runs, and rollback workflows.
* Rely on the BCL as the system of record and control surface rather than bypassing it with direct MQ calls.

### 4.3 Source Topology Provisioning

* Use the BCL to programmatically provision the source topology across the fleet.
* The source topology involves six applications sharing queue managers, with queues and channels distributed across instances.
* All provisioning must go through the BCL; no direct MQ API calls from outside the control layer.
* The source topology should be represented visually as part of the solution's current-state topology design.

### 4.4 Migration Planning and Execution

Plan a migration from the source topology to the target topology, where each application is isolated on its own dedicated queue manager.

The migration plan must:

* Identify which queues and channels need to move, be created, or be decommissioned.
* Sequence operations to minimize downtime and avoid message loss.
* Handle connection rewiring internally. If a queue moves, the BCL must transparently reroute traffic (for example, via transmission queues or remote queue definitions) so that application connection strings do not need to change.
* Support migrating one application at a time from the source topology to the target topology by adjusting message flows appropriately (for example, changing local vs. remote queue handling as the topology evolves).
* Execute the migration plan through the BCL.
* Represent the target topology visually as part of the solution's future-state topology design.

### 4.5 Validation

Before, during, and after migration, the solution must validate that message flows are working correctly.

* Implement simple producer and consumer test applications that publish and consume messages through the topology.
* Validation must confirm:
  * Messages reach their intended destination queues.
  * No messages are lost or duplicated during migration.
  * Consumer applications continue to receive messages without reconfiguration.
* Teams must provide evidence for each migration step, including the validation results for each application migration.
* Validation failures must trigger a rollback (see below).

### 4.6 Rollback

* If migration fails at any step, or if validation detects broken message flows, the BCL must be able to roll back to the pre-migration or last known good state.
* Rollback must be automated; it should not require manual intervention.
* The system must emit clear signals (logs, health checks, API responses) indicating whether it is in a migrated, rolled-back, or partially migrated state.

## 5. Constraints and Guardrails

The following constraints apply throughout and must be enforced by the BCL:

| Constraint | Requirement |
| :--- | :--- |
| Application isolation (target state) | Each application must have its own dedicated queue manager in the target topology |
| Transparent rewiring | Unaffected producers and consumers must not require reconfiguration after migration |
| DLQ enforcement | Every queue manager must have a Dead Letter Queue assigned |
| Naming conventions | All MQ objects must conform to enterprise naming patterns |
| Cross-region traffic | Must flow via queue manager-to-queue manager channels only |
| Cross-zone connections | Must use server-connection channels |
| Auth'n | Encryption required for all connections |
| Auth'z | MCA-based channel authorization required |
| Six source applications | The initial source topology must explicitly model six applications |
| No direct MQ API access | All operations must go through the BCL |

## 6. Expected Outputs

Teams must deliver the following:

**BCL API Implementation**
* A working BCL that wraps IBM MQ raw APIs and enforces all guardrails described above.
* Evidence that the source topology was provisioned entirely through the BCL.
* Evidence that the migration to the target topology was executed through the BCL.

**UI Control Plane**
* A working UI control plane that presents the fleet, topology state, migration progress, validation results, and rollback status.
* Evidence that the UI is backed by the BCL and serves as the primary operational interface for users.

**Migration Execution**
* A recorded or reproducible demonstration of the full migration: source topology to target topology.
* Evidence for each application migration step, including how flows were adjusted during the move.
* Evidence of transparent connection handling: producers and consumers remain unchanged.

**Validation and Rollback**
* Automated validation of message flows before, during, and after migration.
* A demonstrated rollback triggered by a simulated failure or validation error.

**Documentation**
* A presentation and screen recording video of your solution.
* BCL API reference and architectural overview.
* UI control plane overview and user workflow documentation.
* Current-state and future-state topology diagrams.
* Description of the migration plan and execution strategy.
* Explanation of the rollback mechanism and validation approach.

## 7. Reference Materials

* Middleware Messaging Patterns — Middleware Messaging Patterns - Private Cloud - CTO Architecture - Enterprise Confluence
* MQ Objects Naming Standards — MQ Objects Naming Standards - Database and Middleware Operations (DMO) - Enterprise Confluence
* https://github.com/ibm-messaging/mq-container
* https://www.ibm.com/docs/en/ibm-mq/9.3.x?topic=api-getting-started-administrative-rest
problem_statement.md
Displaying problem_statement.md.
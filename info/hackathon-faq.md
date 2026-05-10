# Hackathon FAQ
## IBM MQ API Hackathon #3

### 1. Scope & Intent

**Q1. What is the core problem this hackathon is trying to solve?**

This hackathon challenges teams to build an **operable IBM MQ control plane** that can provision a source topology, migrate it incrementally toward a target topology, validate message flows, and automatically roll back when something breaks.

At a minimum, your solution must include:
* A **Business Control Layer (BCL)** over the IBM MQ raw APIs
* A **UI control plane** for operators
* **Migration orchestration** from the source topology to the target topology
* **Validation automation** with producer/consumer tests
* **Automated rollback** to a known good state

**Q2. What should the end state look like?**

The desired end state is a working system that:
* Treats multiple queue managers as a **single logical control plane**
* Provisions the **source topology** entirely through the BCL
* Migrates toward a **target topology** where each application owns a dedicated queue manager
* Keeps unaffected producers and consumers working **without connection-string changes**
* Provides clear **operational visibility** through the UI
* Validates each migration step and **rolls back automatically** on failure

**Q3. Is there a stretch goal?**

A strong stretch goal is to go beyond minimum compliance and demonstrate:
* More sophisticated migration planning or dependency analysis
* Better operator ergonomics in the UI
* Richer observability, audit trails, and health reporting
* Clear evidence that migrations can be repeated safely across multiple application moves

**Q4. What LLMs can I use?**

Use organization-approved Large Language Models (LLMs) from your internal approved model catalog.

**Q5. Are teams expected to have deep IBM MQ expertise?**

No. Deep domain expertise is not required. Teams are evaluated on how well they understand the problem, follow the stated guardrails, and build an operable solution around the provided topology inputs and MQ APIs.

### 2. Input Data & Assumptions

**Q6. What data am I allowed to use?**

Use the MQ datasets and reference materials provided in the hub. You may create additional synthetic or derived data to support your implementation, testing, and demonstrations.

Do not use production data or restricted information.

**Q7. What are the guardrails for utilizing AI?**

Follow your organization's published AI usage policy and internal governance when using LLMs or other AI tools.

### 3. Constraints & Validity

**Q8. How strict are the core constraints listed in the problem statement?**

They are **mandatory**. Any target state design that violates a stated constraint is considered invalid, regardless of other merits.

**Q9. Can we propose alternative patterns if they are "better" than the ones described?**

Yes, as long as they still satisfy the core guardrails and solve the challenge. For example, you may choose different internal orchestration or validation patterns, but you cannot bypass required behaviors such as BCL governance, transparent rewiring, or rollback.

**Q10. Are teams allowed to introduce new tools in the target state?**

Yes, when required to satisfy constraints or enable a valid, simplified configuration. Introduced tools must be logically justified and consistently defined.

### 4. Topology & Migration

**Q11. What does "simplification" mean in this context?**

In this challenge, simplification means moving from a shared, interleaved MQ topology to a clearer target state where each application has its own dedicated queue manager while preserving working message flows and enterprise guardrails.

**Q12. Do applications need to change their connection strings during migration?**

No. That is a core requirement. If a queue moves, the BCL must handle rewiring transparently so unaffected applications continue to work without application-level connection changes.

**Q13. Can we migrate everything in one cutover?**

The expected pattern is **incremental migration**. Teams should support moving one application at a time, validating each step, and rolling back if needed.

### 5. Target State Design

**Q14. What level of detail is expected in the target state output?**

The target state should be detailed enough to show:
* Queue managers, queues, channels, listeners, and application relationships
* How routing changes during migration
* How security and naming guardrails are enforced
* How the UI reflects topology state, validation, and rollback status

**Q15. Is visual documentation mandatory?**

Yes. Current-state and future-state topology visualizations are expected deliverables and should clearly show how applications, queues, and queue managers evolve during migration.

### 6. Validation & Operations

**Q16. How should validation be demonstrated?**

Teams should implement simple producer and consumer test applications or equivalent automated checks that prove:
* Messages reach the correct destination queues
* Messages are not lost or duplicated during migration
* Consumers continue to receive messages without reconfiguration

**Q17. Is rollback really required?**

Yes. Rollback is a core requirement, not a bonus feature. If validation fails or migration breaks message flow, the solution should return the system to the pre-migration or last known good state automatically.

**Q18. What operational qualities matter beyond functional correctness?**

Production-quality engineering matters. The solution should include:
* Automated end-to-end testing of key user flows
* Logging and observability
* Liveness and readiness checks on all components
* Clear error handling and auditability

### 8. Deliverables & Evaluation

**Q19. What are the minimum required deliverables?**

* BCL API implementation
* UI control plane
* Migration execution evidence
* Validation and rollback evidence
* Architecture and workflow documentation
* Current-state and future-state topology diagrams

**Q20. How will solutions be judged?**

Judging prioritizes:
1. **Correct enforcement of constraints and guardrails**
2. **Quality and operability of the BCL and UI control plane**
3. **Soundness of migration, validation, and rollback design**
4. **Clarity of evidence, documentation, and production readiness**

**Q21. Will partial solutions be considered?**

Incomplete solutions may be reviewed, but full alignment with constraints and deliverables is required for top consideration.

### 9. What to Avoid

**Q22. What common pitfalls should teams avoid?**

* Violating explicit constraints
* Bypassing the BCL with direct MQ operations
* Ignoring transparent rewiring, validation, or rollback
* Over-optimizing the demo while under-building the operational workflow
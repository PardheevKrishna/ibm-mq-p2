# Middleware Messaging Patterns - Private Cloud

**Created by:** Asefi, Azita (Principal Systems Architect)
**Last updated:** Apr 01, 2026

## Overview

### Description
The integration and migration patterns required for Enterprise Middleware Messaging Services—such as **IBM MQ**, **Kafka**, and **Solace**—as workloads transition into Next Generation Data Centers (NGDC).

This archetype describes the integration and migration patterns required for Enterprise Middleware Messaging Services—such as IBM MQ, Kafka, and Solace—as workloads transition into Next Generation Data Centers (NGDC). It outlines the architectural approaches, connectivity models, and interoperability considerations needed to support both hybrid (legacy-to-NGDC) and fully modernized environments.

**Patterns:** MQ NGDC, MQ migration to NGDC, Kafka NGDC, Kafka migration to NGDC, Solace NGDC, Solace migration to NGDC

**Services:** IBM MQ, Kafka, Solace, Firewall, SNI CO-LO, AVI Load-Balancer, OpenShift

---

## Characteristics

* **Decision Matrix**
    * Refer to the **Middleware Messaging Decision Flow** to determine which technology to use.
* **SNI**
    * All external network traffic will go through SNI/Co-location.
* **Load balancing**
    * AVI Load balancers are utilized to provide internal GSLB and LTM load balancing for specified Middleware Messaging patterns.
* **Next Gen data center**
    * Refers to West and East Regions (Texas and Virginia) with 2 Zones (i.e. Data Centers) in each region (Lewisville and Garland in Texas and Manassas and Sterling in Virginia).
* **Middleware Patterns**
    * Applications can combine the patterns identified in this archetype as needed per the application architecture.
* **NGDC Neighborhood and Zone (i.e. Data Center) Accessibility**
    * Both Intra and inter neighborhood traffic are allowed
    * Both Zone to zone traffic and Intra-zone traffic are allowed
    * There will be no Firewall in front of GEN/Standard Zone in a CIO Neighborhood.
    * Secure Zone (Critical Core Services, Critical Payment Applications and Card Hold Data (CDE)) within a CIO Neighborhood will have a Firewall.
    * Non-Prod and Pre-Prod have segmentation for Critical Core Services, Critical Payment Applications and Card Hold Data (CDE) as well as the GEN Zone.

---

## Example Use Cases

| Technology | Use Case Description |
| :--- | :--- |
| **MQ** | Cache Data Facility uses MQ to receive pending and posted deposit transactions from hogan and serve digital channels |
| **Kafka** | ICMP application supporting content management use Kafka to share processing status for documents. |
| **Solace** | CCIBT low latency messaging to support trading systems |

---

## Patterns

| Pattern Name | Description |
| :--- | :--- |
| **MQ NGDC Patterns** | Standardized, messaging deployment and integration patterns for running Enterprise **IBM MQ** in the **Next-Gen Data Center (NGDC)**. |
| **MQ Migration Patterns** | Reusable patterns describing **how to migrate existing Enterprise supported IBM MQ workloads** from legacy/on-prem platforms to NGDC. |
| **Kafka NGDC Patterns (coming soon)** | Standardized, messaging deployment and integration patterns for running Enterprise **Kafka** in the **Next-Gen Data Center (NGDC)**. |
| **Kafka Migration Patterns (coming soon)** | Reusable patterns describing **how to migrate existing Enterprise Kafka supported workloads** from legacy/on-prem platforms to NGDC. |
| **Solace NGDC Patterns (coming soon)** | Standardized, messaging deployment and integration patterns for running Enterprise **Solace** in the **Next-Gen Data Center (NGDC)**. |
| **Solace Migration Patterns (coming soon)** | Reusable patterns describing **how to migrate existing Enterprise Solace supported workloads** from legacy/on-prem platforms to NGDC. |

---

## Architecture

### Middleware Messaging NGDC Architecture
*(Visual diagram representation of the architecture topology including External Partners, SNI, Standard Zone with Kafka/Solace, and Secure Zone with MQ Appliance connecting to CPA, CDE, and CCS apps).*

---

## Version History

| Version | Release Notes | Reviewers | Approval Date |
| :--- | :--- | :--- | :--- |
| **1.0** | **Initial Version** <br> [MLJK-5976] Middleware Messaging Archetype - Enterprise Agile Jira | **Team Review:** Pramod Dabas, Archana Nukal - 2/28/2026 <br> **ARB Review:** 3/5/2026 <br> **SME review:** Raghuveer, Smitha; Oren, Marc J.; Bari, Asif; Abu-zaydeh, Husam; Beloff, Michelle; McDonough, Tim E., Mohammed, Mudassar Ali - 2/26/2026 | Approved by CTO ARB - 3/5/2026 |

# Single-checkout candidate validation

Status: implementation candidate; real XAE single-checkout acceptance is **not complete**. Do not deploy or call the new mode validated. No production daemon was replaced.

The migration found the production read-only XAE open on the fixed NexPlc solution, uncommitted Valve engineering changes including a different TmcHash, an unavailable configured Dev MCP, and a legacy two-field production ownership lease. Those are preserved. The candidate refuses legacy/unknown ownership rather than rewriting leases or stopping an unproven session. The old P4 daemon also remains because its profile points to a missing solution and cannot pass lifecycle verification.

Offline fixtures exercise the real Git guard for authorized primary checkout, main/master, detached HEAD, different root/Solution, wrong branch at the same commit, changed commit, switch away/back, missing authorization and active/user-owned mode. Profile fixtures verify exact authorization, dirty refusal and branch drift. Audit fixtures verify independent branch-policy baselines and cross-session Pending Journal locks. Existing policy/contentHash/nested Method/save/timeout tests remain required. These fixtures never open their synthetic projects in XAE.

Before merging this candidate, perform the following using an explicitly authorized Dev MCP and the fixed checkout after safe closure/protection of existing work:

| Acceptance | Required evidence |
| --- | --- |
| Primary checkout feature branch | Exact identity, one authorized XAE API edit, contentHash, GUID/reference invariance |
| main and branch drift | Refusal before mutation; preserve unknown outcome; no automatic replay |
| Open XAE branch switch | Helper refuses; no forced closure; old in-memory objects cannot save to another branch |
| Solution exclusivity | Existing read-only or user XAE prevents a second dedicated solution instance |
| Read-only and unauthorized objects | Existing read-only tools work; writes and out-of-scope objects refuse |
| Auditing and offline build | Preview/save/audit, reload/readback, build, complete diagnostics, final save audit |
| Nested Method | Existing exact Method update still passes; nested creation remains denied |
| COM/audit failures | No retry/replacement; Pending Journal survives branch/profile change |
| Normal close/reinitialize | Closed lease, no pending writes, commit/switch with XAE closed, fresh exact profile |

A new profile scopes its audit baseline by the branch policy fingerprint, while scanning all earlier solution session journals. Legacy audit evidence remains in place. Changing pipe or a legacy lease is not an automatic recovery mechanism. Preserve all artifacts locally and document acceptance limits; multi-folder COM specimens remain independently unverified.

## 8. Safety, quality, and recovery features

### 8.1 Scope guards and change budget

Task packets define allowed and forbidden paths, non-goals, and a maximum
intended change size. Verification checks these constraints. Work outside the
contract becomes a separate proposed ticket.

### 8.2 Later reliability work

Decision-conflict automation, typed retry/block policy, rich reproducibility
receipts, drift detection, and maintenance analytics are Phase-2 or Phase-3
work. Phase 1 retains only the failure boundary in §2.4, the human gate, the
bounded packet, and implementation-only independent verification.

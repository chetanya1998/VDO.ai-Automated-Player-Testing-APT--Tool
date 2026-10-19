# Browser/backend event correlation

Task 10 joins browser evidence to optional backend logger records only through an explicitly confirmed, source-specific identifier mapping. Page URL, event name, tag name, timestamps and the validator's local run ID are context, not identity proof.

## Policy contract

The caller supplies a versioned policy with a stable policy ID, confirmation status, display-only clock-skew estimate and one or more mappings:

```json
{
  "schemaVersion": 1,
  "policyId": "approved-backend-correlation-v1",
  "status": "confirmed",
  "displayClockSkewMs": 250,
  "mappings": [
    {
      "idType": "request",
      "browserDataKey": "approvedSharedRequestId",
      "backendIdentifier": "requestId"
    }
  ]
}
```

`browserDataKey` is a direct key in normalized browser logger or network evidence. `backendIdentifier` must name one of `pageviewId`, `playerId`, `auctionId` or `requestId`. A draft policy cannot produce an exact join. No production policy is included because Player and Backend Engineering have not yet confirmed a shared identifier.

## Join outcomes

- **Exact**: one browser record and one backend record share at least one configured ID; every configured ID present in both records agrees; neither side matches another record.
- **Ambiguous**: an ID is repeated, or one shared ID agrees while another conflicts. Ambiguous records do not produce backend evidence.
- **Unmatched**: a side has no configured ID, no matching ID, or the policy is unconfirmed.

Exact joins cite the identifier types and SHA-256 fingerprints. Raw shared identifier values are not copied into correlation results. Generated backend evidence inherits the browser run, article and device scope and retains the backend record ID and five normalized logger fields.

High-confidence backend RCA is allowed only when the policy is confirmed, backend collection is complete, and every supplied browser and backend record has a unique exact join. Any ambiguous or unmatched identity, incomplete collection or unavailable backend keeps backend RCA blocked. Browser-only findings remain valid independently.

Clock skew is subtracted only in the displayed cross-source timing delta. It never changes candidate selection or proves identity.

## Current validation boundary

Deterministic tests cover identical page URLs, separate players, concurrent auctions, repeated IDs, conflicting IDs, missing IDs and out-of-order backend records. They verify the matching algorithm; they do not establish a production identifier contract. Live backend correlation remains `UNKNOWN` until an approved endpoint and confirmed shared key are supplied and observed on both sides.

# Optional backend logger verification

Task 09 adds a bounded client for an optional backend logger API. Browser-observed TC-1 through TC-23 do not depend on this API. No authorized live endpoint or final production schema was supplied, so the adapter remains locally verified and live-unverified.

## Request contract

The client sends `GET` requests to one configured HTTPS endpoint. Loopback HTTP is accepted only for local contract verification. Requests contain a scoped bearer token in the `Authorization` header and these query parameters:

- `from` and `until`: the exact run collection window as ISO timestamps;
- `limit`: the bounded page size;
- `cursor`: the opaque next-page cursor when present.

Redirects are rejected so credentials cannot move to another endpoint. The bearer token is never copied into returned records, evidence, errors or logs. Polling, rate-limit waits, pagination and response-body reads all stop at the caller's run deadline.

## Response contract

```json
{
  "schemaVersion": 1,
  "records": [
    {
      "recordId": "backend-record-id",
      "receivedAt": "2026-10-19T10:00:05.000Z",
      "fields": {
        "event": "loaded",
        "tagName": "v-approved-tag",
        "domainName": "publisher.example",
        "page_url": "https://publisher.example/article",
        "dep": "dependencies_1"
      },
      "identifiers": {
        "pageviewId": "approved-shared-id",
        "playerId": "approved-shared-id",
        "auctionId": "approved-shared-id",
        "requestId": "approved-shared-id"
      }
    }
  ],
  "nextCursor": null,
  "watermark": {
    "observedAt": "2026-10-19T10:00:11.000Z",
    "completeThrough": "2026-10-19T10:00:10.000Z",
    "lagMs": 0
  }
}
```

Only the five approved logger fields and four candidate shared identifiers survive normalization. Other response fields are discarded. `completeThrough` at or after the requested `until` makes even an empty record set complete. Missing watermark coverage at the deadline produces an incomplete result, while authentication, transport and contract failures produce unavailable results.

Candidate identifiers are retained without claiming correlation. Task 10 may join browser and backend records only after Backend and Player Engineering confirm which identifier is present at both sources and authorize its mapping. URL or timestamp proximity is never sufficient.

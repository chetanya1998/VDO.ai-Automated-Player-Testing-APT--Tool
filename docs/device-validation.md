# Desktop, mobile and real-iOS validation

The matrix command runs every enabled desktop and mobile entry from the production profile and its confirmed device policy. Each run uses an isolated browser context, its configured viewport and touch/mobile emulation, the same three-article policy, and produces a complete TC-1 through TC-23 report. Tablet and CTV profiles remain deferred.

```powershell
pnpm matrix -- "https://approved.example/article" "config/profiles/production.json" "reports/device-matrix" `
  --browser "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --aliases "config/production-event-aliases.json" `
  --timing "config/production-timing.json" `
  --event-rules "config/production-event-rules.json" `
  --runtime-policy "config/production-runtime-policy.json" `
  --demand-policy "config/production-demand-policy.json" `
  --auction-rules "config/production-auction-rules.json" `
  --visibility-policy "config/production-visibility-policy.json" `
  --article-policy "config/production-article-policy.json" `
  --device-policy "config/production-devices.json" `
  --rca-rules "config/production-rca-rules.json"
```

Chromium mobile emulation records the declared OS/browser profile, viewport, touch mode, consent, autoplay mode, CSS dimensions, block events, configured tap and playback after that tap. It does not verify Safari or real-iOS restrictions. TC-16 stays `UNKNOWN` when a confirmed policy requires real-iOS evidence and none is imported.

For a real-device run, use the approved page on the named iPhone and Safari version. Preserve the Safari/Web Inspector network log, logger payload export and a screen recording showing the URL, configured consent state, muted-autoplay behavior, the user tap and resulting playback. Exercise the policy's BlockedInline, BlockedAutoPlay and BlockedDevice cases. Retain those files in the authorized QA evidence store, then create an evidence manifest:

```json
{
  "schemaVersion": 1,
  "evidenceId": "ios-safari-run-2026-10-16-01",
  "profileId": "production-profile-id",
  "deviceId": "mobile-chromium-emulated",
  "capturedAt": "2026-10-16T10:00:00+05:30",
  "pageUrl": "https://approved.example/article",
  "platform": "ios",
  "browser": "safari",
  "consent": "granted",
  "autoplayMode": "muted",
  "playbackAfterTap": true,
  "blockEvents": ["blocked_inline", "blocked_autoplay", "blocked_device"],
  "artifactRefs": ["qa-evidence://ios/2026-10-16/run-01"]
}
```

Pass the manifest with `--real-device-evidence`. The importer checks the profile/device identity, iOS/Safari declaration, policy consent/autoplay mode, playback result and retained artifact references. It does not turn emulated measurements into hardware measurements or claim that an inaccessible artifact was verified.

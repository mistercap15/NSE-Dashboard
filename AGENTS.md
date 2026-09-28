# Release workflow

The user requests this standing workflow for application changes:

- Do not leave completed changes only in local commits. Push to `master` or push a branch and open a pull request targeting `master`.
- For mobile application changes, publish a compatible Expo OTA update so the installed app can receive them. Inspect the existing build channel/runtime before publishing; do not assume a channel. The currently verified Android installation uses `preview`, runtime `1.0.0`.
- Verify changes before publishing. If native changes require a new binary, explain that OTA alone is insufficient.
- Report PR/release links and any blocked publication clearly. Respect any later task-specific instruction that restricts publishing.
- Publishing UI changes does not authorize starting trading bots, enabling trading, or changing exchange orders.

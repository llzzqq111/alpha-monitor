# Alpha Monitor Update Policy

- Website data refresh cadence: every 10 minutes.
- User-facing summary cadence: every 6 hours, unless there is a blocking issue that needs user action.
- Website updates should be silent by default. Do not send a chat report for every 10-minute data refresh.
- Project avatars should be captured and saved as avatar URLs in the project data when possible.
- Do not rely only on live third-party avatar lookup in the browser. The site may use a saved `avatarUrl` first and fall back to a generated initial avatar.
- When new TG or X project records are added, normalize by X handle and merge duplicate TG/X mentions.
- After updating snapshots, counts, reports, or avatar data, rebuild the website with `node scripts/build-site.mjs`.
- If GitHub credentials are available, publish the rebuilt website to `llzzqq111/alpha-monitor`; otherwise keep the local data updated and report only publish failures.

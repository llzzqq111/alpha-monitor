# Telegram Cloud Monitor

## Schedule

The GitHub Actions workflow `.github/workflows/update-tg.yml` runs every four hours at approximately 01:57, 05:57, 09:57, 13:57, 17:57 and 21:57 Asia/Shanghai. GitHub may delay scheduled runs. It also supports manual runs and relevant code changes.

## Data Rules

- Source: public preview of `https://t.me/s/dodtwitterbot` only. No Telegram account session and no X following collection.
- Start from the verified message ID in `collection-state.json`. Page backward until that checkpoint is reached, then deduplicate and filter the new notifications.
- Count valid `[Alpha]` notifications, not the number of mutual followers in the notification text. Merge projects by X handle and retain Alpha names and profile bios.
- Public history starts on the date in `public-data-start.txt`. The cloud baseline includes only the current public project records, not the older private local archive.
- Empty, stale, undated or incomplete source responses fail the run without advancing the checkpoint. A failed source read must not be represented as a fresh website update.

## Deployment

The workflow tests the parser, collects TG records, builds website data, commits source snapshots and the checkpoint, packages an explicit public-file allowlist, deploys GitHub Pages and verifies the public JSON against the saved JSON. GitHub Pages must use GitHub Actions as its publishing source.

The workflow uses the temporary `GITHUB_TOKEN` with repository contents write and Pages deployment permissions. Do not add `github_token.txt`, Telegram session files, passwords or browser profiles to the repository or Actions artifacts.

## Local Computer

Cloud collection does not depend on the local computer being awake. A powered-off computer cannot receive file writes. Local backups should be pulled from the cloud after the computer reconnects. Do not enable local cloud-only mode or remove the local fallback until a complete live cloud run has passed source collection, deployment and public verification.

After that verification, run `node scripts/sync-from-cloud.mjs --activate` once. The ignored `cloud-monitor.json` marker makes `scripts/update-all.mjs` a read-only cloud backup operation. Local publishers and browser imports then refuse to overwrite cloud records. The existing hidden Windows task can continue running every four hours to download published records, and should also run after login or a missed run. Cloud collection itself does not use that task.

The backup pins a repository commit, validates every downloaded blob, checks that Pages serves the same data, and saves replaced generated files under `logs/cloud-backups/`. Existing historical snapshots are never deleted or replaced. A conflicting snapshot, incomplete tree, or unpublished data fails without replacing local records. More than eight hours without a successful cloud collection is reported as an error, not a successful fresh update.

Check the repository Actions page for failures. A green Pages-only build is not proof that a TG collection run succeeded. Look for the `Telegram Alpha Monitor` workflow and the public `collection.lastCheckedAt` field.

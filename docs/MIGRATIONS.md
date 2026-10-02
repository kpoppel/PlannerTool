# Server-Owned Database Upgrades

The server prepares its database before logging, configuration reads, application
services, or HTTP startup. Direct launch and the Uvicorn factory use the same gate:

```bash
DATA_DIR=/srv/planner uvicorn planner:make_app --factory --port 8001
DATA_DIR=/srv/planner python planner.py
```

`DATA_DIR` defaults to `data`; Docker sets it to `/app/data`. Explicit
`Config(data_dir=...)` overrides the environment. This is always the installation
root, never a generation directory. Historical scripts are not shipped in the
repository or runtime image; manual migration launchers have been removed.

## First adoption and supported history

Stop every old server, reload supervisor, and maintenance writer before the first
rollout. Old binaries do not honor the generation locks. Take an independent full
filesystem backup if returning to an older binary might be necessary; protect it
and retain the matching `PLANNER_SECRET_KEY` separately. No automatic upgrade
backup is created or retained.

The supported legacy baseline is revision 24 (v4.2.1 contracts). Admission requires
the complete legacy baseline ledger and matching internalized config, encrypted
credentials, permissions, and saved-data invariants. Actual historical IDs and the
old runner's four obsolete-marker aliases and the development rename of migration
27 from `0027.add-missing-group-metadata-to-scenarios` to
`0027.add-missing-scenario-metadata-to-scenarios` are recognized. A known alias and
its canonical ID may coexist and count as one transition. Application version
strings and directory names are not proof. Missing, repeated identical,
contradictory, unknown, or noncontiguous evidence is rejected without migration. In particular,
a ledger claiming config internalization cannot admit a cache lacking its domain
config. The v4.2.1 server config can still be the owned writable
`config/server_config.yml`; it is explicitly imported into the candidate, never
used as a runtime fallback. Its `people` record may lack a schema-version field.

The explicit post-baseline chain is `24 -> 26 -> 27 -> 28 -> 29 -> 30 -> 31 -> 32
-> 33`; there was no migration 25. Revisions preserve their historical IDs.
Revision 26 drops disposable remote records, 27 fills scenario metadata, 28 adds
account IDs, 29 converts view Context flags, 30 adds plan container types, 31
prepares device enrollment, 32 changes ownership to account IDs, and 33 harmonizes
plugin settings using a fixed packaged menu resource. The server registry has no
pre-v4.2.1 migrations or reverse functions; older IDs are admission evidence only.

Fresh installations initialize revision 33 directly and invoke no upgrades.
External config mounts alone are fresh. An existing cache without verifiable
metadata or legacy evidence is never treated as empty. A current generation is
opened without copying or rewriting schema metadata. Newer schemas are rejected.

## Development iterations

Known historical marker renames are explicit admission aliases, not permission to
accept arbitrary migration IDs or skip record validation. Do not edit the ledger
to make incompatible records appear current. Once a revision is applied, changing
its upgrade function does not rerun it on restart. Test edits against an isolated
temporary copy of pre-upgrade data; add a new transition for changes that must
upgrade an already migrated installation.

## Authoritative inventory

```text
data/
  database.lock                 lifetime database lease; never replace
  database-entry.lock           serializes acquisition and lease conversion
  active-generation.json        selected generation ID
  upgrade-state.json            durable operation/failure journal
  generations/<id>/
    generation.json             server ownership marker
    cache/                      complete authoritative DiskCache
  remote_cache/                 disposable; excluded from recovery
  config/                       external/static inputs plus legacy owned YAML
```

`cache/` includes SQLite files, required sidecars, and external DiskCache value
files. All namespaces in it are copied: configuration and its snapshots, accounts,
authentication, sessions, scenarios, views/registers, groups, events, and other
persisted records. Do not export only `cache.db`. The legacy admission ledger is
read from the root and removed with the superseded legacy cache after activation.
Older file-layout remnants and operator backups are not promoted or deleted.

The one owned legacy exception is `config/server_config.yml` when server config
is absent from the legacy cache. Admission rejects symlinks and read-only mounts
for this authoritative file. Its contents enter only the private candidate; the
source YAML is removed only after durable activation, including offline restore.
External files such as `config/database.yaml` remain untouched. Docker adjusts
ownership of this specific legacy YAML, not the external config directory; ensure
its parent directory is traversable by the runtime user.

Generations use independent physical copies, private directories, and permissions
no weaker than their source. Unowned generation directories block destructive
cleanup rather than being guessed from names or timestamps. Keep operator backups
outside the installation. Allow space for the source plus a complete candidate,
migration growth, SQLite journals, and temporary control files.

Use a local filesystem with reliable Linux locks, atomic rename, and `fsync`.
Network/shared filesystems are not supported. Power-loss guarantees also depend
on the filesystem and hardware; subprocess crash tests do not certify hardware.

## Commit, cleanup, and concurrent workers

Current workers retain a shared lease for their full lifetime. Preparation,
restore, export, and prune require exclusive ownership with a bounded wait.
Busy errors instruct operators to stop writers; do not delete the lock files.
The entry lock prevents a writer gap during exclusive-to-shared conversion.
Shutdown closes authoritative and instantiated remote-cache handles before
releasing ownership; construction failures release their handles too.

Preparation closes/checkpoints the source before copying and runs only local
candidate transformations. Each revision and its metadata update share a candidate
transaction where supported. Whole-candidate validation checks integrity, config,
ownership, credentials, and packaged resources before publication.

Journal updates use temporary files, file flush, atomic replacement, and parent
directory flush. Candidate files and directories are flushed before the pointer
is atomically replaced and its parent flushed. The published database is verified
and activation recorded durably before source deletion. This is the commit point.
Before it, the source remains selected; after it, the complete candidate is selected.

Committed cleanup removes the predecessor and abandoned server-owned candidates,
then durably records completion. Only then may HTTP services start. Successful
upgrades leave one active generation and no retained predecessor. Cleanup failure
exits nonzero and remains pending; restart resumes deletion without restoring the
source or rerunning committed migrations. Interrupted unpublished candidates are
discarded and rebuilt from the unchanged source. Never select the newest directory.

## Offline recovery

Run with stopped writers and the installation's existing encryption key:

```bash
python planner.py database status --data-dir /srv/planner
python planner.py database retry --data-dir /srv/planner
python planner.py database prune --data-dir /srv/planner
python planner.py database restore --data-dir /srv/planner \
  --backup /srv/independent-full-backup --confirm
```

Status creates no database or lock files. It reports the selected generation and
revision, operation phase, temporary source, pending cleanup, compatibility error,
and sanitized failed-build/migration details without constructing application
services. An unsupported newer revision can still be reported.

A migration or validation failure leaves the source selected and records a build
fingerprint of migration code, resources, and validation dependencies. Restarts of
the same failed build do not copy or retry. `retry` authorizes that build's next
startup; it does not run migrations itself. A changed build may retry automatically.
Every attempt rebuilds from the original source. Storage or journal failures fail
closed; no partially prepared candidate is published.

Restore requires an explicitly supplied complete independent filesystem backup
root, not a logical JSON backup. It validates and stages the cache before selection,
never merges, and can activate an older supported revision without upgrading it.
It removes the superseded installation database after durable activation, but never
deletes the supplied backup or external inputs. Restore loses subsequent writes
and may revive older keys, sessions, revoked browsers, or deleted accounts.

After restore, start the server matching the restored revision. Starting this newer
server upgrades it again. A failed pre-commit upgrade needs no restore: its original
source is still selected. After successful upgrade there is no retained source;
returning to older code requires the operator's independent full backup.

For a pre-generation binary, stop writers and export the restored database into a
new independent legacy root before starting that matching binary:

```bash
DATA_DIR=/srv/planner .venv/bin/python -c \
  "from planner import Config; from planner_lib.migrations.coordinator import Database; Database(Config().data_dir).export_legacy('/srv/planner-legacy')"
```

Export copies the complete cache, preserves schema metadata, and copies the original
legacy ledger only when required. Revision-24 exports recreate the historical
owned `config/server_config.yml` layout from authoritative server config. Export
does not invent migration history or change
the active pointer. Reattach external inputs and use the matching encryption key.
Start the older binary directly against that legacy root; bypass its historical
Docker migration wrapper. Merely pointing an old binary at a generation pointer
does not work. Export is explicit operator backup creation, never automatic retention.

Prune protects the active generation and any source needed by an uncommitted
operation, removes owned abandoned candidates, and resumes committed cleanup.
It is not a backup retention policy.

## Logical administrator backups

JSON exports include `schema_revision`, not schema-state records or pointer files.
Versioned payloads must match the current revision. Existing unversioned selective
payloads are admitted only when their established contracts are current: account-ID
ownership, complete authentication, Context view flags, scenario metadata, ordered
project containers, and schema-v2 plugin config. The established plaintext-PAT
marker remains accepted. Unsupported older payloads are rejected before writes;
live request handlers never migrate them. Selective restores preserve schema state
and forward the revision even when accounts are excluded. Credential warnings and
session invalidation remain in effect. JSON backups contain plaintext PATs.

## Verification

```bash
.venv/bin/python -m pytest tests/migrations
npx vitest run tests/components/admin/utilities.lit.test.js
docker build -f docker/Dockerfile -t plannertool:migrations-test .
PLANNER_MIGRATION_IMAGE=plannertool:migrations-test \
  .venv/bin/python -m pytest tests/migrations/test_launcher.py
```

All fixtures and image volumes are disposable. Tests cover real DiskCache value
files, process termination at durable boundaries, failure authorization, concurrent
workers, killed lock owners, cleanup recovery, independent restore/export, and
HTTP startup/shutdown in the built image. The Docker context allowlist excludes
installation data, operator backups, test output, and secrets.

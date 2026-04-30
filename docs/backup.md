# Backup and Restore with restic

The Concept Pilot backs up the data volume daily to Hetzner Object Storage. The path is:
`/mnt/data` (all container data) → restic repository on S3 API → snapshots with retention.

Plan reference: Stage 1 infrastructure plan §infrastruktur2 requires a restic backup with heartbeat
and a restore drill as a gate criterion.

## Initial setup after server provisioning

cloud-init already installs the following on the server:

- restic binary at `/usr/local/bin/restic`
- backup script `/usr/local/bin/varlens-backup.sh`
- systemd service `restic-backup.service`
- systemd timer `restic-backup.timer` (daily at 02:30)
- template `/etc/restic/env.example`

What the maintainer must do once afterwards:

### 1. Create a Hetzner Object Storage bucket

In the Hetzner Console:

1. Object Storage > Buckets > "Create bucket"
2. Name: `varlens-pilot-backup` (or remember the name for step 4)
3. Location: for example `Falkenstein` (same location as the server reduces latency)
4. ACL: Private
5. Object Lock: not required for the Concept stage (see ADR-8 - planned for Stage 2)

### 2. Generate Object Storage credentials

In the Hetzner Console:

1. Security > Object Storage Credentials > New credentials
2. Note the access key and secret key - they are only shown once
3. Permissions: restrict to read+write on the bucket created above (if Hetzner offers that granularity, otherwise account-wide)

### 3. Generate a restic password

```sh
openssl rand -base64 32
```

Remember the value - without this password the backups cannot be restored.

### 4. Populate /etc/restic/env on the server

```sh
make ssh
sudo cp /etc/restic/env.example /etc/restic/env
sudo chmod 0600 /etc/restic/env
sudo vim /etc/restic/env
```

Replace the values:

```
RESTIC_REPOSITORY=s3:s3.eu-central-003.hetznerobjects.com/varlens-pilot-backup
RESTIC_PASSWORD=<base64 value from step 3>
AWS_ACCESS_KEY_ID=<access key from step 2>
AWS_SECRET_ACCESS_KEY=<secret key from step 2>
HEARTBEAT_URL=  # Optional: Uptime Kuma push URL, see Heartbeat section
BACKUP_PATHS=/mnt/data
RETENTION_KEEP_DAILY=7
RETENTION_KEEP_WEEKLY=4
RETENTION_KEEP_MONTHLY=6
```

### 5. Trigger the first run manually

```sh
sudo systemctl start restic-backup.service
sudo journalctl -u restic-backup.service -f
```

On the first run, restic initializes the repository (creates an encrypted container in the bucket), then the actual backup runs. From then on the timer fires daily at 02:30.

### 6. Set up a heartbeat (optional but recommended)

Uptime Kuma can monitor success via a push monitor:

1. Open http://<ip>/monitor/
2. Add New Monitor > Type: Push
3. Copy the push URL
4. In `/etc/restic/env`, set the variable `HEARTBEAT_URL` to this URL
5. Set the heartbeat interval to 25 hours (the backup runs every 24 hours, with tolerance)

If the backup is skipped for a day, the push monitor fires.

## Verification

Manual run for testing:

```sh
make ssh
sudo systemctl start restic-backup.service
sudo journalctl -u restic-backup.service --since "1 minute ago"
```

List snapshots:

```sh
sudo bash -c 'set -a; source /etc/restic/env; restic snapshots'
```

Timer status:

```sh
systemctl status restic-backup.timer
systemctl list-timers --all | grep restic
```

## Restore

For the Concept Pilot a simple restore script exists: `scripts/restore.sh`
(in the repository). It reads the same `/etc/restic/env` and restores to `/tmp/restore-...`.
Use cases:

```sh
# List snapshots:
sudo bash -c 'set -a; source /etc/restic/env; restic snapshots'

# Restore the latest snapshot to /tmp/restore-konzept:
sudo bash -c 'set -a; source /etc/restic/env; restic restore latest --target /tmp/restore-konzept'

# Restore a specific file:
sudo bash -c 'set -a; source /etc/restic/env; restic restore latest --target /tmp/restore --include /mnt/data/uptime-kuma'
```

## Restore drill (gate criterion)

Plan §infrastruktur2 requires "at least one restore drill with test data is logged".
Log of the first drill: `.internalplanning/restore-log.md` (added after the first drill).

Mandatory repetition: after every major plan or schema change, at minimum once before the migration block.

## Protection against data loss

What is not a backup replacement?

- `make stop`: the server pauses, the volume remains - no backup needed.
- `make down`: destroys the volume! Take a fresh snapshot first, then secure the bucket contents.
- Replacing the server via a cloud-init change: the volume remains, no backup needed.

Deliberately _not_ in the Concept stage:

- Object Lock on the bucket: Stage 2 (§adr8).
- Append-only identities (separate write/prune roles): Stage 2.
- Off-host heartbeat persistence: Stage 2.

Bridge clause: Object Lock can only be enabled at bucket creation. If this pilot bucket is to be reused in Stage 2, it must be prepared with Object Lock at bucket creation. The Concept Pilot deliberately runs without it because only test data lives here.

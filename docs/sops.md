# Secrets with SOPS and age

Per ADR-7 we use SOPS for per-value encryption, with age as the key provider. Secrets therefore live encrypted in the repository. Only someone with a matching age private key can decrypt them.

## Prerequisites

```sh
brew install age sops
```

## First-time setup for a maintainer

1. Generate your own age key:

   ```sh
   mkdir -p ~/.config/sops/age
   age-keygen -o ~/.config/sops/age/keys.txt
   ```

   The command prints a public key to the console, for example:
   `age1pvqt8hdwslmkrkax5tl7cpdepszaj3z8smm4psgz6cn75qy77d0spfk7ht`.

2. Add the public key to `.sops.yaml` if it is not already listed:

   ```yaml
   creation_rules:
     - path_regex: secrets/.*\.ya?ml$
       age: >-
         age1pvqt8hdwslmkrkax5tl7cpdepszaj3z8smm4psgz6cn75qy77d0spfk7ht,
         age1<NEW_KEY>
   ```

3. Add the new recipient to existing secret files:

   ```sh
   sops updatekeys secrets/example.yaml
   ```

## Workflows

### Editing an encrypted file

```sh
sops secrets/example.yaml
```

Opens the file in plaintext in the editor (default editor from `$EDITOR`). On save, SOPS encrypts automatically.

### Viewing an encrypted file

```sh
sops -d secrets/example.yaml
```

### Creating a new secret file

```sh
echo "my_secret: REPLACE" > secrets/neue-datei.yaml
sops --encrypt --in-place secrets/neue-datei.yaml
```

Or open SOPS directly and enter the content:

```sh
sops secrets/neue-datei.yaml
```

### Using the contents in a script

Example for a backup script:

```sh
export RESTIC_PASSWORD=$(sops -d --extract '["restic_password"]' secrets/example.yaml)
```

## What we encrypt

| File | Contents |
|---|---|
| `secrets/example.yaml` | Template with restic password, Object Storage credentials, heartbeat URL |

`secrets/example.yaml` is intentionally encrypted with placeholder values - the structure serves as a reference for your own secret files.

## Key rotation

When a maintainer leaves the repository:

1. Remove the corresponding public key from `.sops.yaml`.
2. Re-encrypt all encrypted files:

   ```sh
   for f in secrets/*.yaml; do sops updatekeys "$f"; done
   ```

3. Rotate all secret values - the former maintainer had them in plaintext after all.

## Hetzner Object Storage as a restic target

For the backup path (see `docs/runbook.md`):

1. In the Hetzner Console, create a bucket under Object Storage, for example `varlens-pilot-backup`.
2. Generate access credentials (access key + secret key).
3. Enter the values into `secrets/example.yaml` (or your own file) via `sops`.
4. The backup script reads the values at runtime and exports them as environment variables for restic.

# Runbook — Concept Pilot

Day-to-day. All commands run from the repo root.

| Need                          | Command                                                       |
| ----------------------------- | ------------------------------------------------------------- |
| First-time bring-up           | `make pilot` (read [`/DEPLOY.md`](../../DEPLOY.md) first)     |
| Start a stopped server        | `make -C web-deploy start && make -C web-deploy stack-up`     |
| Stop the server (save cost)   | `make -C web-deploy stop`                                     |
| Restart the stack (no reboot) | `make -C web-deploy stack-up`                                 |
| Is it running?                | `make pilot-status`                                           |
| Get a shell on the server     | `make pilot-ssh`                                              |
| Smoke test the live system    | `make pilot-smoke`                                            |
| Tail all container logs       | `make -C web-deploy stack-logs`                               |

⚠ `make pilot-down` deletes the server + 50 GB volume (you must type `pilot` to confirm). Restic snapshots survive.

| For…                 | See                                            |
| -------------------- | ---------------------------------------------- |
| Something is broken  | [`incident-runbook.md`](incident-runbook.md)   |
| Full command list    | [`operations.md`](operations.md)               |
| Smoke probe failures | [`smoke-remediation.md`](smoke-remediation.md) |

# August 2026 Performance Schedule

## Goal

Run the Foigoi GPU VM only during the three artist-provided performance
windows, with a 15-minute startup buffer in Jakarta/Bangkok time.

## Design

Terraform creates a dedicated Google Cloud Workflow in `asia-southeast1` and a
service account with Compute Engine instance-administrator access. A single
workflow execution sleeps until each UTC transition, starts or stops only
`foigoi-api` in `asia-southeast1-b`, then exits after the final stop.

The workflow executes once. It does not use annual cron jobs or a recurring
Compute Engine instance schedule, avoiding an unintended restart in a future
August.

## Schedule

| Local time (`Asia/Bangkok`) | Action |
| --- | --- |
| Mon 3 Aug 2026 19:45 | Start |
| Mon 3 Aug 2026 23:59 | Stop |
| Tue 4 Aug 2026 09:45 | Start |
| Tue 4 Aug 2026 23:59 | Stop |
| Wed 5 Aug 2026 09:45 | Start |
| Wed 5 Aug 2026 23:59 | Stop |

`make infra-schedule` starts the one workflow execution after Terraform has
created it. It refuses to start a second execution while an existing one is
active. The currently running VM is stopped after the execution is confirmed.


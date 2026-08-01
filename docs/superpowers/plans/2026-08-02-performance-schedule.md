# August 2026 Performance Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Schedule the Foigoi GPU VM for the three August 2026 performance windows without a recurring annual job.

**Architecture:** A Terraform-managed Google Cloud Workflow sleeps until each exact UTC transition and calls the Compute Engine start or stop connector. `make infra-schedule` starts exactly one execution after deployment.

**Tech Stack:** Terraform, Google Cloud Workflows, Compute Engine, GNU Make.

## Global Constraints

- Use `Asia/Bangkok` artist time converted to UTC in the one-off workflow.
- Start exactly 15 minutes before each requested performance window.
- Stop at each requested `23:59` time.
- Target only `rui-an`, `asia-southeast1-b`, and `foigoi-api`.
- Do not create an annual or otherwise recurring schedule.

---

### Task 1: Define and deploy the one-off workflow

**Files:**
- Create: `infra/terraform/templates/performance-schedule.yaml.tftpl`
- Modify: `infra/terraform/main.tf`
- Modify: `infra/terraform/outputs.tf`
- Modify: `Makefile`
- Modify: `infra/README.md`

**Interfaces:**
- Consumes: `project_id=rui-an`, `zone=asia-southeast1-b`, VM name `foigoi-api`.
- Produces: workflow `foigoi-performance-august-2026` and `make infra-schedule`.

- [ ] **Step 1: Add a workflow source that sleeps until each UTC transition.**

```yaml
- wait_for_monday_start:
    call: sys.sleep_until
    args:
      time: "2026-08-03T12:45:00Z"
- start_monday:
    call: googleapis.compute.v1.instances.start
```

- [ ] **Step 2: Add Terraform resources.**

Create the Workflows API service, dedicated workflow service account, Compute
instance-administrator IAM binding, and `google_workflows_workflow` resource.

- [ ] **Step 3: Add a guarded Make target.**

The target lists active executions and exits nonzero before starting a second
execution; otherwise it runs `gcloud workflows run`.

- [ ] **Step 4: Validate Terraform and inspect the apply plan.**

Run: `make infra-validate`

Expected: both Terraform modules validate.

- [ ] **Step 5: Apply without changing the API image.**

Run: `make infra-up IMAGE_TAG=c68d3a1`

Expected: creates only scheduling resources; no instance replacement.

- [ ] **Step 6: Start and verify the workflow.**

Run: `make infra-schedule`

Expected: an ACTIVE execution that is waiting for `2026-08-03T12:45:00Z`.

- [ ] **Step 7: Stop the currently running GPU VM and verify it is TERMINATED.**

Run: `gcloud compute instances stop foigoi-api --project rui-an --zone asia-southeast1-b`

Expected: `gcloud compute instances describe ... --format='value(status)'` prints `TERMINATED`.

# Onboarding a Reference SDK

## Prerequisites

- A GitHub repo exists under `canonical/<name>-sdk`
- The SDK definition (`sdkcraft.yaml`, hooks, tests) is in `main`
- A `VERSION` file exists on each version branch with just the version string (e.g. `1.24.3`)

---

## 1. Branch strategy

| Branch                          | Purpose                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `main`                          | SDK definition (`sdkcraft.yaml`, hooks, tests). No `VERSION` file.                                                       |
| `<major>.<minor>` (e.g. `1.24`) | One branch per tracked upstream release line. Contains `VERSION`. Receives forward-ports from `main` and Renovate bumps. |

Create version branches from `main`. Push the initial `VERSION` file to each.

---

## 2. CI workflows

Copy these workflows from [sdkcraft-actions](https://github.com/canonical/sdkcraft-actions) verbatim:

| File                 | Trigger                     | Does                                                    |
| -------------------- | --------------------------- | ------------------------------------------------------- |
| `build.yml`          | PR → `[0-9]+.[0-9]+`        | Builds the SDK (gate for branch protection / automerge) |
| `upload.yml`         | Push → `[0-9]+.[0-9]+`      | Builds and uploads to the store at `<track>/<risk>`     |
| `forward-port.yml`   | Push → `main`               | Opens PRs from `main` into each version branch          |
| `renovate.yml`       | Schedule (weekdays)         | Runs Renovate to bump `VERSION`                         |
| `renovate-check.yml` | PR touching `renovate.json` | Validates the Renovate config                           |

In `upload.yml`, set `platforms` and `risk` for the SDK. Pass `promote-to-latest: true` if the latest version branch should also release to `latest/<risk>`.

The upload workflow requires `SDKCRAFT_STORE_CREDENTIALS`. Add the secret with:

```bash
sdkcraft login --export credentials.txt

gh secret set SDKCRAFT_STORE_CREDENTIALS_PROD \
  --repo "canonical/<name>-sdk" \
  --body "$(cat credentials.txt)"
```

---

## 3. `renovate.json`

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],
  "dependencyDashboard": true,
  "enabledManagers": ["custom.regex"],
  "customManagers": [
    {
      "customType": "regex",
      "managerFilePatterns": ["/^VERSION$/"],
      "matchStrings": ["(?<currentValue>[0-9.]+)"],
      "depNameTemplate": "<upstream-dep-name>",
      "datasourceTemplate": "<datasource>",
      "versioningTemplate": "semver"
    }
  ],
  "automerge": true,
  "platformAutomerge": true,
  "baseBranchPatterns": ["1.24", "1.25"],
  "packageRules": [
    {
      "matchPackageNames": ["<upstream-dep-name>"],
      "matchBaseBranches": ["1.24"],
      "allowedVersions": "/^1\\.24\\./"
    }
  ]
}
```

- `depNameTemplate` / `datasourceTemplate`: match the upstream package source (e.g. `golang-version`, `github-releases`, `npm`, etc.)
- One `packageRule` per version branch, with `allowedVersions` pinning to that `major.minor`
- `automerge` + `platformAutomerge`: Renovate-opened PRs are merged automatically once `build / build` passes; human PRs are unaffected

---

## 4. `terragrunt.hcl` (canonical-repo-automation)

Create `groups/charm-engineering/workshop/repos/<name>-sdk/terragrunt.hcl`. The three `include` blocks and the `OVERRIDES` section are boilerplate — copy them unchanged from any existing SDK.

Populate only the `inputs` block:

```hcl
inputs = {
  repo             = "<name>-sdk"
  repo-description = <<-EOT
    One-line description.
  EOT
  topics = ["sdk"]

  variables = {
    # Must match baseBranchPatterns in renovate.json and the upload.yml trigger.
    "LONG_TERM_BRANCHES" = "[\"1.24\",\"1.25\"]"
  }

  # Gate for platformAutomerge — one entry per version branch.
  branch-protection = {
    "1.24" = {
      enforce_admins = false
      required_status_checks = {
        strict   = false
        contexts = ["build / build"]
      }
    }
  }
}
```

- `LONG_TERM_BRANCHES` must be a JSON-encoded string array; it feeds the `forward-port.yml` workflow
- `allow_auto_merge` is already `true` via the inherited `repos-settings.hcl` — do not override it
- Add a `branch-protection` entry for every version branch; without it, Renovate PRs merge immediately regardless of CI

### Maintainers

By default, every workshop SDK inherits admin access for the `workshop` and `charm-engineering-admins` teams via `repos-settings.hcl` — no extra config needed for team members.

To grant access to individuals, add to `inputs`:

```hcl
# Full admin rights for specific GitHub users.
admins = ["github-username"]

# Fine-grained access: pull | triage | push | maintain | admin.
members = {
  "github-username" = "maintain"
}
```

Do not set `group-admins` in the `inputs` block — it overrides (not appends) the inherited `juju-charm-bot` entry.

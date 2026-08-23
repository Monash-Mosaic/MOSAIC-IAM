# MOSAIC-IAM

IAM automation for MOSAIC. This phase provisions GitHub organisation access from Notion IAM records using a GitHub App. Slack and Cloudflare entrypoints are not included yet.

## Setup

1. Copy `.env.example` to `.env` and fill in Notion data source IDs, GitHub App credentials, and `GITHUB_ORG`.
2. Store the GitHub App private key in `secrets/` and point `GITHUB_PRIVATE_KEY_PATH` at it.
3. Share the IAM Notion databases with the Notion integration.
4. Set `GITHUB_ORG` to the real GitHub organisation slug (not a placeholder).

Inspect live Notion schemas without printing secrets:

```bash
npm run discover:notion
```

## Manual IAM Testing

1. Add a member to **Members**.
2. Set **Team** (e.g. `Engineering`), **Role** (e.g. `Developer`), **Status** to `Active`, and **IAM Status** to `Pending`.
3. Confirm an enabled **IAM - RBAC Policies** row matches that Team + Role and relates to a GitHub Team in **IAM - Access Resources**.
4. Dry-run first:

```bash
npm run provision -- --dry-run
npm run provision -- --email user@example.com --dry-run
```

5. Provision for real:

```bash
npm run provision -- --email user@example.com
npm run provision
```

6. Accept the GitHub organisation invitation.
7. Run provision again. **IAM - Access Tracking** should move **Actual State** from `Pending` to `Granted` and **Sync Status** to `Synced` once org and team membership can be confirmed. Member **IAM Status** should become `Synced`.
8. Run provision a third time. It should report that the user already matches desired state.

GitHub email invitations require the invited address to be a **verified email** on the recipient's GitHub account.

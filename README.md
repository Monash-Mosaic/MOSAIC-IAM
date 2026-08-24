# MOSAIC-IAM

IAM automation for MOSAIC. Notion is the source of truth. GitHub organisation access is provisioned by the existing GitHub App IAM engine. Slack is an onboarding interface only (Socket Mode; no public URL).

## Setup

1. Copy `.env.example` to `.env` and fill in Notion data source IDs, GitHub App credentials, `GITHUB_ORG`, and Slack tokens.
2. Store the GitHub App private key in `secrets/` and point `GITHUB_PRIVATE_KEY_PATH` at it.
3. Share the IAM Notion databases with the Notion integration.
4. Set `GITHUB_ORG` to the real GitHub organisation slug (not a placeholder).
5. For Slack, enable **Socket Mode** (no Request URL). Add `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, and `SLACK_SIGNING_SECRET` from the Slack app. The signing secret is on **Basic Information**; Socket Mode will not start without it.

**Slack app settings**

- Bot token scopes: `chat:write`, `im:write`, `users:read`, `users:read.email` (optional)
- App token (`xapp-`) scope: `connections:write`
- Subscribe to bot event: `team_join`
- Interactivity: enabled (Socket Mode delivers actions; no public webhook)
- Interactivity action ID: `iam_start_onboarding`
- Modal callback ID: `iam_onboarding_submit`

Inspect live Notion schemas without printing secrets:

```bash
npm run discover:notion
```

## Slack onboarding bot

Start the Socket Mode bot:

```bash
npm run slack
```

Send the same welcome DM to an existing Slack user (does not start Socket Mode):

```bash
npm run slack:test-dm -- --user U0123456789
```

Keep `npm run slack` running in another terminal so **Start Onboarding** can open the modal.

How to test the Slack flow:

1. Start the bot with `npm run slack`.
2. Add or invite a real Slack user to the workspace (bots are ignored), or send a test DM with `npm run slack:test-dm -- --user U0123456789`.
3. The bot DMs a welcome message with **Start Onboarding**.
4. Complete the modal (Full Name, Email, Department, Role). Email is the identity used for provisioning; GitHub username is not collected.
5. Confirm the **IAM - Users** record (Status `Active`, Slack User ID set).
6. Confirm the GitHub organisation invitation for that email.
7. Confirm **IAM - Access Tracking**.

## Demo onboarding (no Slack)

This uses the same onboarding service as the Slack modal:

```bash
npm run demo:onboarding -- \
  --name "Test User" \
  --email test@example.com \
  --department Engineering \
  --role Developer
```

Dry-run (no Notion or GitHub writes):

```bash
npm run demo:onboarding -- \
  --name "Test User" \
  --email test@example.com \
  --department Engineering \
  --role Developer \
  --dry-run
```

Running the demo twice with the same email must not create duplicate IAM users, GitHub invitations, or Access Tracking rows.

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

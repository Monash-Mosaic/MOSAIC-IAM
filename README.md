# MOSAIC-IAM

IAM automation for MOSAIC. Notion is the source of truth. GitHub organisation access is provisioned by the existing GitHub App IAM engine. Slack is the onboarding and self-service profile interface.

## Setup

1. Copy `.env.example` to `.env` and fill in Notion data source IDs, GitHub App credentials, `GITHUB_ORG`, and Slack tokens.
2. Store the GitHub App private key in `secrets/` and point `GITHUB_PRIVATE_KEY_PATH` at it.
3. Share the IAM Notion databases with the Notion integration (**IAM - Users**, **IAM - RBAC Policies**, **IAM - Access Resources**).
4. Set `GITHUB_ORG` to the real GitHub organisation slug (not a placeholder).
5. For Slack, enable **Socket Mode** (no Request URL). Add `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, and `SLACK_SIGNING_SECRET` from the Slack app. The signing secret is on **Basic Information**; Socket Mode will not start without it.

**Slack app settings**

- Bot token scopes: `chat:write`, `im:write`, `users:read`, `users:read.email` (optional), `channels:read`, `groups:read`, `channels:write.invites`, `groups:write.invites`
- App token (`xapp-`) scope: `connections:write`
- Subscribe to bot event: `team_join`
- Interactivity: enabled (Socket Mode locally; production Worker uses Request URL `/slack/interactions`)
- Interactivity action ID: `iam_start_onboarding`
- Modal callback IDs: `iam_onboarding_submit`, `iam_update_submit`
- Slash command: `/iam-update` (Request URL `/slack/commands` on the Worker; Socket Mode delivers it locally)

Department and Role dropdowns are loaded from the **IAM - Users** Notion select/status property options (not hardcoded, not inferred from existing rows). Options are cached in memory for 5 minutes.

Inspect live Notion schemas without printing secrets:

```bash
npm run discover:notion
```

## Deployment

Production runs as a **Cloudflare Worker**. Deploy only via the **Deploy Worker** GitHub Action (`workflow_dispatch`) — do not ship from a local machine.

Point Slack production Request URLs at the Worker: `/slack/events`, `/slack/interactions`, `/slack/commands`.

## Slack onboarding bot

Start the Socket Mode bot:

```bash
npm run slack
```

Send the same welcome DM to an existing Slack user (does not start Socket Mode):

```bash
npm run slack:test-dm -- --user U0123456789
```

Keep `npm run slack` running in another terminal so **Start Onboarding** and `/iam-update` can open modals.

How to test the Slack flow:

1. Start the bot with `npm run slack`.
2. Add or invite a real Slack user to the workspace (bots are ignored), or send a test DM with `npm run slack:test-dm -- --user U0123456789`.
3. The bot DMs a welcome message with **Start Onboarding**.
4. Complete the modal (Full Name, Email, Mobile, Department, Role). Department/Role come from Notion. Email is the identity used for provisioning; GitHub username is not collected. Mobile is saved to the Users **Mobile** field.
5. Confirm the **IAM - Users** record (Status `Active`, Slack User ID set).
6. Slack DMs GitHub results from live GitHub APIs (invite already sent / you are already a member / invite sent). Notion and Figma always include join buttons — join with the link if you haven't already, otherwise ignore it.
7. Type `/iam-update` in Slack to reopen your details, confirm them, and save changes. Team or role updates re-run access provisioning.

## Google Drive OAuth (optional)

Google credentials are optional. If they are missing, Google Drive resources are marked **Not Configured** and other providers still run.

1. Create a Google Cloud OAuth client (Desktop or Web) with Drive scope `https://www.googleapis.com/auth/drive`.
2. Add redirect URI `http://127.0.0.1:53682/oauth2/callback` (or `GOOGLE_REDIRECT_URI`).
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
4. Run:

```bash
npm run google:auth
```

5. Copy the printed refresh token into `.env` as `GOOGLE_REFRESH_TOKEN`. The command does not write secrets to disk.
6. Discover Drive IDs:

```bash
npm run discover:google-drive
```

Map those IDs into **IAM - Access Resources** (`Provider: GoogleDrive`, `Resource Type: Folder` or `SharedDrive`, `External Resource ID`, `Permission: Viewer|Commenter|Contributor|Content Manager|Manager`).

## Notion invite links

Notion Plus has no SCIM in this engine. Workspace and space membership is invite-link based:

- Slack always shows a join button when an Invite URL is configured.
- Join with the link if you haven't already — otherwise ignore it. IAM does not record whether the link was opened.
- Set `NOTION_WORKSPACE_INVITE_URL` or put the URL on the Access Resource (`NT-WK` / `NT-WORKSPACE`, spaces, etc.).

## Figma invite links

Same pattern as Notion:

- Add **IAM - Access Resources** row `FG-WK` (`Provider: Figma`, `Resource Type: Workspace`, `Invite URL`), or set `FIGMA_INVITE_URL`.
- Slack shows **Join MOSAIC Figma**. Join with the link if you haven't already — otherwise ignore it.

## GitHub provisioning

For each desired GitHub team, IAM checks live GitHub state (not a Notion tracking table):

1. If the email has an unexpired pending organisation invitation → **invite already sent**.
2. If **Github Username** on the Members row is already a member of that team → **you are already a member**.
3. Otherwise IAM sends an organisation invitation for that team.

Re-running provision with the same email must not create duplicate unexpired invitations. Membership is checked by Github Username only — not by scanning team emails.

## Inspect access by Slack ID (dry-run)

Resolve a member by Slack ID, compare RBAC desired access to live GitHub team invitations/membership and Notion/Figma invite links. No writes.

```bash
npm run inspect:access -- --slack-id U0123456789
```

Also print what a reconcile dry-run would do:

```bash
npm run inspect:access -- --slack-id U0123456789 --reconcile
```

Identity path: Slack ID → **IAM - Users** (Slack ID field). GitHub membership is checked with the Members **Github Username** field. Pending invitations are matched by email and ignored if expired (older than 7 days).

## Demo onboarding (no Slack)

This uses the same onboarding service as the Slack modal:

```bash
npm run demo:onboarding -- \
  --name "Test User" \
  --email test@example.com \
  --department Engineering \
  --role Developer
```

Dry-run (no Notion, GitHub, Slack, or Google Drive writes):

```bash
npm run demo:onboarding -- \
  --name "Test User" \
  --email test@example.com \
  --department Engineering \
  --role Developer \
  --dry-run
```

Running the demo twice with the same email must not create duplicate IAM users or GitHub invitations.

## Manual IAM Testing

1. Add a member to **IAM - Users**.
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
7. Run provision again. GitHub should report **you are already a member** (or **invite already sent** until they accept). Member **IAM Status** should become `Synced` once every non-invite-link resource is granted.
8. Run provision a third time. GitHub should still report **you are already a member** and must not send another invitation.

GitHub email invitations require the invited address to be a **verified email** on the recipient's GitHub account.

## Legacy bootstrap / import

Import existing Slack users and GitHub usernames into **IAM - Users** before IAM becomes authoritative. Bootstrap is always non-destructive: it writes Notion Users only and never invites, grants, removes, or revokes provider access. It does **not** call `reconcileUser()`.

Required Slack bot scopes for bootstrap: `users:read`, `users:read.email`.

Optional env:

```bash
IAM_ENFORCEMENT_MODE=observe
```

- `observe` — reconciliation must never perform destructive revocation
- `enforce` — normal desired-state enforcement
- unset — preserves current grant behaviour (GitHub revoke remains unimplemented). Prefer `observe` during migration.

Optional GitHub identity file (gitignored): `migration/github-users.json`

```json
{
  "github-login": "person@example.com"
}
```

Matching order for GitHub logins: public/profile email → IAM `GitHub Username` → migration file.

Unresolved GitHub logins are logged so you can set **GitHub Username** on the Users row manually afterward.

Dry-run first (discovery/matching only; no Notion writes):

```bash
npm run bootstrap:all -- --dry-run
```

Import into Notion:

```bash
npm run bootstrap:slack
npm run bootstrap:github
npm run bootstrap:all
```

Users without Department/Role need manual classification before enforcement.

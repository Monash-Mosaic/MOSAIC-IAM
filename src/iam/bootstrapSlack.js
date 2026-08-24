import { logger } from "../utils/logger.js";
import { getDataSourceSchema } from "../notion/fields.js";
import { upsertImportedIamUser } from "../notion/users.js";
import { listActiveSlackUsers } from "../slack/users.js";
import { reportMappedOption } from "./bootstrapOptions.js";

export async function bootstrapSlack({ dryRun = false } = {}) {
  const usersSchema = await getDataSourceSchema("users");
  reportMappedOption(usersSchema, "status", "Active", { active: ["Active"] });
  reportMappedOption(usersSchema, "provisioningStatus", "Imported", {
    imported: ["Imported", "Needs Classification", "Pending"],
  });

  const discovered = await listActiveSlackUsers();
  const withEmail = discovered.filter((user) => user.email);
  const missingEmail = discovered.length - withEmail.length;
  if (missingEmail) {
    logger.warn("[SLACK]", `Skipped ${missingEmail} active Slack user(s) with no email`);
  }

  const users = [];
  let created = 0;
  let updated = 0;
  for (const slackUser of withEmail) {
    const result = await upsertImportedIamUser({
      name: slackUser.name,
      email: slackUser.email,
      slackUserId: slackUser.slackUserId,
      dryRun,
    });
    if (result.created) {
      created += 1;
    } else {
      updated += 1;
    }
    users.push(result);
  }

  const unclassified = users.filter((user) => !user.department || !user.role).length;
  if (unclassified) {
    logger.warn(
      "[SLACK]",
      `${unclassified} imported user(s) have no Department/Role and need manual classification before enforcement`,
    );
  }

  return {
    found: withEmail.length,
    mapped: withEmail.length,
    created,
    updated,
    users,
  };
}

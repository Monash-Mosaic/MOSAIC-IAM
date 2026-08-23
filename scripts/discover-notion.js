import { getEnv } from "../src/config/env.js";
import { getNotionClient } from "../src/notion/client.js";

function summarizeProperties(properties) {
  return Object.fromEntries(
    Object.entries(properties).map(([name, property]) => [
      name,
      {
        type: property.type,
        ...(property.type === "select"
          ? { options: (property.select?.options ?? []).map((option) => option.name) }
          : {}),
        ...(property.type === "status"
          ? {
              options: (property.status?.options ?? []).map((option) => option.name),
              groups: (property.status?.groups ?? []).map((group) => ({
                name: group.name,
                options: group.option_ids,
              })),
            }
          : {}),
        ...(property.type === "relation"
          ? { data_source_id: property.relation?.data_source_id }
          : {}),
      },
    ]),
  );
}

async function discover() {
  const env = getEnv();
  const notion = getNotionClient();

  const sources = [
    ["users", env.NOTION_USERS_DATA_SOURCE_ID],
    ["policies", env.NOTION_POLICIES_DATA_SOURCE_ID],
    ["resources", env.NOTION_RESOURCES_DATA_SOURCE_ID],
    ["accessTracking", env.NOTION_ACCESS_TRACKING_DATA_SOURCE_ID],
  ];

  for (const [label, dataSourceId] of sources) {
    const dataSource = await notion.dataSources.retrieve({
      data_source_id: dataSourceId,
    });
    console.log(`\n=== ${label} ===`);
    console.log("title:", dataSource.title?.map((part) => part.plain_text).join("") ?? "(untitled)");
    console.log("id:", dataSource.id);
    console.log("properties:", JSON.stringify(summarizeProperties(dataSource.properties), null, 2));
  }
}

discover().catch((error) => {
  console.error("[ERROR] Notion discovery failed:", error.message);
  process.exitCode = 1;
});

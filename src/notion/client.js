import { Client, collectPaginatedAPI } from "@notionhq/client";
import { getEnv } from "../config/env.js";

let notionClient;

export function getNotionClient() {
  if (notionClient) {
    return notionClient;
  }

  const env = getEnv();
  notionClient = new Client({
    auth: env.NOTION_TOKEN,
  });
  return notionClient;
}

export async function queryDataSource(dataSourceId, options = {}) {
  const notion = getNotionClient();
  return collectPaginatedAPI((args) => notion.dataSources.query(args), {
    data_source_id: dataSourceId,
    page_size: 100,
    ...options,
  });
}

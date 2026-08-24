async function slackApi(token, method, body) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!payload.ok) {
    throw new Error(payload.error || `Slack ${method} failed`);
  }
  return payload;
}

export function createSlackWebClient(token) {
  return {
    chat: {
      postMessage(args) {
        return slackApi(token, "chat.postMessage", args);
      },
    },
    views: {
      open(args) {
        return slackApi(token, "views.open", args);
      },
    },
  };
}

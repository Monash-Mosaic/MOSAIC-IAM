function collectMessages(error) {
  const messages = [];
  const data = error?.response?.data;
  if (data?.message) {
    messages.push(String(data.message));
  }
  for (const item of data?.errors ?? []) {
    if (item?.message) {
      messages.push(String(item.message));
    }
  }
  if (error?.message) {
    messages.push(String(error.message));
  }
  return [...new Set(messages.filter(Boolean))];
}

export function githubErrorText(error) {
  return collectMessages(error).join(" ");
}

export function isAlreadyMemberError(error) {
  if (error?.status !== 422) {
    return false;
  }
  const text = githubErrorText(error).toLowerCase();
  return (
    (text.includes("already a") && text.includes("member")) ||
    text.includes("already a part of this organization") ||
    text.includes("already part of this organization")
  );
}

export function isAlreadyInvitedError(error) {
  if (error?.status !== 422) {
    return false;
  }
  const text = githubErrorText(error).toLowerCase();
  return text.includes("already invited") || text.includes("pending invitation");
}

import { isDebugEnabled } from "../config/env.js";

function format(prefix, message) {
  return `${prefix} ${message}`;
}

export const logger = {
  info(prefix, message) {
    console.log(format(prefix, message));
  },
  warn(prefix, message) {
    console.warn(format(prefix, message));
  },
  error(prefix, message) {
    console.error(format(prefix, message));
  },
  debug(prefix, message, payload) {
    if (!isDebugEnabled()) {
      return;
    }
    if (payload === undefined) {
      console.log(format(prefix, message));
      return;
    }
    console.log(format(prefix, message), payload);
  },
};

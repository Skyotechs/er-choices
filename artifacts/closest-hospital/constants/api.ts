const PRODUCTION_API = "https://er-choices-production.up.railway.app/api";

const domain = process.env.EXPO_PUBLIC_DOMAIN;

// Replit dev domains (*.replit.dev, *.repl.co) are only reachable through
// Replit's mTLS proxy — real iOS/Android devices cannot connect to them.
// Any build that ends up with a Replit dev domain must fall back to Railway.
const isUnreachable =
  !domain ||
  domain === "undefined" ||
  domain.trim() === "" ||
  domain.includes(".replit.dev") ||
  domain.includes(".repl.co") ||
  domain.includes("replit.app");

export const API_BASE = isUnreachable
  ? PRODUCTION_API
  : `https://${domain}/api`;

const PRODUCTION_API = "https://er-choices-production.up.railway.app/api";

const domain = process.env.EXPO_PUBLIC_DOMAIN;
const validDomain = domain && domain !== "undefined" && domain.trim().length > 0;

export const API_BASE = validDomain
  ? `https://${domain}/api`
  : PRODUCTION_API;

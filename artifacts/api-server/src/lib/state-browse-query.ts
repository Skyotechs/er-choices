export function parseStateBrowseQuery(query: Record<string, unknown>) {
  const state = typeof query.state === "string"
    ? query.state.trim().toUpperCase()
    : "";
  if (!/^[A-Z]{2}$/.test(state)) {
    throw new Error("Select a two-letter state code");
  }

  function positiveInteger(value: unknown, fallback: number) {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
      throw new Error("Page and page size must be positive integers");
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new Error("Page and page size must be positive integers");
    }
    return parsed;
  }

  const page = positiveInteger(query.page, 1);
  const pageSize = positiveInteger(query.pageSize, 50);
  if (![25, 50, 100].includes(pageSize)) {
    throw new Error("Page size must be 25, 50, or 100");
  }
  if (!Number.isSafeInteger((page - 1) * pageSize) || page > 1_000_000) {
    throw new Error("Page is too large");
  }

  const status = query.status ?? "all";
  if (status !== "all" && status !== "active" && status !== "inactive") {
    throw new Error("Status must be all, active, or inactive");
  }
  return { state, page, pageSize, status };
}

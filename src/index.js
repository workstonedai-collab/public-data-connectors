// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 workstonedai-collab
const failure = (message, code) => Object.assign(new Error(message), { code });
const token = (v, label, pattern = /^[A-Za-z0-9_.-]{1,100}$/) => {
  if (typeof v !== "string" || !pattern.test(v))
    throw failure("Invalid " + label, "INVALID_INPUT");
  return v;
};
/** Fetches only an adapter's fixed official host. No AI, cookies or keys are required. */
export async function requestJson(
  url,
  { fetchImpl = fetch, timeoutMs = 12000, maxBytes = 8000000 } = {},
) {
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1
  )
    throw failure("Invalid transport limits", "INVALID_INPUT");
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (!response.ok)
      throw failure(
        "Upstream HTTP " + response.status,
        response.status === 429 ? "RATE_LIMITED" : "UPSTREAM_ERROR",
      );
    if (Number(response.headers?.get("content-length")) > maxBytes)
      throw failure("Response too large", "RESPONSE_TOO_LARGE");
    let payload = "";
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes)
            throw failure("Response too large", "RESPONSE_TOO_LARGE");
          payload += decoder.decode(value, { stream: true });
        }
        payload += decoder.decode();
      } finally {
        await reader.cancel().catch(() => {});
      }
    } else {
      payload = await response.text();
      if (Buffer.byteLength(payload) > maxBytes)
        throw failure("Response too large", "RESPONSE_TOO_LARGE");
    }
    try {
      return JSON.parse(payload);
    } catch {
      throw failure("Upstream returned invalid JSON", "INVALID_RESPONSE");
    }
  } catch (error) {
    if (controller.signal.aborted)
      throw failure("Request timed out", "TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
const finite = (v) =>
  v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
const clean = (v) =>
  typeof v === "string"
    ? v.replace(/[\u0000-\u001f]/g, " ").slice(0, 1000)
    : null;
function result(connector, records, source, metadata = {}) {
  return {
    schema_version: 1,
    connector,
    status: records.length ? "ok" : "no_data",
    records,
    source,
    retrieved_at: new Date().toISOString(),
    metadata,
  };
}
function unavailable(connector, error, source) {
  return {
    schema_version: 1,
    connector,
    status: "unavailable",
    records: [],
    source,
    error: {
      code: error.code || "NETWORK_ERROR",
      message: error.code ? error.message : "Network request failed",
    },
    retrieved_at: new Date().toISOString(),
  };
}
export function normalizeWorldBank(payload, source) {
  if (Array.isArray(payload) && payload[0]?.total === 0 && payload[1] === null)
    return [];
  if (!Array.isArray(payload) || !payload[0] || !Array.isArray(payload[1]))
    throw failure("Invalid World Bank response", "INVALID_RESPONSE");
  return payload[1].map((r) => {
    if (!r?.indicator?.id || !/^\d{4}$/.test(String(r.date)))
      throw failure("Invalid observation identity", "INVALID_RESPONSE");
    if (r.value !== null && !finite(r.value))
      throw failure("Invalid observation value", "INVALID_RESPONSE");
    return {
      kind: "observation",
      country: r.countryiso3code || r.country?.id || null,
      indicator: r.indicator.id,
      label: r.indicator.value || r.indicator.id,
      period: String(r.date),
      unit: clean(r.unit) || null,
      value: r.value === null ? null : Number(r.value),
      status: r.value === null ? "missing" : "reported",
      source_url: source.url,
    };
  });
}
export async function worldBank({
  country,
  indicator,
  startYear = 2020,
  endYear = new Date().getUTCFullYear(),
  ...transport
}) {
  country = token(country, "country", /^[A-Za-z]{2,3}$/);
  indicator = token(indicator, "indicator");
  if (
    !Number.isInteger(startYear) ||
    !Number.isInteger(endYear) ||
    startYear < 1960 ||
    endYear < startYear ||
    endYear - startYear >= 100
  )
    throw failure(
      "Use a valid year range of at most 100 years",
      "INVALID_INPUT",
    );
  const u = new URL(
    `https://api.worldbank.org/v2/country/${country}/indicator/${indicator}`,
  );
  u.search = new URLSearchParams({
    format: "json",
    date: `${startYear}:${endYear}`,
    per_page: "1000",
  });
  const source = { publisher: "World Bank", url: u.href };
  try {
    const p = await requestJson(u.href, transport);
    const records = normalizeWorldBank(p, source);
    if (Number(p[0].pages) > 1)
      throw failure(
        "Response has additional pages; narrow the query",
        "PAGINATION_REQUIRED",
      );
    return result("world-bank", records, source, {
      last_updated: p[0].lastupdated || null,
      license: "See source terms; code license does not grant data rights",
    });
  } catch (e) {
    return unavailable("world-bank", e, source);
  }
}
function dimensionCodes(dimension, size) {
  const idx = dimension?.category?.index;
  const entries = Array.isArray(idx)
    ? idx.map((v, i) => [v, i])
    : Object.entries(idx || {});
  if (
    entries.length !== size ||
    entries.some(([, i]) => !Number.isInteger(i) || i < 0 || i >= size) ||
    new Set(entries.map(([, i]) => i)).size !== size
  )
    throw failure("Invalid JSON-stat dimension", "INVALID_RESPONSE");
  return entries.sort((a, b) => a[1] - b[1]).map(([code]) => code);
}
export function normalizeEurostat(p, source, { maxRecords = 5000 } = {}) {
  if (
    !Array.isArray(p.id) ||
    !Array.isArray(p.size) ||
    p.id.length !== p.size.length ||
    !p.id.length ||
    p.size.some((s) => !Number.isSafeInteger(s) || s < 1)
  )
    throw failure("Invalid JSON-stat response", "INVALID_RESPONSE");
  const count = p.size.reduce((a, b) => a * b, 1);
  if (count > maxRecords)
    throw failure("Query too broad; add dimension filters", "QUERY_TOO_BROAD");
  const dimensions = p.id.map((key, i) =>
      dimensionCodes(p.dimension?.[key], p.size[i]),
    ),
    records = [];
  for (let index = 0; index < count; index++) {
    let rest = index;
    const codes = {};
    for (let d = p.id.length - 1; d >= 0; d--) {
      codes[p.id[d]] = dimensions[d][rest % p.size[d]];
      rest = Math.floor(rest / p.size[d]);
    }
    const value = p.value?.[index] ?? null;
    if (value !== null && !finite(value))
      throw failure("Invalid Eurostat number", "INVALID_RESPONSE");
    records.push({
      kind: "observation",
      country: codes.geo || null,
      indicator: p.label || source.dataset,
      period: codes.time || null,
      unit: codes.unit || null,
      value: value === null ? null : Number(value),
      status: value === null ? "missing" : p.status?.[index] || "reported",
      dimensions: codes,
      source_url: source.url,
    });
  }
  return records;
}
export async function eurostat({
  dataset,
  filters = {},
  maxRecords = 5000,
  ...transport
}) {
  if (!Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > 100000)
    throw failure("Invalid record limit", "INVALID_INPUT");
  dataset = token(dataset, "dataset");
  if (!filters || Array.isArray(filters) || typeof filters !== "object")
    throw failure("Filters must be an object", "INVALID_INPUT");
  const u = new URL(
    `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${dataset}`,
  );
  u.searchParams.set("lang", "EN");
  for (const [k, value] of Object.entries(filters)) {
    token(k, "dimension");
    token(String(value), "filter", /^[A-Za-z0-9_.:+-]{1,100}$/);
    u.searchParams.set(k, String(value));
  }
  const source = { publisher: "Eurostat", dataset, url: u.href };
  try {
    const p = await requestJson(u.href, transport);
    return result(
      "eurostat",
      normalizeEurostat(p, source, { maxRecords }),
      source,
      { dataset_updated: p.updated || null },
    );
  } catch (e) {
    return unavailable("eurostat", e, source);
  }
}
export function normalizeGleif(p, source) {
  if (!Array.isArray(p?.data))
    throw failure("Invalid GLEIF response", "INVALID_RESPONSE");
  return p.data.map((r) => {
    const a = r?.attributes,
      e = a?.entity;
    if (!a?.lei || !e?.legalName?.name)
      throw failure("Invalid LEI record", "INVALID_RESPONSE");
    return {
      kind: "entity",
      lei: a.lei,
      name: clean(e.legalName.name),
      country: e.legalAddress?.country || null,
      status: e.status || null,
      registration_status: a.registration?.status || null,
      last_updated: a.registration?.lastUpdateDate || null,
      source_url: `https://api.gleif.org/api/v1/lei-records/${encodeURIComponent(r.id || a.lei)}`,
    };
  });
}
export async function gleif({ name, country, limit = 5, ...transport }) {
  if (
    typeof name !== "string" ||
    name.trim().length < 2 ||
    name.length > 200 ||
    /[\u0000-\u001f]/.test(name) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw failure(
      "Use a name of 2–200 characters and a limit of 1–100",
      "INVALID_INPUT",
    );
  const u = new URL("https://api.gleif.org/api/v1/lei-records");
  u.searchParams.set("filter[entity.legalName]", name.trim());
  u.searchParams.set("page[size]", String(limit));
  if (country)
    u.searchParams.set(
      "filter[entity.legalAddress.country]",
      token(country, "country", /^[A-Z]{2}$/),
    );
  const source = { publisher: "GLEIF", url: u.href };
  try {
    const p = await requestJson(u.href, transport);
    return result("gleif", normalizeGleif(p, source), source, {
      search_matches_are_not_identity_verification: true,
      has_more: Boolean(p.links?.next),
      next_url: p.links?.next || null,
    });
  } catch (e) {
    return unavailable("gleif", e, source);
  }
}
export function toCsv(records) {
  if (!Array.isArray(records)) throw new Error("Records must be an array");
  const keys = [...new Set(records.flatMap((r) => Object.keys(r)))];
  const cell = (v) => {
    let s =
      v === null || v === undefined
        ? ""
        : typeof v === "object"
          ? JSON.stringify(v)
          : String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return (
    [
      keys.map(cell).join(","),
      ...records.map((r) => keys.map((k) => cell(r[k])).join(",")),
    ].join("\n") + "\n"
  );
}

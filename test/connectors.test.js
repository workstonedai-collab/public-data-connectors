import test from "node:test";
import assert from "node:assert/strict";
import {
  worldBank,
  eurostat,
  gleif,
  normalizeEurostat,
  toCsv,
  requestJson,
} from "../src/index.js";
const response = (p) => async () => new Response(JSON.stringify(p));
test("World Bank preserves missing values and zero distinctly", async () => {
  const r = await worldBank({
    country: "DE",
    indicator: "TEST",
    fetchImpl: response([
      { pages: 1 },
      [
        { date: "2024", value: 0, indicator: { id: "TEST" } },
        { date: "2025", value: null, indicator: { id: "TEST" } },
      ],
    ]),
  });
  assert.equal(r.status, "ok");
  assert.equal(r.records[0].value, 0);
  assert.equal(r.records[1].status, "missing");
  assert.equal(r.records[1].value, null);
});
test("World Bank distinguishes declared empty data from malformed null responses and bounds inclusive years", async () => {
  const empty = await worldBank({
    country: "DE",
    indicator: "TEST",
    fetchImpl: response([{ total: 0, pages: 0 }, null]),
  });
  assert.equal(empty.status, "no_data");
  const invalid = await worldBank({
    country: "DE",
    indicator: "TEST",
    fetchImpl: response([{ total: 1, pages: 1 }, null]),
  });
  assert.equal(invalid.error.code, "INVALID_RESPONSE");
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return new Response(JSON.stringify([{ total: 0, pages: 0 }, null]));
  };
  await worldBank({
    country: "DE",
    indicator: "TEST",
    startYear: 1960,
    endYear: 2059,
    fetchImpl,
  });
  await assert.rejects(
    worldBank({
      country: "DE",
      indicator: "TEST",
      startYear: 1960,
      endYear: 2060,
      fetchImpl,
    }),
    (e) => e.code === "INVALID_INPUT",
  );
  assert.equal(calls, 1);
});
test("JSON-stat decoding supports time in the middle and sparse values", () => {
  const p = {
    id: ["geo", "time", "unit"],
    size: [2, 2, 1],
    dimension: {
      geo: { category: { index: { DE: 0, FR: 1 } } },
      time: { category: { index: { 2024: 0, 2025: 1 } } },
      unit: { category: { index: { PCT: 0 } } },
    },
    value: { 0: 0, 2: 5 },
    status: { 2: "e" },
  };
  const r = normalizeEurostat(p, {
    url: "https://example.org/data",
    dataset: "TEST",
  });
  assert.equal(r[0].value, 0);
  assert.equal(r[1].status, "missing");
  assert.equal(r[2].country, "FR");
  assert.equal(r[2].period, "2024");
  assert.equal(r[2].unit, "PCT");
  assert.equal(r[2].status, "e");
  assert.throws(() => normalizeEurostat(p, {}, { maxRecords: 1 }));
});
test("429 and invalid upstream bodies are explicit unavailable states", async () => {
  const r = await eurostat({
    dataset: "TEST",
    fetchImpl: async () => new Response("", { status: 429 }),
  });
  assert.equal(r.status, "unavailable");
  assert.equal(r.error.code, "RATE_LIMITED");
  const bad = await worldBank({
    country: "DE",
    indicator: "TEST",
    fetchImpl: response({ error: "bad" }),
  });
  assert.equal(bad.error.code, "INVALID_RESPONSE");
});
test("input validation happens before network use", async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    throw Error();
  };
  await assert.rejects(
    worldBank({ country: "../../x", indicator: "TEST", fetchImpl: fn }),
  );
  await assert.rejects(eurostat({ dataset: "../x", fetchImpl: fn }));
  await assert.rejects(gleif({ name: "x", fetchImpl: fn }));
  assert.equal(calls, 0);
});
test("GLEIF search returns records rather than claiming verified identity", async () => {
  const r = await gleif({
    name: "Example",
    fetchImpl: response({
      data: [
        {
          id: "DEMO",
          attributes: {
            lei: "DEMO",
            entity: {
              legalName: { name: "Example" },
              legalAddress: { country: "DE" },
            },
          },
        },
      ],
    }),
  });
  assert.equal(r.records[0].kind, "entity");
  assert.equal(r.metadata.search_matches_are_not_identity_verification, true);
});
test("transport timeout and byte limit are enforced", async () => {
  await assert.rejects(
    requestJson("https://example.org", {
      maxBytes: 2,
      fetchImpl: async () => new Response("123"),
    }),
    (e) => e.code === "RESPONSE_TOO_LARGE",
  );
  await assert.rejects(
    requestJson("https://example.org", {
      timeoutMs: 5,
      fetchImpl: async (u, { signal }) =>
        new Promise((resolve, reject) =>
          signal.addEventListener("abort", () => reject(Error("abort"))),
        ),
    }),
    (e) => e.code === "TIMEOUT",
  );
});
test("CSV quotes cells and neutralizes spreadsheet formulas but keeps negative numbers", () => {
  const csv = toCsv([{ label: "=2+2", value: -2, note: 'a,"b"\nc' }]);
  assert.match(csv, /"'=2\+2"/);
  assert.match(csv, /"-2"/);
  assert.match(csv, /"a,""b""\nc"/);
});

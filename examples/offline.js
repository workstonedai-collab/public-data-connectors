// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 workstonedai-collab
import fs from "node:fs/promises";
import { worldBank, eurostat, gleif, toCsv } from "../src/index.js";
const response = (p) => async () =>
  new Response(JSON.stringify(p), {
    headers: { "Content-Type": "application/json" },
  });
const sources = [
  await worldBank({
    country: "DE",
    indicator: "DEMO.VALUE",
    startYear: 2024,
    endYear: 2025,
    fetchImpl: response([
      { pages: 1, lastupdated: "2026-01-01" },
      [
        {
          countryiso3code: "DEU",
          indicator: { id: "DEMO.VALUE", value: "Synthetic metric" },
          date: "2025",
          unit: "demo units",
          value: 0,
        },
        {
          countryiso3code: "DEU",
          indicator: { id: "DEMO.VALUE" },
          date: "2024",
          unit: "demo units",
          value: null,
        },
      ],
    ]),
  }),
  await eurostat({
    dataset: "demo",
    filters: { geo: "DE" },
    fetchImpl: response({
      id: ["geo", "time", "unit"],
      size: [1, 2, 1],
      dimension: {
        geo: { category: { index: { DE: 0 } } },
        time: { category: { index: { 2024: 0, 2025: 1 } } },
        unit: { category: { index: { DEMO: 0 } } },
      },
      value: { 0: 12, 1: 15 },
    }),
  }),
  await gleif({
    name: "Example Entity",
    fetchImpl: response({
      data: [
        {
          id: "DEMO-ONLY",
          attributes: {
            lei: "DEMO-ONLY",
            entity: {
              legalName: { name: "Example Entity (synthetic)" },
              legalAddress: { country: "DE" },
              status: "ACTIVE",
            },
            registration: { status: "ISSUED" },
          },
        },
      ],
    }),
  }),
];
await fs.mkdir("output", { recursive: true });
await fs.writeFile(
  "output/synthetic.json",
  JSON.stringify({ synthetic: true, sources }, null, 2),
);
await fs.writeFile(
  "output/observations.csv",
  toCsv(sources.slice(0, 2).flatMap((s) => s.records)),
);
console.log(
  "Offline demo: synthetic fixtures only; no network request. See output/.",
);

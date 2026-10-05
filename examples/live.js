// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 workstonedai-collab
import fs from "node:fs/promises";
import { worldBank, eurostat, toCsv } from "../src/index.js";
// Live public endpoints only. No keys. Supply ISO country codes to the adapters.
const results = [
  await worldBank({
    country: "DE",
    indicator: "NY.GDP.MKTP.KD.ZG",
    startYear: 2022,
    endYear: 2024,
  }),
  await eurostat({
    dataset: "nama_10_gdp",
    filters: { geo: "DE", na_item: "B1GQ", unit: "CP_MEUR", time: "2024" },
  }),
];
await fs.mkdir("output", { recursive: true });
await fs.writeFile("output/live.json", JSON.stringify(results, null, 2));
await fs.writeFile("output/live.csv", toCsv(results.flatMap((r) => r.records)));
console.log(
  results.map((r) => ({
    connector: r.connector,
    status: r.status,
    count: r.records.length,
    error: r.error,
  })),
);
if (results.some((r) => r.status === "unavailable")) process.exitCode = 1;

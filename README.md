# Public Data Connectors · 公开数据连接器

[English](README.md) · [简体中文](README.zh-CN.md)

[![CI](https://github.com/workstonedai-collab/public-data-connectors/actions/workflows/ci.yml/badge.svg)](https://github.com/workstonedai-collab/public-data-connectors/actions/workflows/ci.yml) · [Apache-2.0](LICENSE) · Node.js 22.12+

**Read official public APIs and keep the country, period, unit, missing-value status and source together.**

Public Data Connectors is a small JavaScript toolkit for scripts, research workflows and data pipelines. It currently connects to World Bank indicators, Eurostat JSON-stat datasets and GLEIF legal-entity records. You choose the query; the adapter handles bounded requests, normalizes the response, and tells you whether it obtained records, found no data or could not reach the source.

There is no AI scoring or built-in business conclusion. Search results from an entity register remain search results; the toolkit does not turn a similar company name into a verified identity.

## Contents

- [Where it fits](#where-it-fits)
- [Start without a key—or even a network](#start-without-a-keyor-even-a-network)
- [Choose an adapter](#choose-an-adapter)
- [Understand the result](#understand-the-result)
- [Read an actual-shaped result](#read-an-actual-shaped-result)
- [Connect your own research script](#connect-your-own-research-script)
- [Common errors and troubleshooting](#common-errors-and-troubleshooting)
- [Bounded behavior](#bounded-behavior)
- [Source access and data use](#source-access-and-data-use)
- [Development and contribution](#development-and-contribution)

## Where it fits

- Build a small country/indicator table for a research note without losing its period or source.
- Feed public observations into a spreadsheet, dashboard or another pipeline's enrichment stage.
- Retrieve legal-entity candidates and preserve their register status for human review.

```text
Your query → Official adapter → Normalized result + provenance
                                ├─ observations → JSON / CSV
                                ├─ entities → a separate table
                                └─ unavailable → an explicit error branch
```

These APIs have different dimensions and meanings. The adapters expose those differences: compare only compatible units, periods and indicators, and keep the upstream definition alongside your analysis.

## Start without a key—or even a network

Requires Node.js **22.12+**. The adapters use built-in `fetch` and have no runtime npm dependencies.

```sh
git clone https://github.com/workstonedai-collab/public-data-connectors.git
cd public-data-connectors
npm ci
npm run demo
```

Open `output/synthetic.json` and `output/observations.csv`. The demo uses injected **synthetic fixtures**, performs no network calls, and shows zero values, missing observations, units and source provenance.

For a small real query against World Bank and Eurostat:

```sh
npm run live
```

This saves results in `output/live.json` and `output/live.csv`. It does not retry silently or replace a failed response with demo values. Network availability, source changes and rate limits can affect a live run.

## Choose an adapter

| Adapter | You supply | You receive |
| --- | --- | --- |
| `worldBank` | Country code, indicator code, year range | Annual observations with values, periods and source URL |
| `eurostat` | Dataset code and dimension filters | JSON-stat cells with dimension codes, units and source status flags |
| `gleif` | Legal name, optional country, result limit | Legal-entity records and registration status, not identity verification |

```js
import { worldBank, eurostat, gleif, toCsv } from './src/index.js';

const growth = await worldBank({
  country: 'DE', indicator: 'NY.GDP.MKTP.KD.ZG',
  startYear: 2022, endYear: 2024,
});
const gdp = await eurostat({
  dataset: 'nama_10_gdp',
  filters: { geo: 'DE', na_item: 'B1GQ', unit: 'CP_MEUR', time: '2024' },
});
const entities = await gleif({ name: 'Siemens', country: 'DE', limit: 5 });
console.log(growth.status, gdp.status, entities.status);
console.log(toCsv(growth.records));
```

The source adapters accept `fetchImpl`, `timeoutMs` and `maxBytes` for testing or an appropriate transport in your environment. No browser cookies or stored API keys are used. Proxy environments can supply a configured fetch implementation.

## Understand the result

Every result has `schema_version`, `connector`, `status`, `records`, `source` and `retrieved_at`.

- **`ok`**: response parsed and records are available. A record can still contain a missing value.
- **`no_data`**: a valid response contains no records.
- **`unavailable`**: network, rate-limit, invalid-response or query-limit error; inspect `error.code`.
- Invalid local query arguments throw before a request is made.

Observation fields include `country`, `indicator`, `period`, `unit`, `value`, `status`, `source_url`. Eurostat also retains all requested dimensions. `0` stays zero; a missing number stays `null`. World Bank does not always supply a unit, so check the indicator definition rather than inventing one. Eurostat units and status flags remain official codes for you to interpret.

GLEIF records use `kind: 'entity'`, `lei`, `name`, country, entity/registration status and the source record link. The result explicitly marks that name matches are **not** identity verification.

CSV exports quote cells and neutralize formula-like string cells. Negative numeric observations remain numbers. Export entities separately from observations when you need a consistent table schema.

## Read an actual-shaped result

The offline fixture includes this **invented** observation; timestamps and complete source URLs are supplied when you run the adapter:

```json
{
  "kind": "observation",
  "country": "DEU",
  "indicator": "DEMO.VALUE",
  "period": "2025",
  "unit": "demo units",
  "value": 0,
  "status": "reported"
}
```

A missing observation instead has `value: null` and `status: "missing"`. A valid empty response has `status: "no_data"` at the result level. A failed request has `status: "unavailable"` with an error code. Do not convert all three cases to zero or silently treat a failure as an empty dataset.

## Connect your own research script

Save a small script in this clone, import the adapter, branch on status and retain source fields:

```js
import fs from 'node:fs/promises';
import { worldBank, toCsv } from './src/index.js';

const result = await worldBank({ country: 'DE',
  indicator: 'NY.GDP.MKTP.KD.ZG', startYear: 2022, endYear: 2024 });
if (result.status === 'unavailable') {
  throw new Error(`${result.connector}: ${result.error.code}`);
}
await fs.mkdir('output', { recursive: true });
await fs.writeFile('output/my-query.json', JSON.stringify(result, null, 2));
await fs.writeFile('output/my-query.csv', toCsv(result.records));
```

Run it with Node. For Eurostat, find the dataset's dimension codes in its official documentation, then narrow `filters`. For GLEIF, preserve LEI and entity/registration status, and review a candidate before joining it to another company's records.

In a scheduled or agent workflow, keep retrieval separate from interpretation: store the raw normalized result and retrieval timestamp, then pass selected records to your own analysis/enrichment stage. This package does not invoke an AI service or write to a database.

## Common errors and troubleshooting

| Code / symptom | Meaning and next step |
| --- | --- |
| `INVALID_INPUT` | Correct local query arguments before retrying |
| `RATE_LIMITED` | Upstream returned HTTP 429; slow down or reschedule rather than looping |
| `TIMEOUT` / `NETWORK_ERROR` | Check network access; supply a suitable `fetchImpl` for your network if needed |
| `UPSTREAM_ERROR` | Inspect the source service and whether the requested endpoint/dataset is valid |
| `INVALID_RESPONSE` | Source shape or data was not accepted; retain a minimal public reproduction and review the adapter |
| `QUERY_TOO_BROAD` / `PAGINATION_REQUIRED` | Add dimension filters or reduce the date range |
| `RESPONSE_TOO_LARGE` | Narrow the query before raising a documented limit |
| Empty unit or unfamiliar status code | Check the indicator/dataset definition; do not invent units or discard quality flags |

The live example exits with a nonzero status when an adapter is unavailable, while retaining the diagnostic JSON. Offline tests do not depend on source availability.

## Bounded behavior

- Default timeout: 12 seconds; default maximum body: 8 MB.
- World Bank: one country/indicator, at most a 100-year interval; additional pages require a narrower query.
- Eurostat: default maximum 5,000 cells; narrow a query with dimension filters. Decoding supports sparse values and a time dimension in any position.
- GLEIF: 1–100 results; additional-page metadata is exposed, not fetched automatically.
- No hidden caching, automatic multi-page crawl or unlimited retries. Add scheduling/caching in your own workflow.

## Source access and data use

The code's license does not grant rights to third-party datasets. Retain attribution and consult the institution's definitions and usage terms for your intended use:

- [World Bank API documentation](https://datahelpdesk.worldbank.org/knowledgebase/topics/125589-developer-information)
- [Eurostat API information](https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access)
- [GLEIF API](https://www.gleif.org/en/lei-data/gleif-api)

The first release uses public endpoints without keys for the demonstrated queries. Other services, subscriptions or private APIs are not configured. The toolkit does not contain an internal source directory, commercial dataset or scoring model.

## Development and contribution

```sh
npm test
```

Tests cover sparse JSON-stat decoding, zero/missing values, input validation, timeout/body limits, 429 responses, entity semantics and CSV escaping. Add an adapter with a fixed official host, synthetic fixtures, explicit units/provenance and bounded query behavior. See [CONTRIBUTING.md](CONTRIBUTING.md).

Project code is licensed under [Apache-2.0](LICENSE). Third-party dependencies and data retain their own terms.

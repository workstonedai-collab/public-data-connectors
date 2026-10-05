# Public Data Connectors · 公开数据连接器

[English](README.md) · [简体中文](README.zh-CN.md)

[![CI](https://github.com/workstonedai-collab/public-data-connectors/actions/workflows/ci.yml/badge.svg)](https://github.com/workstonedai-collab/public-data-connectors/actions/workflows/ci.yml) · [Apache-2.0](LICENSE) · Node.js 22.12+

**读取机构公开 API，把国家、期间、单位、缺失状态和原始来源一起保留下来。**

Public Data Connectors 是一个适合脚本、研究流程和数据流水线的小型 JavaScript 工具。目前接入 World Bank 指标、Eurostat JSON-stat 数据集和 GLEIF 法律实体记录。用户指定查询，适配器负责限制请求、规范化返回，并明确区分取得记录、无数据和接口不可用。

不包含 AI 评分或业务结论。法律实体名称检索得到的是候选记录，不会把名称相似直接宣称为身份已核验。

## 阅读导航

- [可以放在什么流程里](#可以放在什么流程里)
- [无密钥、无网络也能试用](#无密钥无网络也能试用)
- [三种适配器](#三种适配器)
- [怎样理解结果](#怎样理解结果)
- [看懂一条实际结构的结果](#看懂一条实际结构的结果)
- [接入自己的研究脚本](#接入自己的研究脚本)
- [常见错误与处理](#常见错误与处理)
- [请求有边界](#请求有边界)
- [数据来源与使用](#数据来源与使用)
- [开发与贡献](#开发与贡献)

## 可以放在什么流程里

- 为研究笔记制作小型国家/指标表，同时保留期间和来源。
- 把公开观测接入电子表格、看板或信息流水线的后续富化环节。
- 检索法律实体候选，保留登记状态，供人工复核。

```text
你的查询 → 机构适配器 → 规范化结果 + 原始来源
                        ├─ 观测 → JSON / CSV
                        ├─ 实体 → 单独的数据表
                        └─ 接口不可用 → 明确的错误分支
```

不同接口有不同维度和含义，适配器会保留这些差异。比较前应确认单位、期间、指标是否兼容，并保留机构对指标的定义。

## 无密钥、无网络也能试用

需要 **Node.js 22.12+**，使用内置 `fetch`，无运行时 npm 依赖。

```sh
git clone https://github.com/workstonedai-collab/public-data-connectors.git
cd public-data-connectors
npm ci
npm run demo
```

查看 `output/synthetic.json` 和 `output/observations.csv`。离线演示注入**虚构样例**，不发送网络请求，展示零值、缺失、单位和来源的保留方式。

真实访问 World Bank 与 Eurostat 的小范围示例：

```sh
npm run live
```

结果保存在 `output/live.json` 与 `output/live.csv`。失败不会偷偷替换为演示数值；网络、源站变化和限流都可能影响实时运行。

## 三种适配器

| 适配器 | 用户输入 | 输出 |
| --- | --- | --- |
| `worldBank` | 国家代码、指标代码、年份范围 | 年度观测、数值、期间和来源 |
| `eurostat` | 数据集代码、维度筛选 | JSON-stat 单元格、维度、单位和状态代码 |
| `gleif` | 法律名称、可选国家、数量限制 | 法律实体及登记状态；不代表身份核验 |

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

可以传入 `fetchImpl`、`timeoutMs`、`maxBytes`，用于测试或适配自己的网络环境。工具不使用浏览器 Cookie 和已保存密钥；代理环境可提供已配置的 fetch。

## 怎样理解结果

结果包含 `schema_version`、`connector`、`status`、`records`、`source` 和 `retrieved_at`。

- **`ok`**：解析成功并取得记录；其中个别数值仍可能缺失。
- **`no_data`**：有效返回中没有记录。
- **`unavailable`**：网络、限流、格式或查询范围错误，原因见 `error.code`。
- 本地查询参数不合法时，在请求前抛出错误。

观测记录含国家、指标、期间、单位、数值、状态和来源；Eurostat 额外保留维度代码。**零值仍为 0，缺失数值保留为 null**。World Bank 不总是返回单位，应查看指标定义，不自行补造；Eurostat 单位和状态保留机构代码，使用者按定义解读。

GLEIF 的记录类型为 `entity`，包含 LEI、名称、国家、实体/登记状态及原源链接，并明确标注名称匹配**不等于身份验证**。

CSV 对字段进行引号转义，并中和类似电子表格公式的字符串；负数观测仍保留数值。需要固定表结构时，实体记录与观测记录应分别导出。

## 看懂一条实际结构的结果

离线样例中有这条**虚构**观测；运行时适配器还会补充获取时间及完整来源地址：

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

缺失观测使用 `value: null`、`status: "missing"`；有效但没有记录的结果为 `status: "no_data"`；请求失败为 `status: "unavailable"` 并附错误代码。不要把三者都转换为零，也不要把请求失败默认为空数据集。

## 接入自己的研究脚本

在克隆目录里保存一个小脚本，导入适配器，按状态分支，并保留来源字段：

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

用 Node 运行即可。Eurostat 的维度代码应从机构定义中查找，再用 `filters` 收窄；GLEIF 候选应保留 LEI 和实体/登记状态，在关联其他公司记录前人工核对。

接入定时任务或 Agent 流程时，先保存规范化结果及获取时间，再把所需记录送入自己的分析/富化环节。本工具不会调用 AI 服务或写入数据库。

## 常见错误与处理

| 错误代码或现象 | 含义与处理 |
| --- | --- |
| `INVALID_INPUT` | 先修正本地查询参数，再重试 |
| `RATE_LIMITED` | 源站返回 HTTP 429，降低频率或改期运行，不循环猛试 |
| `TIMEOUT` / `NETWORK_ERROR` | 检查网络，必要时提供适合自己环境的 `fetchImpl` |
| `UPSTREAM_ERROR` | 检查源站状态，以及请求的接口/数据集是否有效 |
| `INVALID_RESPONSE` | 返回结构或数据未被接受；保留最小公开复现，检查适配器 |
| `QUERY_TOO_BROAD` / `PAGINATION_REQUIRED` | 增加维度筛选或缩短日期范围 |
| `RESPONSE_TOO_LARGE` | 优先缩小查询，再考虑调整有说明的限制 |
| 没有单位或状态代码陌生 | 查看机构定义，不补造单位、不丢弃质量标记 |

真实示例在适配器不可用时返回非零退出状态，并保留诊断 JSON。离线测试不依赖机构接口的即时可用性。

## 请求有边界

- 默认 12 秒超时，响应体上限 8 MB。
- World Bank 限一个国家/指标、最多 100 年区间；若仍需分页，应收窄查询。
- Eurostat 默认最多 5,000 个单元格；通过维度筛选收窄。支持稀疏数值和任意位置的时间维度。
- GLEIF 限 1–100 条，额外分页信息会保留，不自动翻页。
- 无隐藏缓存、无限重试或批量翻页采集；按自己的流程另加调度和缓存。

## 数据来源与使用

代码许可不会授予第三方数据集的使用权。保留来源，并按具体用途查看机构定义和使用说明：

- [World Bank API 文档](https://datahelpdesk.worldbank.org/knowledgebase/topics/125589-developer-information)
- [Eurostat API 信息](https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access)
- [GLEIF API](https://www.gleif.org/en/lei-data/gleif-api)

首版演示查询使用无需密钥的公开接口；没有配置付费订阅或私有 API，不附带内部来源清单、商业数据或评分模型。

## 开发与贡献

```sh
npm test
```

测试覆盖 JSON-stat 维度解码、零值/缺失、参数、超时和体积限制、429、实体语义及 CSV。新增适配器应提供固定官方主机、合成样例、明确的单位和来源，以及有界查询。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

项目代码使用 [Apache-2.0](LICENSE)。第三方依赖及数据保留自身条款。

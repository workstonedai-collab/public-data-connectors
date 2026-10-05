# Verification / 验证记录

Date: 2026-10-05. Local platform: macOS, Node.js 22.23.1.

8 automated tests passed. / 8 项自动测试通过。

Synthetic fixtures cover zero/missing/empty data, inclusive year limits, JSON-stat sparse dimensions, GLEIF semantics, transport limits and CSV. Small live requests previously returned 3 World Bank, 1 Eurostat and 5 GLEIF records; live data is excluded from this repository. / 合成样例覆盖零值、缺失、无数据、年份、维度、实体语义和传输；三类真实接口已小范围验证，实时数据不纳入仓库。

CI is configured for Node 22/24 on Linux, macOS and Windows. Use the live CI badge for current remote results. / 配置三种系统及两种 Node 版本的 CI，当前远端结果请查看 CI 徽章。

All demo content is synthetic. Generated output, local state, secrets and deployment bindings are excluded. / 演示内容为合成样例，生成结果、本地状态、密钥和部署绑定不纳入发布。

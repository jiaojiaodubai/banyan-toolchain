# Banyan Style Test Kit

[![CI](https://github.com/jiaojiaodubai/banyan-toolchain/actions/workflows/toolchain.yml/badge.svg)](https://github.com/jiaojiaodubai/banyan-toolchain/actions/workflows/toolchain.yml)

面向 AI Agent 与开发者的 **Banyan 样式离线自测工具**：加载 Zotero RDF 或简易
JSON 条目库作为测试数据，在 Node 沙箱中执行样式，输出与真实宿主一致的 HTML，
并用快照守护回归。

核心能力（样式装载、Unit 编译、富文本/HTML 渲染、数据规范化、Zotero/CSL
schema 数据）全部来自同一工具链中的 `@banyan/core`。本包只提供宿主侧：Zotero
RDF 读写、简易 JSON 条目库（含 JSON Schema、校验与加载）、测试库（伪
`Zotero.Item` 与数据 API 桩）、Node 运行时（`node:vm` + realm 隔离）、隔离运行器、
CLI、fixtures 与快照断言。

## 特性

- **两种测试数据源**：Zotero 导出的 RDF，或直接使用 Banyan 条目表示的 JSON
  条目库；两者最终都进入同一个 `TestLibrary`。
- **与核心共享渲染**：样式输出、Unit 编译和 HTML 渲染直接调用 `@banyan/core`，
  不在本仓库复制算法；snapshot 只守护默认渲染器的回归。
- **结构化断言**：优先断言 `StyleResult` 的 `RichText`（`text` + `marks`）和
  `diagnostics`，HTML 快照用于视觉/渲染回归。
- **可隔离执行**：默认 `node:vm` 正确性沙箱；`--isolated` 在独立子进程中运行，
  带墙钟、内存和输出体积上限。
- **CLI 与编程接口**：`run` / `unit` / `lint` / `items validate|dump|schema` /
  `rdf dump|build`，也可直接 import `TestLibrary`、`runStyle`、`loadStyle`、
  `lintStyleSource`。
- **同一套 lint 规则**：静态检查直接复用 `eslint-plugin-banyan-style`，与 Banyan
  插件和 Banyan Styles 仓库保持一致。

## 快速开始

需要 Node ≥ 22.18 与 pnpm 10。

```sh
pnpm install          # 从 package.json 的 pin 安装 @banyan/core（GitHub）
pnpm test             # 契约 / RDF / JSON 条目库 / 库 / CLI / HTML 一致性 / 隔离
pnpm e2e              # 真实 preset 样式 + fixtures + 基线快照 --check
pnpm e2e:minimal      # 自带最小样式 + fixtures + 基线快照 --check
```

直接运行 CLI（数据源二选一：`--rdf` 或 `--items-json`）：

```sh
pnpm cli run --style fixtures/styles/numeric-minimal.js \
  --rdf fixtures/library-basic.rdf --contexts fixtures/contexts-basic.json

pnpm cli run --style fixtures/styles/numeric-minimal.js \
  --items-json fixtures/items-basic.json --contexts fixtures/contexts-basic.json

pnpm cli items validate --items-json fixtures/items-basic.json
pnpm cli items schema
pnpm cli lint --style fixtures/styles/numeric-minimal.js
```

样式契约：条目在沙箱内不含 `key` / `uri` / `relations` 等宿主私有字段，样式一律
使用 `item.id` 引用条目（字符串；Zotero 的数字 id 由宿主编码一次）。

## 脚本

| 命令               | 作用                                                       |
| ------------------ | ---------------------------------------------------------- |
| `pnpm typecheck`   | TypeScript 类型检查（含测试与脚本）                        |
| `pnpm test`        | 全量 mocha 测试                                            |
| `pnpm e2e`         | 内置 GB/T 7714-2025 preset 的 HTML 快照检查                |
| `pnpm e2e:update`  | 重写 preset 基线                                           |
| `pnpm e2e:minimal` | 内置最小样式的 HTML 快照检查                               |
| `pnpm fixtures`    | 由条目模型重新生成 RDF / JSON fixtures、contexts 与 Schema |
| `pnpm cli`         | 运行 CLI（见 `docs/usage.md`）                             |
| `pnpm lint:check`  | Prettier 格式检查                                          |
| `pnpm lint:fix`    | Prettier 自动格式化                                        |

## 目录

```
src/
  banyan.ts        # @banyan/core 的唯一导入转发点
  runtime/         # SandboxRuntime 的 Node 实现 + 宿主能力（linkedom、文件白名单）
  rdf/             # Zotero RDF 命名空间、路由表、解析器、序列化器
  library/         # 测试库：伪 Zotero.Item、JSON 条目库、按 schema 解析字段
  run/             # contexts 构造、样式执行、隔离运行、渲染、快照
  lint.ts          # 与 Banyan 共用的 ESLint 规则 runner
  cli.ts           # run / unit / lint / items validate|dump|schema / rdf dump|build
scripts/
  gen-fixtures.ts   # 由条目模型生成 fixtures、contexts 与 JSON Schema
fixtures/
  *.rdf            # 测试数据（生成） + 手工的 aliases.rdf / zotero-export.rdf
  items-*.json     # 简易 JSON 条目库（生成：Banyan 条目表示）
  contexts-*.json  # 引用上下文示例（生成）
  styles/          # 内置测试样式（最小样式 + GB/T 7714-2025 preset）
  html/            # HTML 一致性 fixture（允许的标记/属性、解析差异）
  snapshots/       # 基线快照（生成，勿手工编辑）
schema/
  item-database.schema.json  # 简易条目库的 JSON Schema（生成）
test/              # 契约、RDF、JSON 条目库、库、CLI、HTML 一致性、能力、隔离、快照测试
docs/
```

## 文档

- [docs/usage.md](docs/usage.md) — CLI、测试数据、编程接口与断言口径
- [docs/item-json.md](docs/item-json.md) — 简易 JSON 条目库的格式、校验与多语言支持
- [docs/zotero-rdf.md](docs/zotero-rdf.md) — Zotero RDF 映射规则与 fixtures
- [docs/security.md](docs/security.md) — `node:vm` 的能力边界与隔离运行器
- [CONTRIBUTING.md](CONTRIBUTING.md) — 开发、测试与核心版本升级
- [SECURITY.md](SECURITY.md) — 报告安全问题的方式

## 工具链版本

本包是 `Banyan-Toolchain` 工作区的一部分，通过 `workspace:*` 使用同一 revision
的 `@banyan/core` 和 `eslint-plugin-banyan-style`，不再在 `package.json` 中固定
单独的 GitHub commit。完整样式库在工具链之外，用自己的 `toolchain.lock.json`
固定一个 toolchain revision；升级时更新该 revision、重新安装并运行完整样式套件。

## 许可

AGPL-3.0-or-later。Zotero RDF 的映射与算法部分自 Zotero（AGPL-3.0-or-later）
移植/整理；`fixtures/styles/gb-t-7714-2025-numeric.js` 为 MIT 许可的 Banyan
preset 样式。详见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。

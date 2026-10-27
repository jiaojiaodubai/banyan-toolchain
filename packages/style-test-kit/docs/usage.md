# 使用指南

TestKit 是一个 **离线** 的 Banyan 样式自测工具：加载 Zotero RDF 或简易 JSON
条目库作为测试数据、在 Node 沙箱中执行样式、输出与真实宿主一致的 HTML。核心能力
（样式装载、Unit 编译、渲染、数据规范化、schema 数据）全部来自
[`@banyan/core`](https://github.com/jiaojiaodubai/banyan-core)；本工具只提供宿主侧
的部分。

两种数据源：Zotero RDF（真实库导出的形状，见 [zotero-rdf.md](zotero-rdf.md)）与
[简易 JSON 条目库](item-json.md)（Banyan 条目表示，适合手写和 Agent 生成）。
两者最终都交给 `TestLibrary`。

## 环境

- Node ≥ 22.18，pnpm 10
- `pnpm install` 会按 `package.json` 的 pin 从 GitHub 安装 `@banyan/core`，
  不需要相邻目录或核心源码 checkout

```sh
pnpm install
pnpm typecheck        # 类型检查（含测试）
pnpm test             # mocha：契约 / RDF / 库 / CLI / HTML 一致性 / 隔离
pnpm e2e              # preset 样式 + fixtures + 基线快照 --check
pnpm e2e:update       # 重写 preset 基线
pnpm e2e:minimal      # 自带最小样式 + fixtures + 基线快照 --check
pnpm fixtures         # 由条目模型重新生成 fixtures 与 contexts
```

## CLI

统一入口 `pnpm cli ...`（等价于 `node --import tsx src/cli.ts ...`）。
退出码：`0` 成功，`1` 错误，`2` 快照不匹配。

### run — 执行样式

```sh
pnpm cli run --style <样式.js> (--rdf <测试数据.rdf> | --items-json <条目库.json>) \
  (--contexts <contexts.json> | --items "key1,key2" [--items ...]) \
  [--options <选项.json>] [--style-dir <沙箱可读目录>] \
  [--snapshot <文件> [--check | --update]] \
  [--document] [--json] [--isolated [--timeout ms] [--memory mb] [--max-output bytes]]
```

- `--rdf` 与 `--items-json` 二选一：前者读 Zotero RDF，后者读
  [简易 JSON 条目库](item-json.md)；
- `--items a,b` 可重复，每次出现即一条引用上下文；
- `--contexts` 接收 `CitationSpec[]` 或 `{ contexts: [...] }`（见下）；
- `--options` 是 `{ 参数id: string | boolean }` 的 JSON 对象，对应样式的
  `STYLE_OPTIONS`；未给的参数由核心按声明的 `defaultValue` 补全，
  `applicable`/`forcedValue` 也由核心解析；
- 默认输出渲染后的 HTML 片段；`--document` 输出完整文档；`--json` 输出
  INFO / 诊断 / 结构化结果、渲染结果、数据源类型（`dataSource`）与实际生效的
  参数值；
- `--snapshot` 默认比对（不匹配退出码 2），`--update` 重写基线；
- `--isolated` 把样式放进资源受限的独立子进程运行（两种数据源都支持），见
  [security.md](security.md)；`--timeout` 在隔离模式下是墙钟上限，在进程内模式下
  是同步 `evaluate` 预算。

### items — 简易 JSON 条目库

```sh
pnpm cli items validate --items-json <file.json> [--json]  # 校验（有 error 时退出 1）
pnpm cli items dump     --items-json <file.json> [--json]  # 打印规范化后的记录
pnpm cli items schema                                      # 打印 JSON Schema
```

校验报告 `error` / `warning` 与 `path`；warning 不阻止加载，`error` 会让 `run`
拒绝该数据源。完整格式见 [item-json.md](item-json.md)。

`extra` 的语义也在这里校验：`type` 必须是 CSL/CSL-M 条目类型，否则 citeproc
会把条目录成无类型（`error`）；其它 citeproc 不会读取的 extra 键报 `warning`，
`creators-ext` 等 Banyan 自己消费的键除外。

### unit — 样式元信息

```sh
pnpm cli unit --style <样式.js> [--json]
```

加载样式（完整的 `createStyle` 流程，不执行 `generate`），打印 `INFO`、
`STYLE_OPTIONS`、`CITATION_PARAMS` / `CITE_PARAMS`（参数 id、kind、默认值、
states/presets、列表字段）、`ITEM_FIELD_PRESETS`、`ITEM_FIELD_VALIDATORS` 与诊断；
回调函数（`applicable`、`forcedValue`、`validate`、preset `visible`、字段校验）只报告
“已声明”，不序列化。注意：`unit` 在**进程内**装载样式；不可信样式请用
`run --isolated`。

### lint — 静态检查

```sh
pnpm cli lint --style <样式.js> [--json]
```

用 `eslint-plugin-banyan-style` 的同一套规则检查样式契约、参数、字段预设、字段校验器、
运行时风险与字段读取。文本输出为 `文件:行:列 级别 消息 (规则)`；有 error 时退出 1，
只有 warning 时退出 0。`--json` 输出原始消息数组。编程接口为
`lintStyleSource(code, { filePath?, typingsDir?, warnCount? })`。

### rdf dump / build

```sh
pnpm cli rdf dump --rdf <file.rdf> [--json]        # 解析为条目记录
pnpm cli rdf build --rdf <file.rdf> [--out <file>] # 解析→序列化（往返）
```

## 测试数据（contexts）

`fixtures/contexts-basic.json`：

```json
{
  "contexts": [
    {
      "id": "citation-1",
      "cites": [
        { "item": "ITEM0001", "params": { "locator": "1025" } },
        { "item": "#item_3" }
      ]
    }
  ]
}
```

`item` 引用支持四种形态：`z:key`（如 `ITEM0001`）、RDF subject（`#item_3`，
或真实导出里的 URL / `urn:isbn:` / `urn:issn:`）、数字 id（按文档顺序，从 1
开始，非正规条目不计入）。JSON 条目库按记录自己的 `id` 引用（如 `"zh"`），数字
位置同样可用。
`id`/`page` 缺省时按出现顺序生成（`citation-N` / `N`）。`params`（citation 级与
cite 级）由核心按样式声明的 `CITATION_PARAMS` / `CITE_PARAMS` 解析（默认值、
`applicable`/`forcedValue`），样式读到的总是生效值；`citation.source` 保留传入的
存储值。

现有 fixtures：

| 文件                      | 内容                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `library-basic.rdf`       | 常见条目类型、容器/丛书/出版者、多语言对、creators-ext、标签                                    |
| `multilingual.rdf`        | 三语（en / zh-CN / ja）互链的多语言组 + 一个无关条目                                            |
| `creators-ext.rdf`        | 合法扩展记录、单名作者、故意残缺的记录（产生库诊断）                                            |
| `aliases.rdf`             | 手工编写：别名前缀、`rdf:parseType="Resource"`、嵌套结构                                        |
| `zotero-export.rdf`       | 手工编写：Zotero 官方导出形状（typed 节点、`rdf:Seq` 创建者、无 `z:key`、附件/笔记/collection） |
| `items-basic.json`        | 直接 Banyan 条目表示：id 为 `ITEM0001`…、含字段/extra/多语言组                                  |
| `items-multilingual.json` | 三语多语言组（数据库级 `multilingual` 声明）                                                    |
| `html/conformance.json`   | HTML 一致性用例（允许的标记/属性、已知解析差异）                                                |

`schema/item-database.schema.json` 是简易条目库的 JSON Schema（由
`ITEM_DATABASE_SCHEMA` 生成，`pnpm fixtures` 重写）。

## 编程接口（src/index.ts）

```ts
import {
  TestLibrary,
  buildContexts,
  loadStyle,
  runStyle,
  renderDocument,
  runStyleIsolated,
  validateItemDatabase,
} from "@banyan/style-test-kit";

// 数据源二选一：RDF，或简易 JSON 条目库（见 item-json.md）
const library = TestLibrary.fromRdf(rdfXml);
const fromJson = TestLibrary.fromItemDatabase(database);
validateItemDatabase(database); // error/warning 列表（不抛）
fromJson.diagnostics; // 加载期 warning

const contexts = buildContexts(library, [{ cites: [{ item: "ITEM0001" }] }]);
const loaded = await loadStyle({ code, library, styleDir });
loaded.style.INFO; // 只装载，不执行 generate（unit 命令走这条路径）
const run = await runStyle({ code, library, styleDir }, contexts);
run.style.diagnostics; // 结构化诊断（severity/source/code/message）
run.messages; // 全部消息，trace 含在内
run.styleOptions; // 生效的 STYLE_OPTIONS 值（样式声明了参数时）
library.diagnostics; // 条目转换期告警（如残缺的 creators-ext 记录）
renderDocument(run.result); // 完整 HTML

// 传给 generate() 的样式参数值（未给用 defaultValue 补全）
await runStyle(
  { code, library, styleDir, styleOptions: { annotate: true } },
  contexts,
);

// 不可信样式：独立子进程 + 资源上限（rdf 或 itemsJson 其一）
const isolated = await runStyleIsolated({
  code,
  rdf: rdfXml,
  contexts: [{ cites: [{ item: "ITEM0001" }] }],
  styleDir,
  styleOptions: { annotate: true },
  timeoutMs: 10_000,
  memoryMb: 256,
  maxOutputBytes: 4 * 1024 * 1024,
});
```

测试断言应基于结构化 `StyleResult`（`RichText` 的 `text` + `marks`）与
`diagnostics` 字段，**不要**匹配文本前缀或 HTML 细节；HTML 快照只是默认 renderer
的回归守护，不是跨宿主契约。

## Schema 数据来自核心

本工具不维护自己的 Zotero/CSL 字段表。核心从包 index（与
`@banyan/core/schema`）同时导出三种形态，按需取用：

- **速查表**（常量，按条目热路径查询）：`ZOTERO_ITEM_TYPES`、
  `ZOTERO_CREATOR_TYPES`、`ZOTERO_ITEM_TYPE_FIELDS`、`ZOTERO_FIELDS`、
  `ZOTERO_PRIMARY_CREATOR_TYPES`、`ZOTERO_BASE_FIELD_ALIASES`、
  `ZOTERO_CREATOR_TYPE_CSL_NAMES`，以及官方 CSL 的 `CSL_ITEM_TYPES` /
  `CSL_*_VARIABLES` 和独立 CSL-M Schema 的 `CSL_M_ITEM_TYPES` /
  `CSL_M_*_VARIABLES`（另见 `CSL_M_ONLY_*` 专有集合）；
- **运行时模型**（`ZOTERO_SCHEMA` / `CSL_SCHEMA` / `CSL_M_SCHEMA`）：每个常规条目
  类型的 `fields`、`baseFields`、`creatorTypes`、`primaryCreatorType`，以及官方
  CSL 与独立的 CSL-M 词汇。它编译进核心的模块图，因此宿主不需要读文件、JSON
  loader 或 `resolveJsonModule`；
- **查询谓词**：`isZoteroField`（是不是 Zotero 字段，否则写 extra）、
  `isZoteroItemField`（该类型是否存这个字段）、`resolveZoteroField`（基名落到该
  类型的哪个字段）、`isCslVariable` / `isCslItemType`（官方 CSL）、
  `isCslMVariable` / `isCslMItemType`（完整 CSL-M）、
  `isCslMOnlyVariable` / `isCslMOnlyItemType`（CSL-M 专有）。匹配是**精确、
  大小写敏感**的（与 Zotero 的 `ItemFields.getID` 一致）。

本工具内部：`zotero-fields.ts` 用 `isZoteroItemField` 判断“该类型有没有 reporter”
（只有 `case` 有，所以只有它的容器标题落 `reporter`），`first-creator.ts` 直接用
`ZOTERO_PRIMARY_CREATOR_TYPES`；`test/schema-facts.test.ts` 用模型、表与谓词互相
核对，任何一边滞后都会失败。需要文件形态时，核心还发布
`@banyan/core/schema/zotero-schema.json` 与 `csl-schema.json`（内容与模型相同）。

## 与 Zotero 宿主的差异与样式契约

- **样式不得依赖宿主私有键**：沙箱条目与 Zotero 宿主一致地剥离
  `key` / `uri` / `relations`（读取 `item.key` 得到 `""`），样式引用条目一律
  使用 `item.id`。`id` 按 Banyan 契约是**字符串**：TestKit 把宿主内的数字 id
  一次编码为字符串（Zotero 的 42 在样式里是 `"42"`）。测试数据中的 `z:key`
  只是 TestKit 输入格式（contexts 用它解析条目，序列化时写回），不会进入样式
  可见的条目；
- **HTML 解析器不同**：Zotero 宿主用 Gecko，TestKit 用 linkedom。两者都只把核心
  支持的标记（`b/strong/i/em/sup/sub/sc/a/span/br`）交给核心，`fixtures/html`
  固定了期望的 `text` + `marks`，几处已知差异标注为 caveat；
- **`eval` / `new Function` 默认禁用**（Gecko 宿主运行时允许），见
  [security.md](security.md)；
- **子集输入**：只支持 Zotero RDF（不含 Bibliontology）；notes、attachments、
  collections 不参与解析与导出；标签的自动/手动类型不保留。

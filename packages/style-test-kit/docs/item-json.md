# 简易 Banyan Item 数据库（JSON）

这是测试数据的 JSON 表示：每条记录就是 Banyan 条目（`Item`）的形状，字段就是
样式读到的字段，`id` 就是样式里的 `item.id`。用于手写测试数据，或让 Agent 生成
测试数据。

```json
{
  "items": [
    {
      "id": "zh",
      "itemType": "journalArticle",
      "title": "多语言文献的引用实践",
      "publicationTitle": "物理学报",
      "date": "2022-06-01",
      "language": "zh-CN",
      "creators": [
        { "creatorType": "author", "lastName": "李", "firstName": "梅" }
      ],
      "tags": ["multilingual"],
      "extra": { "language": "zh-CN" }
    },
    {
      "id": "en",
      "itemType": "journalArticle",
      "title": "Multilingual citation practice",
      "publicationTitle": "Journal of Citation Studies",
      "date": "2022",
      "creators": [
        { "creatorType": "author", "lastName": "Lee", "firstName": "Mei" }
      ]
    }
  ],
  "multilingual": [["zh", "en"]]
}
```

顶层直接给记录数组（`[...]`）也可以，此时没有多语言组。

## 记录

| 键         | 含义                                                                    |
| ---------- | ----------------------------------------------------------------------- |
| `id`       | 条目 id（样式里的 `item.id`）；可选，缺省为数组位置 `"1"`、`"2"`…       |
| `itemType` | 必填；常规 Zotero 类型（`note`/`attachment`/`annotation` 报错）         |
| `creators` | `{ creatorType, name }` 或 `{ creatorType, firstName, lastName }`       |
| `tags`     | 字符串数组                                                              |
| `extra`    | 解析后的键值映射（`string` 或 `string[]`），不是 Zotero 的 `extra` 文本 |

其余键都是条目字段，值写字符串或数字即可；空字符串会被丢弃。字段按核心 Schema
校验：

- 基字段名（`publicationTitle`、`date`…）在任何类型上都可用；写了类型专有字段
  （`bookTitle`、`reporter`…）时，加载器会按核心的别名规则补出基字段；
- `year`、`firstCreator` 可以显式给出；不给出时从 `date` 与 `creators` 推导；
- 未知字段、该类型没有的字段、被 Banyan 条目剔除的字段（`abstractNote` 等）都是
  **warning**：记录仍然加载，提示可在 `library.diagnostics` 里读到；
- 不允许出现的键：`key`、`uri`、`relations`、`multilingual`（多语言组在数据库顶层
  声明）；
- `extra` 的键值也按 CSL 语义校验：`type` 必须是 CSL/CSL-M 条目类型（否则
  **error**，citeproc 会把条目录成无类型）；citeproc 不读取的其它 extra 键是
  **warning**，`creators-ext` 等 Banyan 自己消费的键除外。

## 多语言组

```json
{ "items": [ … ], "multilingual": [["zh", "en"], ["ja", "ko"]] }
```

- 每个组是条目 id 列表，至少两个成员；
- **契约：一个 id 最多出现在一个组里**——重复会报错；
- 组内重复、未知 id、成员不是字符串都会报错；
- 加载器把组绑定到条目 id，沙箱里的 `getMultilingualItems(item)` /
  `getMultilingualItem(item, language)` 因此可用。多语言匹配读条目的 `language`
  字段（和普通 Banyan 条目一致），所以记录里写 `language` 能让语言选择生效。

## 校验与加载

```ts
import {
  TestLibrary,
  validateItemDatabase,
  parseItemDatabase,
  ITEM_DATABASE_SCHEMA,
} from "@banyan/style-test-kit";

const database = JSON.parse(readFileSync("items.json", "utf8"));
validateItemDatabase(database); // ItemDatabaseIssue[]（error / warning + path）
const library = TestLibrary.fromItemDatabase(database); // 有 error 时抛出全部错误
library.diagnostics; // 加载期 warning
library.require("zh"); // 按 id 引用，也可用数字位置 library.require(1)
```

`parseItemDatabase(database)` 返回 `{ items, groups, issues }`（`items` 是已经
规范化好的 Banyan 条目），`requireValidItemDatabase()` 是“有 error 就抛”的版本。
JSON Schema 位于 `schema/item-database.schema.json`，由 `ITEM_DATABASE_SCHEMA`
生成，`pnpm fixtures` 重写它。

## CLI

```sh
pnpm cli items validate --items-json fixtures/items-basic.json [--json]
pnpm cli items dump     --items-json fixtures/items-basic.json [--json]
pnpm cli items schema
pnpm cli run --style fixtures/styles/numeric-minimal.js \
  --items-json fixtures/items-basic.json --contexts fixtures/contexts-basic.json
```

`validate` 有 error 时退出码 1；`dump` 打印规范化后的条目 + 多语言组；`schema`
打印 JSON Schema。

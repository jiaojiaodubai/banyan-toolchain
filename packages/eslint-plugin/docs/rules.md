# 规则清单

所有规则以 `banyanStyle/` 为插件前缀。默认级别来自 `createBanyanStyleConfig()`；宿主可以按需覆盖。

| 规则                             | 默认级别 | 作用                                                                  |
| -------------------------------- | -------- | --------------------------------------------------------------------- |
| `require-style-contract`         | error    | 检查样式入口与 `INFO` 元数据契约                                      |
| `validate-params`                | error    | 检查三层参数声明、默认值、`applicable` / `forcedValue`                |
| `warn-param-count`               | warn     | `STYLE_OPTIONS` 过多时提示拆分，默认阈值 12、上限 16                  |
| `validate-field-presets`         | error    | 检查 `ITEM_FIELD_PRESETS` 形状与可写字段                              |
| `validate-item-field-validators` | error    | 检查 `ITEM_FIELD_VALIDATORS` 分组与检查器                             |
| `validate-style-dependencies`    | error    | 检查 `STYLE_DEPENDENCIES` 形状、id 与自引用                           |
| `validate-style-resources`       | error    | 检查 `STYLE_RESOURCES` 资产 id、`format` 与已移除的 `path`/`validate` |
| `warn-risky-runtime-pattern`     | warn     | 提示可能拖死沙箱的循环与递归                                          |
| `warn-item-field-misuse`         | warn     | 提示按 Zotero UI 标签读取字段，或读取 Banyan 不携带的键               |
| `warn-note-context`              | warn     | 提示 note-citation 样式在尾注场景下的按页分组与字符串页真值问题       |

## 样式契约

### `require-style-contract`

检查 `INFO` 与 `generate` 入口。入口可以写成顶层绑定，也可以写成 `style` 对象成员。

- 缺少 `INFO` 或 `generate`：报错。
- `generate` 不是函数：报错。
- `INFO` 不是对象字面量：报错。
- `INFO` 缺少必填字段：`id`、`title`、`description`、`citationType`、`creator`、`tags`、`documentation`、`license`、`updated`。
- `INFO.id/title/description/license/updated` 不是字符串字面量：报错。
- `INFO.creator/tags/documentation` 不是数组：报错。
- `INFO.citationType` 不是 `intext-citation` 或 `note-citation`：报错。
- `INFO.creator` 的元素缺少 `type` 或 `name`：报错。

## 参数声明

### `validate-params`

检查 `STYLE_OPTIONS`、`CITATION_PARAMS`、`CITE_PARAMS` 的声明形状。

- 声明必须是数组，元素必须是对象字面量。
- `id` 必须是非空字符串且在同一层内唯一；`label` 必须是非空字符串。
- `kind` 只能是 `state`、`value`、`list`。
- `STYLE_OPTIONS` 不接受 `applicable`；`list` 只能出现在 `CITE_PARAMS`。
- `state`：无 `states` 时 `defaultValue` 必须是布尔值；有 `states` 时必须给出其中一个键，缺失或不是键都报错。`states` 的键必须是静态字符串，`[variable]` 形式的动态键报错。不接受 `validate`、`presets`、`format`。
- `value`：`defaultValue` 必须是字符串；`format` 只能是 `plain` / `rich`；`validate` 必须是函数；`presets` 必须是字符串或 `{ label, value }` 数组。
- `list`：必须有非空 `fields` 数组；字段必须是 `kind: "value"`，且不能带 `applicable` / `forcedValue`；`min` / `max` 必须是非负数字面量。
- `STYLE_OPTIONS` 超过 16 项时另报 `tooManyStyleOptions`。

### `warn-param-count`

`STYLE_OPTIONS` 数量达到告警阈值（默认 12，可通过 `warnCount` 配置为 1–16）且不超过上限 16 时给出拆分建议。

## 字段预设

### `validate-field-presets`

检查 `ITEM_FIELD_PRESETS`。

- 必须是数组；元素必须是对象字面量。
- 每项必须有非空字符串 `id`，同一份声明内不能重复。
- `label` 如存在，必须是非空字符串；不支持 locale 映射。
- `visible` 如存在，必须是函数、箭头函数或函数标识符引用。
- `fields` 必须是非空对象，值必须是非空字符串，或 `null`（表示应用时询问用户）。
- `fields` 的键不能是主键/身份字段（`id`、`key`、`itemType`、`extra` 等），不能是 CSL name variable，且必须符合 `extra` 变量行键名语法。
- `fields` 的键必须是静态字符串；`[variable]` 形式的动态键报错，`["type"]` 这类静态计算键按字面量处理。

## 字段校验器

### `validate-item-field-validators`

检查 `ITEM_FIELD_VALIDATORS`。

- 顶层必须是以条目类型为键的对象；键必须是静态字符串，`[variable]` 形式的动态键报错。
- 每个条目类型对应非空检查器数组。
- 每个检查器必须是对象字面量，带非空字符串 `description` 与函数 `check`。
- 同一条目类型下 `description` 不能重复。

## 依赖与资源声明

### `validate-style-dependencies`

检查 `STYLE_DEPENDENCIES`：一个 `string[]`，声明本样式可经 `callStyle()` 调用的其他样式 id。

- 不是数组、元素不是字符串字面量：报错。
- id 必须是非空字符串，不能是保留声明键（`__proto__`），同一层内不能重复。
- id 等于本样式 `INFO.id`：报错（`callStyle()` 会按环处理）。
- 超过 4 条：报错。运行时保留前 4 条并警告。

依赖只能是可选的：调用方必须为每个失败原因自带降级分支；跨文件的环、缺失依赖与调用深度由 `style-test-kit deps` 检查，不由单文件 lint 负责。

### `validate-style-resources`

检查 `STYLE_RESOURCES`：一个 `{ id, format }` 数组，声明本样式可经 `loadResource()` 读取的资产。

- 不是数组、元素不是对象字面量：报错。
- `id` 是资产文件名，也是 `loadResource()` 的键：只能是小写字母、数字和单短横线（`^[a-z0-9]+(?:-[a-z0-9]+)*$`），最长 64 个字符；同一数组内必须唯一。
- 文件固定读取 `assets/<id>`（相对样式目录，无扩展名）；没有 `path`，也不允许在 `banyan/` 根下放裸文件。
- `format` 只能是 `json` 或 `text`；缺失或非法值报错。
- `path`、`validate` 已移除：出现时分别报 `resource.path.invalid` / `resource.validate.invalid`，提示改用 `assets/<id>` 与公开维护的资产；其他键报 `declaration.key.unknown`。
- 超过 8 条：报错。运行时保留前 8 条并警告。

声明与运行时共用 `isValidResourceId()`，因此静态判定与运行时校验不会不一致。

`readBytes()` / `readText()` / `readJSON()` 已从作者 API 移除：读取资产统一走
`STYLE_RESOURCES` + `loadResource()`。旧代码里的这些调用会得到 `no-undef`，不再有单独的建议规则；
`lint.resource.undeclared-read` 保留为已退役的诊断 id，供历史报告读取。

## 运行时风险

### `warn-risky-runtime-pattern`

提示可能让沙箱长时间无法返回的写法：

- `while (true)`；
- `for (;;)`；
- 循环边界为 100000 及以上的数字字面量；
- 函数直接递归调用自身（包括变量绑定、赋值给变量、对象属性和对象方法中的具名函数、箭头函数）；按作用域身份判断，变量遮蔽与同名成员调用不误报。

Banyan 的沙箱隔离权限，但不能可靠中断同步死循环；这些写法应在样式层避免。

## 条目字段读取

### `warn-item-field-misuse`

在读取名为 `item` 的对象成员时提示：

- 用 Zotero UI 标签读取字段，例如 `item.publication`、`item.accessed`，应改成内部字段名。
- 读取 Banyan 条目不会携带的键，例如 `item.abstractNote`、`item.key`、`item.uri`、`item.relations`。
- 读取宿主私有命名空间键，例如 `item["z:uri"]`。

只检查以 `item` 为接收者的成员读取；`style.version` 之类的其他对象不受影响。

## 注释上下文

### `warn-note-context`

只对 `INFO.citationType` 静态可读且为 `note-citation` 的样式工作。源码中只要静态出现
`noteType`、`"footnote"` 或 `"endnote"`（AST 上的标识符、成员名或字符串字面量），就认为
作者已在处理注释类型，规则保持静默；每个 `messageId` 每份文件最多报告一次。

- 按页分组（`pageGrouping`，`lint.note.page-grouping`）：`Number()` / `str()` /
  `String()` / 一元 `+` 包裹的 `context.page`、`contexts[...].page` 或指向它们的局部别名
  （如 `const context = contexts[i]`）出现在 `===` / `==` / `!==` / `!=` 的一侧，且另一侧
  也是页表达式（包括由页表达式初始化的变量）时报告。尾注的 `page` 恒为 `0`，这种分组会把
  所有尾注当成同一页；应先按 `noteType === "endnote"` 决定尾注的连续编号。
- 字符串页真值判断（`stringPageTruthiness`，`lint.note.page-string`）：由
  `str(<页表达式>)` / `String(<页表达式>)` 初始化的变量被 `if` 或条件表达式直接（或经
  `!`）用作真值判断时报告。`context.page` 字符串化后是 `"0"`，而 `"0"` 为真，缺失页的
  回退分支永远不会触发；应改用 `Number(page) <= 0` 或 `noteType === "endnote"` 判断。

两条检查都只是作者建议：运行时仍会执行样式；静态无法判定时不猜测、不报告。

## 静态判定策略

规则只依据 AST 上可静态判定的字面量工作；无法判定时不猜测：

- 字符串/数字/布尔字面量、无插值模板、计算属性中的字面量键（如 `["book"]`）视为可判定。
- `[variable]` 形式的动态键、变量/表达式默认值视为不可判定：`states`、`ITEM_FIELD_VALIDATORS`、`ITEM_FIELD_PRESETS.fields` 的键报专用诊断；默认值报 `defaultNotInStates` / `valueDefaultInvalid` / `booleanDefaultInvalid`。
- 对象展开（`{ ...common }`）与 getter/setter 属性静默跳过，不展开求值。
- 部分规则比运行时更严，属于 lint 契约而非运行时契约：`ITEM_FIELD_VALIDATORS` 分组不允许为空（运行时把空数组视为通过）、`states` 参数必须显式给出 `defaultValue`（运行时回退到第一个 state key）。这些差异记录在 `CHANGELOG.md`。
- `messageId` 是对外稳定契约，外部工具应依赖它而不是英文文案；新增或改名会记入 `CHANGELOG.md`。

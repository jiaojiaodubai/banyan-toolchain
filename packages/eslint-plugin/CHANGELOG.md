# Changelog

本项目的规则行为记录在这里。包通过完整 commit SHA 分发，版本号只用于阅读和排查。

## 0.1.0

首次发布。

### 架构

- 由 `build.mjs` 产出单个自包含 ESM bundle；Banyan 只复制
  `dist/eslint-plugin-banyan-style.mjs` 与构建元数据。
- 规则消费 `@banyan/style-contract`：上限、保留键、参数键集合、preset 禁用键、
  键规范化和 Zotero/CSL 词表不再由本包手写复制。
- 每条规则消息映射到稳定的 `diagnosticId`（`RULE_MESSAGE_DIAGNOSTICS`）；
  未映射的消息会被测试拒绝。`messageId` 视为稳定契约；外部工具应依赖它而不是英文文案。
- bundle 不导入 `@banyan/core` 或 ESLint 自身；conformance 会检查这一点。

### 新增

- `validate-style-dependencies`：检查 `STYLE_DEPENDENCIES` 的数组形状、字符串
  id、id 格式与唯一性、保留键、自引用与 4 条上限。
- `validate-style-resources`：检查 `STYLE_RESOURCES` 的数组形状、`id` 资产名
  （与运行时共用 `isValidResourceId()`，即 `assets/` 下的文件名）、`json`/`text`
  格式、已移除的 `path`/`validate`、未知键与 8 条上限。
- `readBytes` / `readText` / `readJSON` 不再作为作者全局变量：文件读取只经
  `loadResource()`；`lint.resource.undeclared-read` 保留为已退役的诊断 id。
- 新诊断 id 映射：`dependency.*`、`resource.*`；
  上限溢出沿用运行时的截断语义（lint error）。
- `callStyle` / `loadResource` 作为作者全局变量始终可用，即使宿主使用较旧的
  `styleUtils.d.ts` 也不会误报 `no-undef`。
- `warn-risky-runtime-pattern` 按 ESLint 作用域身份判断直接递归：
  - 支持 `const recur = () => recur()`、赋值目标箭头函数、对象属性/方法与 `this.method()`；
  - 变量遮蔽、同名成员调用（如 `formatter.format()`）不再误报；别名/解构调用按间接递归处理，不报告；
  - 新增 `directRecursion` 的作用域回归矩阵。
- `warn-empty-style-options`：`STYLE_OPTIONS = []` 给出警告。
- `validate-params`：
  - `stateKeyWhitespace`：状态键需要 trim；
  - `stateKeyDuplicate`：trim 后与前面的键冲突；
  - `stateKeyReserved` / `paramIdReserved`：保留键不能作为状态键或参数 id；
  - `stateKeyMustBeStatic`：`states` 的动态计算键无法静态校验；
  - `statesEmpty`：空 `states` 对象单独报告；
  - `tooManyStates` / `tooManyPresets`：静态可确定的上限溢出；
  - `stateDefaultMissing`：声明 `states` 时必须显式提供 `defaultValue`；
  - `defaultNotInStates`：有 `states` 时默认值必须是其中一个键，数字、布尔、
    空字符串、未知键统一报告；
  - `booleanDefaultInvalid`：无 `states` 时默认值必须是布尔字面量。
- `validate-item-field-validators`：`unknownItemType`，按生成的 schema revision
  检查条目类型；空数组分组报告 `groupEmpty`，非数组报告 `groupMustBeArray`；
  `groupKeyMustBeStatic` 要求条目类型键是静态字符串。
- `validate-field-presets` 新增 `fieldKeyMustBeStatic`：`fields` 的动态计算键无法
  静态校验。
- 所有规则补充 `meta.docs.url`，指向 toolchain 仓库
  `packages/eslint-plugin/docs/rules.md` 中对应规则章节。
- `warn-note-context`：`INFO.citationType` 静态为 `note-citation` 时提示尾注场景下的
  页处理问题；源码中出现 `noteType` / `"footnote"` / `"endnote"` 就保持静默，每个
  `messageId` 每份文件最多一条。
  - `pageGrouping`（`lint.note.page-grouping`）：`Number()` / `str()` / `String()` /
    一元 `+` 包裹的 `context.page`、`contexts[...].page` 或指向它们的局部别名出现在
    相等比较两侧。按页分组会把所有尾注（`page` 恒为 `0`）当成同一页。
  - `stringPageTruthiness`（`lint.note.page-string`）：由 `str(<页表达式>)` /
    `String(<页表达式>)` 初始化的变量被用作真值判断。`page` 字符串化后是 `"0"`，
    而 `"0"` 为真，缺失页回退永远不会触发。

### 说明

- 部分检查比 Banyan 运行时更严，属于 lint 契约而非运行时契约：
  - 运行时把空检查器数组视为通过，lint 拒绝空分组；
  - 运行时会回退到 `states` 的第一个键，lint 要求显式默认值。
- 诊断信息中的 `defaultValue` 文本：非字面量默认值使用源码文本。

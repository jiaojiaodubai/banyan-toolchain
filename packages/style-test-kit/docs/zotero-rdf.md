# Zotero RDF 数据格式

TestKit 以 **Zotero RDF**（而非 CSL JSON）作为测试数据格式。字段路由移植自 Zotero
官方 "Zotero RDF" 导出翻译器，并加入 Banyan 扩展。只支持 Zotero RDF，不含
Bibliontology。样式只能看到常规条目：notes 与 collections 不是条目记录（没有
`z:itemType`），解析时忽略；attachments 在文件里是条目记录，`rdf dump` 会显示，
但建库时被跳过（见「与 Zotero 官方导出的兼容面」）。手写测试数据也可以用
[简易 JSON 条目库](item-json.md)。

XML 解析使用 linkedom 的 XML 模式（与 `parseHtml` 能力同一依赖），不再引入第二个
XML 解析器。

## 解析规则

1. **命名空间归一化**：按文档自身的 `xmlns:*` 声明把元素名**与属性名**（
   `r:about`、`r:resource`、`r:parseType`）归一化到规范前缀，别名前缀的文档解析
   结果相同；根元素也接受任意绑定到 RDF 命名空间的前缀；
2. **`z:itemType` 是权威**：条目类型只读 `z:itemType`，与外层元素名
   （`bib:Book` 等）无关；
3. **结构位置**：`dcterms:isPartOf` 指向 `bib:Part`（章节）、容器
   （`bib:Journal`、`bib:Book`…）或 `bib:Series`；Zotero 会把容器挂在章节下、丛书
   挂在容器下，解析递归一层层找；
4. **类可以两写**：`<bib:Journal>` 这类带类型的节点元素、`<rdf:type rdf:resource>`
   属性两种写法等价；
5. **`z:` 兜底**：路由表未覆盖的字段按 `z:<field>` 无损往返（`language`、
   `assignee`、`applicationNumber`、`bookTitle` 等）——这也是 Zotero 导出器自己的
   做法；
6. **`z:key` 扩展**（Banyan）：保留条目 key 供 contexts 引用与稳定快照，
   Zotero 官方导出不含此项；
7. **`z:relation` + `z:predicate` 扩展**（Banyan）：官方导出只表达
   `dc:relation`；`banyan:multilingual` 等谓词用该扩展往返：

   ```xml
   <z:relation>
     <z:predicate>banyan:multilingual</z:predicate>
     <z:object rdf:resource="#item_4"/>
   </z:relation>
   ```

8. **creator 的单名形态**：只有 `foaf:surname`、没有 `foaf:givenName` 的创建者
   还原为 `{ creatorType, name }`（与 `Zotero.Item.toJSON()` 一致，也是
   `creators-ext` 匹配的前提）；有给名 + 姓时还原为 `firstName` + `lastName`；
9. **容器字段回落**：条目类型没有容器时，`publicationTitle`、`volume`、
   ISSN/ISBN/DOI 等容器字段落在条目自身；解析时条目自身与容器两个位置都会读，
   导出时同样回落到条目自身；
10. **重复谓词**：`dc:identifier` 多次出现时按值前缀消歧——`ISSN ` / `ISBN ` /
    `DOI ` 前缀分别对应同名字段，无前缀字面量视为 `accessionNumber`。

## 字段路由

`place` 指出值所在资源；条目类型决定“类型字段”的具体名字（由核心的
`ZOTERO_BASE_FIELD_ALIASES` / `fieldForBase` 解析，例如 bookSection 的容器标题落回
`bookTitle`、report 的出版者落回 `institution`），而“这个类型到底有没有某字段”用核心
的 `isZoteroItemField`（数据来自 `ZOTERO_ITEM_TYPE_FIELDS` 或 `ZOTERO_SCHEMA`，见
[usage.md](usage.md#schema-数据来自核心)）。

| 位置（place） | 谓词                                                                            | 字段                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| item（self）  | `dc:title` / `dc:date` / `dc:description` / `dc:rights` / `dc:source`           | title / date / extra / rights / source                                                                                                                |
| item          | `dc:coverage` / `dcterms:abstract` / `dcterms:dateSubmitted` / `dcterms:issued` | archiveLocation / abstractNote / accessDate / issueDate                                                                                               |
| item          | `bib:pages` / `prism:edition` / `dcterms:medium`                                | pages / edition / 类型的 medium 字段                                                                                                                  |
| item          | `dc:type`                                                                       | 类型的 type 字段（reportType、thesisType、genre…；无则忽略）                                                                                          |
| item          | `dc:identifier`                                                                 | `ISSN`/`ISBN`/`DOI`（带前缀）或 accessionNumber（无前缀）                                                                                             |
| item          | `dc:identifier` → `dcterms:URI` → `rdf:value`                                   | url（term 资源）                                                                                                                                      |
| item          | `dc:subject` → `dcterms:LCC` → `rdf:value`                                      | callNumber（term 资源）                                                                                                                               |
| item          | `dc:subject`（字面量 / `z:AutomaticTag`）                                       | 标签（自动/手动类型不保留）                                                                                                                           |
| container     | `dc:title` / `dcterms:alternative` / `prism:volume`                             | 类型的容器标题（publicationTitle / bookTitle / reporter…）/ journalAbbreviation / volume                                                              |
| container     | `prism:number`                                                                  | 该类型的 number 族字段：issue（期刊/会议论文）、patentNumber（专利），否则按 `number` 基字段解析（reportNumber、docketNumber、billNumber…），无则丢弃 |
| container     | `dc:identifier`                                                                 | `ISSN`/`ISBN`/`DOI`（带前缀）                                                                                                                         |
| series        | `dc:title` / `dcterms:alternative` / `dc:description` / `dc:identifier`         | series / seriesTitle / seriesText / seriesNumber                                                                                                      |
| publisher     | `foaf:name` / `vcard:locality`（经 `vcard:adr` → `vcard:Address`）              | 类型的出版者字段（publisher / institution / label…）/ place                                                                                           |
| conference    | `dc:title`（`bib:presentedAt` → `bib:Conference`）                              | conferenceName                                                                                                                                        |
| 其余          | `z:<field>`                                                                     | 同名字段（兜底）                                                                                                                                      |

## 与 Zotero 官方导出的兼容面

`fixtures/zotero-export.rdf` 按 Zotero 序列化器的真实输出形状手工编写（对照
`zotero/translators/Zotero RDF.js`、`translate/src/rdf/serialize.js` 与 Zotero 仓库
的 `book_and_snapshot.rdf`），用来锁定兼容面：

- **节点形状**：常规条目是带类型的节点元素（`<bib:Article rdf:about="#item_1">`），
  类型未知时退回 `<rdf:Description>`；容器可用 `urn:issn:` 作 `rdf:about`
  （Zotero 在 ISSN 未被别的条目占用时的写法）；条目没有 ISBN 时 Zotero 直接用
  **URL 作 subject**，此时 contexts 用该 URL 引用（`#item_N` 不存在）；
- **creator 列表**：`<bib:authors><rdf:Seq><rdf:li><foaf:Person>`；biblio 命名空间
  只用于 `author`/`editor`/`contributor`，其余是 `z:<creatorType>s`；
- **`z:key`**：官方导出不写；建库时生成确定性的 `TESTKEY<8 位序号>`，contexts 用
  subject（`#item_N`、URL 或 URN）或数字 id 引用即可；
- **非条目资源**：notes（`bib:Memo` + `rdf:value`；子笔记没有 `z:itemType`，独立
  笔记有，两者都不进入测试库）、`z:Collection`（`dcterms:hasPart`）、
  `z:AutomaticTag`、`dcterms:URI`/`dcterms:LCC` term 资源都按真实导出解析；
- **文件元数据**：`z:path`、`z:linkMode`、`link:type`/`link:charset`、`z:displayTitle`
  是记录/文件元数据，不进入字段（`z:displayTitle` 由 Banyan 自己计算显示名）；
- **非正规条目**：`attachment`（含子附件）、`note`、`annotation` 建库时跳过，条目
  id 保持连续，`--items 1,2` 不会因附件出现空洞；`rdf dump` 仍会列出它们，便于
  检查文件内容；
- **节点 id 保留**：`rdf build` 沿用解析出的 subject（`#item_N`/URN/URL），因此
  `dc:relation` 与容器引用不会因重新编号而指向别的条目。

已知的导出器歧义（不是 TestKit 能消除的）：letter/email 有 `dateSent` 时，Zotero
把 `date` 也写成 `dcterms:dateSubmitted`，与 `accessDate` 共用谓词；TestKit 读作
`accessDate`，这类条目请用 `dc:date` 或直接给 `date`。

## fixtures

`fixtures/*.rdf` 大多由 `scripts/gen-fixtures.ts` 从条目模型生成（`pnpm fixtures`），
因此它们一定是导出器可能写出的文档形状；生成器同时写出 `contexts-*.json`。
两份手工维护的文档覆盖生成器不会产生、但真实导出会出现的写法：
`fixtures/aliases.rdf`（别名前缀、`rdf:parseType="Resource"`、显式 `rdf:type`
属性、章节嵌套）与 `fixtures/zotero-export.rdf`（官方导出形状：typed 节点、
`rdf:Seq`/`rdf:li`、blank node 容器/出版者/会议、无 `z:key`，以及附件/笔记/
collection 等非条目资源）。

生成脚本支持一个可选输出目录参数，便于对比改动而不动仓库内的文件：

```sh
pnpm fixtures            # 写入 fixtures/
pnpm fixtures tmp-out    # 写入 tmp-out/
```

## creators-ext

`extra` 中以键值行存储，一行一条 JSON 记录，记录须含 `creatorType` 与完整名字
（`name`，或 `firstName` + `lastName`），扩展字段为 `role` / `nationality` /
`dynasty`：

```
language: zh-CN
creators-ext: {"creatorType":"author","lastName":"王","firstName":"小明","role":"主编"}
```

记录由核心的 `bindCreatorsExt` 校验并绑定到对应 creator；不合规记录不会被绑定，
而是作为 `warning` 进入 `library.diagnostics`（CLI 打到 stderr），便于发现 fixture
里的坏数据。`creators-ext.rdf` 的第三条就是这种情况。

## 局限

- 标签的自动/手动类型不保留；notes、collections 与非正规条目（attachment/note/
  annotation）不进入测试库，附件的文件元数据（`z:path` 等）也不保留；
- Zotero 导出器本身对部分字段是有损的（例如 bookSection 的 `bookTitle` 走
  `z:bookTitle` 兜底；letter/email 的 `dateSent` 与 `accessDate` 共用
  `dcterms:dateSubmitted`），因此“往返一致”指 TestKit 自己的解析/序列化闭环，
  不是 Zotero 无损往返的承诺；
- 手工追加 `z:key` 与 `z:relation` 后，文档即可作为 contexts 的引用目标；
  官方导出没有 `z:key` 时，请用 `#item_N` 节点 id 或数字 id（解析顺序）。

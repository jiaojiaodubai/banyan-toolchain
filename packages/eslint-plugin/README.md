# eslint-plugin-banyan-style

Banyan Style 的 ESLint 规则、作者全局变量与共享 flat-config 工厂。Banyan 插件、Banyan Styles 与 Banyan Style Test Kit 共用这一份实现。

## 安装

本包不单独发布到 npm。它随 `Banyan-Toolchain` 一起构建；工作区内使用
`workspace:*`，宿主按 `toolchain.manifest.json` 获取并校验自包含 bundle。
需要同时安装 peer 依赖与基础规则集：

```sh
pnpm add -D eslint @eslint/js
```

要求 Node ≥ 20、ESLint ≥ 9。

## 使用

```js
// eslint.config.mjs
import js from "@eslint/js";
import { createBanyanStyleConfig } from "eslint-plugin-banyan-style";

const banyan = createBanyanStyleConfig({
  // 存放生成的 styleUtils.d.ts / unit.d.ts 的目录。
  // 插件运行时把 lint 放在 banyan 数据目录，与 typings 同级，因此可省略。
  typingsDir: "docs/ai/typings",
  // STYLE_OPTIONS 告警阈值，默认 12；上限 16。
  warnCount: 8,
});

export default [
  js.configs.recommended,
  {
    ...banyan,
    rules: {
      ...banyan.rules,
      // 各宿主自己的格式规则放在这里。
      indent: ["warn", 2],
    },
  },
];
```

`createBanyanStyleConfig()` 只返回 Banyan 专用片段：作者全局变量（`contexts`、`options`、`console` 和 `styleUtils.d.ts` 中的工具函数）、插件对象以及推荐规则级别。基础规则集、文件范围和额外风格规则由宿主组合。

只想提取工具函数全局变量时：

```js
import { extractStyleUtilsReadonlyGlobals } from "eslint-plugin-banyan-style/globals";

const globals = extractStyleUtilsReadonlyGlobals("docs/ai/typings");
```

## 插件运行时

Banyan 插件不通过 `node_modules` 加载这个包。工具链构建出单个自包含 ESM bundle，宿主把它复制进 addon，再写入 `<Zotero-data-dir>/banyan/`，由用户在该目录安装的 ESLint 执行：

- `dist/eslint-plugin-banyan-style.mjs`
- `dist/build-metadata.json`（版本、contract schema revision、诊断数量）

bundle 已内联 `@banyan/style-contract` 的纯代码和工具函数全局变量提取器，不包含 `@banyan/core` 运行时，也不包含 ESLint 自身。Node 内置模块（`node:fs`、`node:path`、`node:url`）保持外部引用，由宿主提供。

## 开发

```sh
pnpm install
pnpm build        # 生成 dist bundle 和类型声明
pnpm lint
pnpm test         # 源码测试，覆盖规则、配置工厂和全局变量提取
pnpm pack:check
```

测试覆盖规则行为、共享配置工厂、全局变量提取和诊断映射；工具链 CI 在 Node 22.18 与 ESLint 9/10 下运行。

## 升级与回滚

消费方不再固定本包的 GitHub SHA。`Banyan` 与 `banyan-styles` 各自维护一个
`toolchain.lock.json`，指向 toolchain revision；本地开发用 `link:`，CI 用
`toolchain.manifest.json` 中列出的 bundle 和 SHA-256。回滚时把整个 toolchain
revision 改回上一个，重新生成 addon 资产，而不是只改本包版本。

## 文档

- [规则清单](docs/rules.md)
- [变更记录](CHANGELOG.md)

## 许可

AGPL-3.0-or-later。

# 安全与资源边界

样式可能来自 AI 生成或第三方。TestKit 对“运行不可信样式”的承诺分为两层：
`node:vm` 只负责**正确性**，资源与算力边界由运行器（`run --isolated`）负责。

## `node:vm` 是正确性边界，不是安全边界

`node:vm` 隔离原型链（样式代码摸不到宿主对象与宿主函数的原型），**不隔离**算力与
数据：

- 样式可以消耗任意 CPU / 内存 / 事件循环（`readFile` 等能力都是异步回调）；
- 数据通过 JSON 跨界，不是深度防御；二进制值用 realm 内的构造器重建，保证类型正确，
  同样不是隔离手段；
- 同步执行在设置运行器的 `timeoutMs`（CLI `--timeout`）或核的
  `evaluateTimeoutMs` 时有 `evaluate` 级别预算；默认不设，因为进程内模式面向
  可信样式。异步挂起由核的 `withGenerateTimeout` 兜底（15 分钟）。

因此：**默认（进程内）模式适用于本地、可信样式的作者自测**，不适用于来路不明的
样式。

## 进程内模式的能力边界

- `eval` / `new Function` 默认禁用
  （`vm.createContext({ codeGeneration: { strings: false } })`），与 Gecko 宿主
  运行时不同；
- `readFile`（沙箱内 `readBytes` / `readText` / `readJSON`）白名单限定在
  `--style-dir`：绝对路径允许但必须落在目录内；含 `..` 段的路径直接拒绝；
  符号链接拒绝；单文件默认 16 MiB 上限；`decompress` 先解压再应用
  `offset`/`maxBytes` 窗口；
- 无网络、无宿主密钥：能力集只有 `parseHtml` / `readFile` /
  `resolveMultilingualItems`，样式触碰不到 Node API（只能经由核注入的工具函数）；
- 文件访问白名单是**正确性**约束（路径解析层拒绝），不是沙箱逃逸防护。

## 隔离模式：`run --isolated`

不可信样式应使用隔离模式。样式在**独立子进程**（`child_process.fork`）中运行，
调用方（CLI）施加：

| 限制     | 实现                                                                          | 默认值     |
| -------- | ----------------------------------------------------------------------------- | ---------- |
| 墙钟     | 到点 `child.kill("SIGKILL")`（能打断同步死循环）                              | 30 s       |
| 内存     | 子进程启动参数 `--max-old-space-size`；V8 报 "out of memory" 时归类为内存超限 | 256 MiB    |
| 输出体积 | 子进程内先量 `JSON.stringify` 字节数，超限即失败，不回传                      | 4 MiB      |
| 文件     | 仍只有 `readFile` 能力，且只读 `--style-dir`                                  | 只读白名单 |
| 网络     | 沙箱内无 `require`/`fetch`；子进程只加载测试工具自身                          | 无         |

```sh
pnpm cli run --isolated --timeout 10000 --memory 256 --max-output 4194304 ...
```

失败以结构化错误返回（`generate-timeout` / `generate-output` / `generate`），
不会挂起等待。子进程继承父进程的 `execArgv`，所以启动 CLI 的那个加载器（正常使用
时是 tsx）也会启动子进程，不需要第二套加载器。

**隔离模式不提供的**：系统调用级沙箱（子进程与父进程共享内核与文件系统权限）、
对子进程 CPU 用量的计量。样式是 JS 且在 vm 上下文里，触不到 `fs`/`net`，但若需要
更强的隔离（例如限制可用系统调用），请在容器/虚拟机里运行本工具。

## 快照与数据卫生

- 快照是渲染结果（数据），已通过 `.prettierignore` 排除在格式化之外；
- 快照键序、行尾（LF）、空白均归一化，格式化工具不会造成假差异；
- 快照只守护核心默认渲染实现的输出稳定，不是跨宿主契约。

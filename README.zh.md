# DSH Tool Config Studio

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的**捆绑包（bundle）插件**，把工具目录和系统设置文档都变成配置面板：**浏览所有已注册工具或系统插件，点击任意一项展开并修改它的配置，改错了——一键恢复默认。** 可从 DSH 的插件页直接安装，并在侧边栏增加两个面板：*工具配置中心*（工具默认值）与 *系统插件中心*（模型适配器、默认模型，以及所有开放了可实时编辑参数的插件）。

## 为什么需要它

DSH 的每个工具都有参数，其中相当一部分带有可调节的"存储默认值"：`read` 默认读多少行、`pwsh` 任务是否后台运行、`list_agents` 默认查看哪一层、`job_output` 是否等待、定时任务的最小间隔……在此之前，要发现或修改这些默认值，只能翻源码或改 profile 补丁。Tool Config Studio 给每个工具提供一个正经的配置页面，更重要的是——**任何改动都可以撤销**。

系统侧的参数则更难被发现：模型适配器（`llm-pi-ai` 的 providers 与 models）、当前档案的 `llm-deepseek` 适配器、生效的 `agent-default-model`，都藏在 profile 的设置文档里，以往只能手写 YAML 修改。**系统插件中心**面板实时读取该文档，为每个插件开放为"volatile（按档案可编辑）"的参数渲染表单，并经由宿主写回——与工具侧同样"先暂存、后提交"，同样支持一键恢复。

## 功能

- **完整工具目录** — 全部 31 个已注册工具，按 11 个类别分组，每个工具都有描述和完整的参数参考（类型、是否必填、默认值、枚举、最小值）。
- **修改存储默认值** — 展开任意工具即可修改其可配置参数：带最小值的数字、布尔、自由文本字符串、枚举下拉。
- **启用 / 禁用** — 用开关切换工具的可用性。
- **行内校验** — 每个值在落盘前都会按目录规则校验（类型、枚举成员、最小值下限）。非法值绝不写入存储，错误直接显示在字段旁边。
- **分层恢复** — 重置单个参数、把整个工具恢复出厂、或**恢复全部默认**（带确认弹窗）。存储只保存"与目录的偏离"，因此恢复就是编辑的严格逆操作，绝不会误伤其他配置。
- **系统插件中心面板** — 第二个侧边栏/主面板，实时扫描 DSH 设置文档，为每个开放"volatile（按档案可编辑）"参数的系统插件（模型适配器、默认模型等）渲染由 schema 驱动的表单：字典、数组、枚举、布尔、数字、JSON、只读字面量、脱敏机密值各有对应控件。
- **系统参数暂存编辑** — 系统侧改动先按条目暂存、并实时应用到"工作值"（增/删项在保存前即可见）；提交时携带版本号调用 `mutate`，宿主推送 `settings/document-updated` 时自动重新读取。
- **系统一键恢复** — 单字段"重置"（`unset` 回退到 schema 默认值）与整条目"恢复默认"（`replace` 空节），均带确认弹窗。宿主在你的覆盖之下保留系统默认值，因此恢复是精确的。
- **持久化** — 工具侧改动通过 `localStorage`（键 `dsh-tool-config-studio.v1`）在刷新后保留；无存储环境自动降级为内存模式，不报错。系统侧改动直接写入 profile 设置文档（没有额外的本地缓存）。
- **国际化** — 中文与英文，自动检测（`navigator.language`，Node 下用 `LANG`），挂载时可覆盖。
- **零运行时依赖** — 源码为纯 ESM；DSH 浏览器端是一个零依赖构建产物（传统 script，无需 ESM 加载器）。任何现代浏览器可运行；测试与演示服务器要求 Node ≥ 22。

## 快速开始

### 在 DSH 中安装（桌面版或 Web 版）

本包是一个 **DSH 捆绑包（bundle）**，从插件页安装：

1. 打开 DSH 侧边栏的**插件（Plugins）** → **添加插件（Add plugin）**。
2. 粘贴仓库地址：`https://github.com/yqd-coder/dsh-tool-config-studio.git`
3. 确认。插件管理器会拉取仓库、安装到当前 profile 并启用捆绑包——侧边栏出现**工具配置中心**入口，插件列表中可见该捆绑包（可开关）。

卸载或关闭捆绑包会移除面板；已保存的配置（localStorage）不受影响。

### 运行演示（无需 DSH）

```sh
git clone https://github.com/yqd-coder/dsh-tool-config-studio.git
cd dsh-tool-config-studio
npm run demo
# → http://localhost:4173/demo/
```

演示页直接加载真实的插件源码，因此必须通过 `http://` 提供（`file://` 下无法使用 ES import attributes）。`npm run demo` 会启动内置的零依赖静态服务器；可用 `PORT` 环境变量换端口。

### 运行测试

```sh
npm test
```

使用 Node 内置测试运行器（`node --test test/`）——无框架、无需安装。83 个测试覆盖目录完整性、状态机、校验、持久化、两个面板的端到端 UI 冒烟测试、系统侧 schema/store/app 单元测试，以及已构建 DSH 捆绑包的加载器契约——包括"模块卸载后 `apply` 可重跑"（原位更新插件时宿主的行为）。

### 嵌入到自己的 Web 应用

```js
import { mountToolConfigStudio } from "dsh-tool-config-studio/src/client.js";

const handle = mountToolConfigStudio(document.getElementById("app"));
// ...
handle.unmount();
```

选项：`{ store, persistence, i18n, language }` —— 均可注入，便于测试或自定义宿主（见 [docs/architecture.md](docs/architecture.md)）。

> `dsh-tool-config-studio/client` 是**已构建的 DSH 模块捆绑包**（供 DSH 加载器使用的浏览器传统 script，不能直接 `import`）。自定义宿主请使用 `/src/client.js` 的 ESM 源码。

### DSH 捆绑包的接线方式

| 文件 | 作用 |
| --- | --- |
| `cordis.patch.yml` | 捆绑包补丁：插入一行，`tool-config-studio`，以本包命名 |
| `package.json` | `dsh.bundle.patch` + `dsh.client`（web 平台）、入口 `exports` 映射 |
| `lib/client.js` | 已构建的浏览器模块捆绑包——向 `window.__ModuleLoader__` 注册、注入 CSS、提供 `apply(ctx)` |
| `lib/index.js` | 宿主加载入口（纯浏览器插件 → 空 `apply()`） |
| `locale/{en,zh}.json` | 界面文案字典（另含捆绑包卡片 `meta.title`） |

该行的浏览器端由 DSH 客户端模块系统加载：捆绑包惰性物化，通过 `ctx.slots` 注册侧边栏面板与主面板，并挂载与演示页相同的 `mountToolConfigStudio` 界面。完整模块契约见 [docs/architecture.md](docs/architecture.md)。

## 30 秒理解配置模型

1. **目录**（`src/core/catalog.json`）是唯一事实来源：所有工具、参数、类型、默认值、枚举、最小值。
2. **状态机只存覆盖值（override）** —— 只有与目录默认值不同的值才会被保存；生效值 = `override ?? 默认值`。
3. **恢复 = 删除** —— "重置"、"恢复此工具"、"恢复全部"都只是删掉覆盖值，即编辑的严格逆操作。

完整规范（含存储文档格式与校验错误码）见 [docs/configuration-model.md](docs/configuration-model.md)。

### 30 秒理解系统模型

1. **宿主拥有设置文档** —— 一棵分层树：系统默认值位于你的档案覆盖之下；`describe()` 报告生效值、基础值、覆盖值、schema 与文档版本号。
2. **只有 volatile 字段可编辑** —— 一个 schema 字段只有在该插件把它标记为"对当前档案可实时编辑"时才会出现在面板里；这是宿主划定的"安全可调"与"部署级"的界线。
3. **编辑是对版本号的 op** —— 面板先在本地暂存，再携带所读版本号提交 `mutate`（set/unset）或 `replace`（恢复）；版本过期会被拒绝，面板随后重新读取。

> **系统插件中心改不到的东西。** `dsh-persona`、`dsh-system-prompt`、`dsh-agent-instructions` 三个插件暴露了 **0 个** volatile 字段，因此人格（persona）、系统提示词与智能体指令在该面板中**不可见、不可编辑**——它们属于部署级设置。面板会显示相应说明，而不是假装能改。

## 目录结构

```
├── build/           client.mjs —— 零依赖构建 DSH 浏览器捆绑包
├── cordis.patch.yml 捆绑包补丁（行：tool-config-studio）
├── demo/            独立演示页 + 零依赖静态服务器
├── docs/            architecture.md、configuration-model.md
├── lib/             index.js 宿主垫片 + client.js 已构建的 DSH 模块捆绑包
├── locale/          en.json、zh.json 界面字典
├── src/
│   ├── client.js    客户端入口：mountToolConfigStudio + mountSystemPluginStudio + 完整公开 API
│   ├── index.js     宿主入口（纯浏览器 → 空操作）
│   ├── core/        catalog、store、validate、persistence —— 无 DOM、纯逻辑
│   ├── system/      schema（schemastery 展开）、store（暂存编辑）、app（DOM 控制器）
│   └── ui/          i18n、render（纯 DOM 构造器）、app（控制器）、styles.css
└── test/            node --test 测试套件（含 DOM 冒烟测试与捆绑包契约测试）
```

## API 一览

| 导出（来自 `/src/client.js`） | 用途 |
| --- | --- |
| `mountToolConfigStudio(container, options?)` | 挂载工具面板界面；返回 `{ store, app, unmount }` |
| `mountSystemPluginStudio(container, options?)` | 挂载系统插件中心界面；选项 `{ adapter, i18n?, language? }`，返回 `{ store, unmount }` |
| `ToolConfigStore` | 只存覆盖值的状态机（`setParam`、`setEnabled`、`restoreTool`、`restoreAll`、`toJSON`、`fromJSON`、`subscribe`） |
| `SystemPluginStore(adapter)` | 基于设置远端的暂存编辑状态机（`stageSet`、`stageUnset`、`save`、`restoreAll`、`subscribe`） |
| `buildFormTree(schema, value)`、`describeLeaf(node)`、`parseLeaf(leafType, text)`、`applyOpsToValue(value, ops)` | schemastery 展开与叶子（反）序列化辅助函数 |
| `createLocalPersistence(storage?, key?)` | 基于 localStorage 的持久化，失败时安全降级 |
| `createI18n(language?)` / `detectLanguage()` | 界面翻译包 / 语言检测 |
| `createToolConfigApp({ root, store, i18n })` | DOM 控制器，可脱离 `mountToolConfigStudio` 使用 |
| `validateParamValue(param, value)` / `validateOverride(tool, param, value)` | 带稳定错误码的校验谓词 |
| `listTools()`、`listCategories()`、`getTool(name)`、`getParameter(tool, param)`、… | 目录访问器 |

完整 JSDoc 随源码提供（ESM、无构建——源码即发布物）。

## 文档

- [docs/architecture.md](docs/architecture.md) — 分层、数据流与设计决策
- [docs/configuration-model.md](docs/configuration-model.md) — 目录模式、校验规则、存储格式、版本策略
- [CONTRIBUTING.md](CONTRIBUTING.md) — 贡献指南（含"如何向目录添加新工具"）
- [CHANGELOG.md](CHANGELOG.md) — 发布历史

## 许可证

[MIT](LICENSE) © yqd-coder

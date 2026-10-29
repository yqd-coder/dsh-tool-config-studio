# DSH Tool Config Studio

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的**捆绑包（bundle）插件**，把工具目录变成一个配置面板：**浏览所有已注册工具，点击任意工具展开并修改它的配置，改错了——一键恢复默认。** 可从 DSH 的插件页直接安装，并在侧边栏增加 *工具配置中心* 面板。

## 为什么需要它

DSH 的每个工具都有参数，其中相当一部分带有可调节的"存储默认值"：`read` 默认读多少行、`pwsh` 任务是否后台运行、`list_agents` 默认查看哪一层、`job_output` 是否等待、定时任务的最小间隔……在此之前，要发现或修改这些默认值，只能翻源码或改 profile 补丁。Tool Config Studio 给每个工具提供一个正经的配置页面，更重要的是——**任何改动都可以撤销**。

## 功能

- **完整工具目录** — 全部 31 个已注册工具，按 11 个类别分组，每个工具都有描述和完整的参数参考（类型、是否必填、默认值、枚举、最小值）。
- **修改存储默认值** — 展开任意工具即可修改其可配置参数：带最小值的数字、布尔、自由文本字符串、枚举下拉。
- **启用 / 禁用** — 用开关切换工具的可用性。
- **行内校验** — 每个值在落盘前都会按目录规则校验（类型、枚举成员、最小值下限）。非法值绝不写入存储，错误直接显示在字段旁边。
- **分层恢复** — 重置单个参数、把整个工具恢复出厂、或**恢复全部默认**（带确认弹窗）。存储只保存"与目录的偏离"，因此恢复就是编辑的严格逆操作，绝不会误伤其他配置。
- **持久化** — 改动通过 `localStorage`（键 `dsh-tool-config-studio.v1`）在刷新后保留；无存储环境自动降级为内存模式，不报错。
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

使用 Node 内置测试运行器（`node --test test/`）——无框架、无需安装。40 个测试覆盖目录完整性、状态机、校验、持久化、端到端 UI 冒烟测试，以及已构建 DSH 捆绑包的加载器契约。

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

## 目录结构

```
├── build/           client.mjs —— 零依赖构建 DSH 浏览器捆绑包
├── cordis.patch.yml 捆绑包补丁（行：tool-config-studio）
├── demo/            独立演示页 + 零依赖静态服务器
├── docs/            architecture.md、configuration-model.md
├── lib/             index.js 宿主垫片 + client.js 已构建的 DSH 模块捆绑包
├── locale/          en.json、zh.json 界面字典
├── src/
│   ├── client.js    客户端入口：mountToolConfigStudio + 完整公开 API
│   ├── index.js     宿主入口（纯浏览器 → 空操作）
│   ├── core/        catalog、store、validate、persistence —— 无 DOM、纯逻辑
│   └── ui/          i18n、render（纯 DOM 构造器）、app（控制器）、styles.css
└── test/            node --test 测试套件（含 DOM 冒烟测试与捆绑包契约测试）
```

## API 一览

| 导出（来自 `/src/client.js`） | 用途 |
| --- | --- |
| `mountToolConfigStudio(container, options?)` | 挂载整个界面；返回 `{ store, app, unmount }` |
| `ToolConfigStore` | 只存覆盖值的状态机（`setParam`、`setEnabled`、`restoreTool`、`restoreAll`、`toJSON`、`fromJSON`、`subscribe`） |
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

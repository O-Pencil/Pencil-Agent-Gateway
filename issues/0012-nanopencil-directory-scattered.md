# `.nanopencil/` 目录在多个项目目录下重复创建

## 问题描述

在完成 Gateway 配置 Agent 实例 + editor 安装 NANOPENCIL 后，发现多个项目目录下都出现了 `.nanopencil/` 子目录：

```bash
$ find /d/Projects/Pencil -maxdepth 3 -name ".nanopencil" -type d
./.nanopencil                    # Pencil 父仓库
./nanoPencil/.nanopencil        # nanoPencil 项目
./nanopencil-editor/.nanopencil # nanopencil-editor 项目
./Pencil-Agent-Gateway/.nanopencil # Pencil-Agent-Gateway 项目
```

每个 `.nanopencil/` 目录包含相同的内容：

```
.nanopencil/
├── browser-workspace/
│   └── (浏览器自动化工作区)
└── link-world-workspace/
    └── (联网搜索工作区)
```

## 复现场景

1. 在 `Pencil-Agent-Gateway` 项目目录下执行 `nanopencil /login`
2. 在 `nanopencil-editor` 项目目录下执行 `nanopencil /login`
3. 在 nanoPencil 父目录下执行 nanopencil 相关命令

结果：每个项目目录都创建了独立的 `.nanopencil/` 子目录。

## 预期行为

`.nanopencil/` 目录应该只存在于全局统一位置：

```
~/.nanopencil/           # 全局统一位置
├── agent/               # CLI 认证和配置
├── browser-workspace/   # 浏览器自动化工作区
├── link-world-workspace/ # 联网搜索工作区
└── ...其他数据
```

## 根因分析

`nano-pencil` CLI 使用当前工作目录（CWD）来定位 `.nanopencil/` 目录，而不是使用全局固定位置 `~/.nanopencil/`。

查看 nanopencil CLI 入口：

```bash
# which nanopencil
#!/bin/sh
exec node "$basedir/node_modules/@pencil-agent/nano-pencil/dist/cli.js" "$@"
```

CLI 在初始化时检查当前目录是否存在 `.nanopencil/`，如果不存在则创建，而不是回退到 `~/.nanopencil/`。

## 影响

| 问题 | 影响程度 |
|------|----------|
| 磁盘空间浪费 | 每个项目 ~100KB，但随时间增长 |
| 配置不一致 | 每个项目有独立的 browser/link-world workspace |
| .gitignore 污染 | 需要在每个项目添加 `.nanopencil/` |
| 工作区状态丢失 | 在项目 A 配置的浏览器状态在项目 B 不可见 |

## 解决方案建议

### 方案 A：CLI 优先使用 `~/.nanopencil/`（推荐）

修改 nano-pencil CLI 逻辑：

1. 优先检查 `~/.nanopencil/` 是否存在
2. 如果不存在，创建全局目录
3. 当前目录 `.nanopencil/` 仅作为向后兼容或显式指定 `--local` 时使用

### 方案 B：添加 `--global` / `--local` 标志

```
nanopencil /login --global    # 使用 ~/.nanopencil/
nanopencil /login --local     # 使用 ./.nanopencil/
nanopencil /login             # 默认行为：优先 global，回退 local
```

### 方案 C：环境变量配置

```bash
export NANOPENCIL_HOME=~/.nanopencil
nanopencil /login
```

## 参考信息

- `~/.nanopencil/agent/` 已存在且正确存储全局配置
- 问题主要是 `browser-workspace` 和 `link-world-workspace` 的位置

## 状态

**发现日期**：2026-05-03
**相关项目**：nanoPencil, Pencil-Agent-Gateway, nanopencil-editor
**优先级**：低（不影响功能，但影响用户体验）
**标签**：configuration, workspace, CLI

---

*This is an AI-generated issue based on observed behavior*

# 小鱼 Ai 短剧生成系统 v0.01

当前 `main` 面向 Docker 开发测试，不再维护 EXE 打包流程。

## 源码结构

- `base/XiaoyuDrama-Core`：锁定的 Toonflow Core 基线。
- `base/XiaoyuDrama-Web`：锁定的 Toonflow Web 基线。
- `XiaoyuDrama-Core/`、`XiaoyuDrama-Web/`：当前小鱼关键业务源码，便于直接审查。
- `docker/patchkit/`：P8.7 完整产品补丁载荷（复用仓库既有 Git 对象）。Docker 构建时先重建 P8.7，再用 `XiaoyuDrama-Core/`、`XiaoyuDrama-Web/` 中的最新修复覆盖。

## Docker 测试

```bash
git clone --recurse-submodules https://github.com/jack3079/XYAI-Duanju.git
cd XYAI-Duanju
docker compose up --build
```

- Web: `http://localhost:50188`
- API: `http://localhost:10588/api`
- Health: `http://localhost:10588/healthz`

## v0.01 当前修复

- 小鱼智算中心改为普通可选 Provider，不再覆盖用户 Agent/图片/视频模型配置。
- 用户可以自行新增 AI Provider、API Key/Base URL 和模型，并分别配置文本 Agent、图片模型、视频模型。
- 修复旧数据库字段缺失导致的新建项目失败；新增/编辑项目会先执行本地 schema 迁移。
- 修复旧浏览器后端地址缺少 `/api`、远程 Docker 主机 Socket 仍连接 localhost 等问题。
- 修复 Provider 单项故障误删用户配置、模型列表单个 Provider 失败拖垮全部列表的问题。
- 修复 `agentUseMode` 旧库保存成功但实际未写入、子 Agent 配置缺失导致 AI 路由空指针的问题。
- Docker 持久化只保存运行数据，不再覆盖镜像内置 Provider/Skill/Prompt 资源。

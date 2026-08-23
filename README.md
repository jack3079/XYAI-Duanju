# 小鱼 Ai 短剧生成系统 v0.01

Docker 测试版源码。仓库保留小鱼实际修改源码与固定 P8.7 patchkit；Docker 构建时自动拉取锁定的 Toonflow Core/Web 上游提交并叠加小鱼修改，不依赖 Git submodule。

## 当前重点

- 用户可自行配置 AI Provider、API Key、Base URL、文本/图片/视频模型。
- 小鱼智算中心为可选 Provider，不覆盖 Agent 或项目模型。
- 修复旧数据库新增项目失败、Provider 容错、Docker 数据持久化、远程 API/Socket/OSS 访问。
- Docker 数据保存在 named volume `xiaoyu-data`。

## 启动

```bash
git clone https://github.com/jack3079/XYAI-Duanju.git
cd XYAI-Duanju
docker compose up --build
```

访问：

- Web: `http://服务器IP:50188`
- API: `http://服务器IP:10588/api`
- Health: `http://服务器IP:10588/healthz`

如需国内 Git 镜像，可通过 Docker build args 覆盖 `CORE_REPO` / `WEB_REPO`，但必须保持 `CORE_COMMIT` / `WEB_COMMIT` 为仓库锁定提交。

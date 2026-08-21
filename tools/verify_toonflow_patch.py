from __future__ import annotations

import argparse
import json
from pathlib import Path

REQUIRED_APP = [
    "src/xiaoyu/brand.ts",
    "src/xiaoyu/bootstrap.ts",
    "src/xiaoyu/computeCenterClient.ts",
    "src/xiaoyu/secureCredential.ts",
    "src/xiaoyu/runtimeContext.ts",
    "src/xiaoyu/routes.ts",
    "src/xiaoyu/pipeline/types.ts",
    "src/xiaoyu/pipeline/graph.ts",
    "src/xiaoyu/pipeline/repository.ts",
    "src/xiaoyu/pipeline/executors.ts",
    "src/xiaoyu/pipeline/service.ts",
    "src/xiaoyu/pipeline/routes.ts",
    "src/xiaoyu/pipeline/ffmpeg.ts",
    "data/vendor/xiaoyu_compute_center.ts",
    "data/xiaoyu-patch-manifest.json",
]
REQUIRED_WEB = [
    "src/views/xiaoyu/index.vue",
    "src/views/xiaoyu/pipeline/index.vue",
]
PATCHED_APP = [
    "src/app.ts",
    "src/utils/vm.ts",
    "src/utils/ai.ts",
    "src/lib/fixDB.ts",
    "src/types/database.d.ts",
    "src/routes/project/addProject.ts",
    "src/routes/project/editProject.ts",
    "src/socket/routes/scriptAgent.ts",
    "src/socket/routes/productionAgent.ts",
    "package.json",
    "electron-builder.yml",
]
PATCHED_WEB = [
    "src/router/index.ts",
    "src/pages/workbench/index.vue",
    "src/views/project/components/projectDialog.vue",
    "src/views/project/index.vue",
    "src/stores/project.ts",
]


def require_files(root: Path, files: list[str], errors: list[str]) -> None:
    for relative in files:
        path = root / relative
        if not path.is_file() or path.stat().st_size == 0:
            errors.append(f"缺少或为空：{path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-root", required=True)
    parser.add_argument("--web-root", required=True)
    parser.add_argument("--require-ffmpeg", action="store_true")
    args = parser.parse_args()
    app = Path(args.app_root).resolve()
    web = Path(args.web_root).resolve()
    errors: list[str] = []
    require_files(app, REQUIRED_APP + PATCHED_APP, errors)
    require_files(web, REQUIRED_WEB + PATCHED_WEB, errors)

    for relative in PATCHED_APP:
        path = app / relative
        if path.exists() and "XIAOYU_P4" not in path.read_text("utf-8", errors="ignore"):
            errors.append(f"缺少 P4 补丁标记：{path}")
    for relative in PATCHED_WEB:
        path = web / relative
        if path.exists() and "XIAOYU_P4" not in path.read_text("utf-8", errors="ignore"):
            errors.append(f"缺少 P4 补丁标记：{path}")

    managed_paths = [app / relative for relative in REQUIRED_APP + PATCHED_APP] + [web / relative for relative in REQUIRED_WEB + PATCHED_WEB]
    all_text = "\n".join(path.read_text("utf-8", errors="ignore") for path in managed_paths if path.is_file())
    for forbidden in ["__XIAOYU_COMPUTE_CENTER_URL__", "Math.random()", "Date.now()}_idempotency"]:
        if forbidden in all_text:
            errors.append(f"检测到未完成或不稳定实现：{forbidden}")
    for required in [
        "AsyncLocalStorage",
        "o_xiaoyuPipelineRun",
        "o_xiaoyuPipelineNode",
        "o_xiaoyuPipelineEvent",
        "composeRoughCut",
        "estimateProduction",
        "echo169369",
    ]:
        if required not in all_text:
            errors.append(f"缺少关键生产能力：{required}")

    if args.require_ffmpeg:
        runtime = app / "data" / "runtime" / "ffmpeg"
        for filename in ["ffmpeg.exe", "ffprobe.exe"]:
            path = runtime / filename
            if not path.is_file() or path.stat().st_size < 1_000_000:
                errors.append(f"发行包缺少有效的 {filename}")

    result = {"ok": not errors, "errors": errors, "appRoot": str(app), "webRoot": str(web)}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

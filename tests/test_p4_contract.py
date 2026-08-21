from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text("utf-8")


def load_patcher():
    spec = importlib.util.spec_from_file_location("patcher", ROOT / "tools/apply_toonflow_patch.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_stage_graph_is_complete_and_ordered():
    graph = read("toonflow-overlay/app/src/xiaoyu/pipeline/graph.ts")
    expected = ["preflight", "extract_assets", "asset_prompts", "asset_images", "storyboards", "storyboard_images", "video_prompts", "videos", "rough_cut"]
    positions = [graph.index(f'key: "{stage}"') for stage in expected]
    assert positions == sorted(positions)
    assert "dependsOn" in graph and "getPipelineRange" in graph


def test_pipeline_is_persistent_and_resumable():
    repository = read("toonflow-overlay/app/src/xiaoyu/pipeline/repository.ts")
    service = read("toonflow-overlay/app/src/xiaoyu/pipeline/service.ts")
    for table in ["o_xiaoyuPipelineRun", "o_xiaoyuPipelineNode", "o_xiaoyuPipelineEvent"]:
        assert table in repository
    for operation in ["requestPause", "requestCancel", "resume", "resetFromStage", "recoverInterruptedRuns"]:
        assert operation in repository
    assert "setPipelineStage" not in service
    assert "PipelinePauseSignal" in service and "PipelineCancelSignal" in service
    assert "runWithXiaoyuContext" in service


def test_paid_calls_use_stable_idempotency():
    vendor = read("toonflow-overlay/app/data/vendor/xiaoyu_compute_center.ts")
    assert "sha256" in vendor
    assert "stableIdempotencyKey" in vendor
    assert "nextXiaoyuCallIdentity" in vendor
    assert "Math.random" not in vendor
    assert "Date.now" not in vendor
    assert "attempt: context.attempt" in vendor


def test_cross_project_context_is_async_local():
    runtime = read("toonflow-overlay/app/src/xiaoyu/runtimeContext.ts")
    assert "AsyncLocalStorage" in runtime
    assert "qualityMode" in runtime and "policyVersion" in runtime
    assert "projectRef" in runtime and "pipelineRunId" in runtime
    assert "attempt" in runtime


def test_rough_cut_is_real_ffmpeg_execution():
    ffmpeg = read("toonflow-overlay/app/src/xiaoyu/pipeline/ffmpeg.ts")
    assert "spawn(" in ffmpeg
    assert "libx264" in ffmpeg and "aac" in ffmpeg
    assert "concat" in ffmpeg and "ffprobe" in ffmpeg
    assert "writeFile" in ffmpeg and "rename" in ffmpeg


def test_build_is_locked_and_fail_closed():
    build = read("Build_Xiaoyu_Drama.ps1")
    auto = read("Build_Xiaoyu_Drama_Auto.ps1")
    assert "Apply_Xiaoyu_P4.ps1" in build
    assert "verify_toonflow_patch.py" in build
    assert "--frozen-lockfile" in build
    assert "electron-builder --win --x64" in build
    assert "ffmpeg.exe" in build and "ffprobe.exe" in build
    assert "bc61ec7a1b5df31293b286981a5f4ad4635464ee" in auto
    assert "9c4cb0ec7d4f6b4067c7768e2df8cdc7f8587214" in auto


def test_patcher_rejects_remote_http_and_accepts_local_http():
    patcher = load_patcher()
    assert patcher.validate_url("http://127.0.0.1:8000") == "http://127.0.0.1:8000"
    assert patcher.validate_url("https://compute.example.com/") == "https://compute.example.com"
    try:
        patcher.validate_url("http://compute.example.com")
    except RuntimeError:
        pass
    else:
        raise AssertionError("remote HTTP must be rejected")


def test_support_wechat_is_consistent():
    files = [
        "README.md",
        "START_HERE.txt",
        "toonflow-overlay/app/src/xiaoyu/brand.ts",
        "toonflow-overlay/app/src/xiaoyu/routes.ts",
        "toonflow-overlay/web/src/views/xiaoyu/pipeline/index.vue",
    ]
    for file in files:
        content = read(file)
        assert "echo169369" in content or "XIAOYU_BRAND.supportWechat" in content

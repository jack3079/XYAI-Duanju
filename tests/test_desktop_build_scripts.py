from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(relative: str) -> str:
    return (ROOT / relative).read_text("utf-8")


def test_desktop_build_chain_is_locked_and_fail_closed():
    build = read("Build_Xiaoyu_Drama.ps1")
    auto = read("Build_Xiaoyu_Drama_Auto.ps1")
    cmd = read("Build_Xiaoyu_Drama_Auto.cmd")
    assert "Node.js 22+ x64" in build
    assert "Yarn 1.x" in build
    assert "install --frozen-lockfile" in build
    assert "type-check" in build
    assert "yarn.Source lint" in build
    assert "electron-builder --win --x64" in build
    assert "setup.exe" in build
    assert "Apply_Xiaoyu_P4.ps1" in build
    assert "verify_toonflow_patch.py" in build
    assert "ffmpeg.exe" in build and "ffprobe.exe" in build
    assert "bc61ec7a1b5df31293b286981a5f4ad4635464ee" in auto
    assert "9c4cb0ec7d4f6b4067c7768e2df8cdc7f8587214" in auto
    assert "ExecutionPolicy Bypass" in cmd

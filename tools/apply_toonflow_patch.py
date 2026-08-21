from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse

APP_COMMIT = "bc61ec7a1b5df31293b286981a5f4ad4635464ee"
WEB_COMMIT = "9c4cb0ec7d4f6b4067c7768e2df8cdc7f8587214"
MARKER = "XIAOYU_P4"

EXPECTED_BLOBS = {
    "app:src/app.ts": "5728cbedbf294f2163b23bf680c55e9187a9fc70",
    "app:src/utils/vm.ts": "9c435ffedad802f9bd8e6d230c399351b9cced2f",
    "app:src/utils/ai.ts": "14cc4fa3ac51ad7933a1587b355edd4d009a812a",
    "app:src/lib/fixDB.ts": "694291e12678cb3556a78f5fd7e54dcdf3b2987a",
    "app:src/types/database.d.ts": "2d7ccbb79849687b21ad1bbe36103ac7c74ee036",
    "app:src/routes/project/addProject.ts": "93a6991ff4b26153980a2f53a5fc664ae6794b34",
    "app:src/routes/project/editProject.ts": "f28bb4e56c9bd1e8b88445024e8f1dbb8e00ee0a",
    "app:src/socket/routes/scriptAgent.ts": "ec71a705ca1b09fd985f330be3dc02393f86271d",
    "app:src/socket/routes/productionAgent.ts": "a6877cd19347aab081423af826209416003d88fd",
    "app:package.json": "fa726a984c6c51de0541b2b70bd80240ee48d77c",
    "app:electron-builder.yml": "cf574826b40bd95ef8ef3c11f464995df382a42f",
    "web:src/router/index.ts": "61edc12dfc01451455b177a2d9274c5a5a7fe28c",
    "web:src/pages/workbench/index.vue": "0ab6652daf2061c913ef5b8a8d7c2588abd6de38",
    "web:src/views/project/components/projectDialog.vue": "51cab23b040d1b630a3e9f6b0cceed9cbb64be89",
    "web:src/views/project/index.vue": "692734eb7deed3297eb6e4c1fe90fb7009ccaf83",
    "web:src/stores/project.ts": "a964013641c9573c4cb3ffbe866e12b92bec9c99",
}


def git(root: Path, *args: str) -> str:
    result = subprocess.run(["git", "-C", str(root), *args], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result.stdout.strip()


def validate_repo(root: Path, expected: str, label: str) -> None:
    if not (root / ".git").exists():
        raise RuntimeError(f"{label} 不是 Git 仓库：{root}")
    current = git(root, "rev-parse", "HEAD")
    if current != expected:
        raise RuntimeError(f"{label} 源码版本不匹配：当前 {current}，要求 {expected}")


def validate_url(value: str) -> str:
    value = value.strip().rstrip("/")
    parsed = urlparse(value)
    local = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme != "https" and not (local and parsed.scheme == "http"):
        raise RuntimeError("远程小鱼智算中心必须使用 HTTPS；仅 localhost/127.0.0.1 允许 HTTP")
    return value


def git_blob_sha(path: Path) -> str:
    data = path.read_bytes()
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


def assert_original(path: Path, key: str) -> None:
    text = path.read_text("utf-8")
    if MARKER in text:
        return
    expected = EXPECTED_BLOBS[key]
    actual = git_blob_sha(path)
    if actual != expected:
        raise RuntimeError(f"拒绝修改未知版本文件：{path}\n当前 blob={actual}\n要求 blob={expected}")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label} 锚点数量异常：期望1，实际{count}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str, flags: int = 0) -> str:
    new, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{label} 正则锚点未唯一命中")
    return new


def patch_file(root: Path, relative: str, key: str, transform) -> None:
    path = root / relative
    assert_original(path, key)
    text = path.read_text("utf-8")
    if MARKER in text:
        return
    updated = transform(text)
    if updated == text or MARKER not in updated:
        raise RuntimeError(f"补丁未生效：{relative}")
    path.write_text(updated, "utf-8", newline="\n")


def copy_overlay(source: Path, target: Path, compute_url: str) -> None:
    if not source.exists():
        raise RuntimeError(f"缺少覆盖目录：{source}")
    for item in source.rglob("*"):
        if not item.is_file():
            continue
        relative = item.relative_to(source)
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        content = item.read_bytes()
        if item.suffix in {".ts", ".vue", ".json", ".md", ".txt"}:
            text = content.decode("utf-8").replace("__XIAOYU_COMPUTE_CENTER_URL__", compute_url)
            destination.write_text(text, "utf-8", newline="\n")
        else:
            destination.write_bytes(content)


def patch_app(text: str) -> str:
    text = replace_once(text, 'import { ensureThumbnail, ThumbnailSize } from "@/utils/image";\n', 'import { ensureThumbnail, ThumbnailSize } from "@/utils/image";\nimport { bootstrapXiaoyu } from "@/xiaoyu/bootstrap";\nimport buildXiaoyuRoutes from "@/xiaoyu/routes";\nimport buildXiaoyuPipelineRoutes from "@/xiaoyu/pipeline/routes";\nimport { pipelineService } from "@/xiaoyu/pipeline/service";\nimport { xiaoyuContextMiddleware } from "@/xiaoyu/runtimeContext";\n// XIAOYU_P4: imports\n', "app imports")
    text = replace_once(text, '  await checkPermissions();\n\n  await u.writeVersion();', '  await checkPermissions();\n  await bootstrapXiaoyu();\n\n  await u.writeVersion();', "bootstrap")
    text = replace_once(text, '  const router = await import("@/router");\n  await router.default(app);', '  app.use(xiaoyuContextMiddleware);\n  await buildXiaoyuRoutes(app);\n  await buildXiaoyuPipelineRoutes(app);\n\n  const router = await import("@/router");\n  await router.default(app);', "routes")
    text = replace_once(text, '      console.log(`[服务启动成功]: http://localhost:${realPort}`);\n      resolve(realPort);', '      console.log(`[服务启动成功]: http://localhost:${realPort}`);\n      void pipelineService.recover().catch((error) => console.error("[小鱼一键生产] 恢复失败", error));\n      resolve(realPort);', "recover")
    return text


def patch_vm(text: str) -> str:
    text = replace_once(text, 'import crypto from "node:crypto";\n', 'import crypto from "node:crypto";\nimport { getXiaoyuRuntimeContext, nextXiaoyuCallIdentity } from "@/xiaoyu/runtimeContext";\n// XIAOYU_P4: VM runtime context\n', "vm import")
    text = replace_once(text, '    crypto,\n  };', '    crypto,\n    getXiaoyuRuntimeContext,\n    nextXiaoyuCallIdentity,\n  };', "vm sandbox")
    return text


def patch_ai(text: str) -> str:
    text = replace_once(text, 'import u from "@/utils";\n', 'import u from "@/utils";\nimport { XIAOYU_BRAND } from "@/xiaoyu/brand";\nimport { hydrateXiaoyuVendorInputs } from "@/xiaoyu/secureCredential";\n// XIAOYU_P4: decrypt vendor credential at runtime\n', "ai imports")
    text = replace_once(text, '    Object.assign(running.vendor.inputValues, JSON.parse(vendorConfigData.inputValues ?? "{}"));', '    const rawInputs = JSON.parse(vendorConfigData.inputValues ?? "{}");\n    const runtimeInputs = id === XIAOYU_BRAND.vendorId ? hydrateXiaoyuVendorInputs(rawInputs) : rawInputs;\n    Object.assign(running.vendor.inputValues, runtimeInputs);', "ai inputs")
    return text


def pipeline_schema_code() -> str:
    return '''\n  // XIAOYU_P4: project policy and persistent production DAG\n  await addColumn("o_project", "qualityMode", "string");\n  await addColumn("o_project", "computePresetVersion", "string");\n  if (!(await knex.schema.hasTable("o_xiaoyuPipelineRun"))) {\n    await knex.schema.createTable("o_xiaoyuPipelineRun", (table) => {\n      table.string("id").primary(); table.integer("projectId").notNullable().index(); table.integer("scriptId").notNullable().index();\n      table.string("status").notNullable().index(); table.string("qualityMode").notNullable(); table.string("policyVersion").notNullable();\n      table.string("startStage").notNullable(); table.string("stopAfterStage").notNullable(); table.string("currentStage");\n      table.integer("progress").notNullable().defaultTo(0); table.integer("pauseRequested").notNullable().defaultTo(0);\n      table.integer("cancelRequested").notNullable().defaultTo(0); table.text("forceStages").notNullable().defaultTo("[]");\n      table.text("outputPath"); table.text("error"); table.bigInteger("createdAt").notNullable(); table.bigInteger("updatedAt").notNullable();\n      table.bigInteger("startedAt"); table.bigInteger("completedAt");\n      table.index(["projectId", "scriptId", "status"]);\n    });\n  }\n  if (!(await knex.schema.hasTable("o_xiaoyuPipelineNode"))) {\n    await knex.schema.createTable("o_xiaoyuPipelineNode", (table) => {\n      table.string("id").primary(); table.string("runId").notNullable().index(); table.string("stageKey").notNullable();\n      table.integer("orderNo").notNullable(); table.string("status").notNullable().index(); table.integer("progress").notNullable().defaultTo(0);\n      table.integer("attempt").notNullable().defaultTo(0); table.integer("maxAttempts").notNullable().defaultTo(1);\n      table.string("idempotencyKey").notNullable(); table.string("inputHash"); table.text("result"); table.text("error");\n      table.bigInteger("startedAt"); table.bigInteger("completedAt"); table.bigInteger("updatedAt").notNullable();\n      table.unique(["runId", "stageKey"]);\n    });\n  }\n  if (!(await knex.schema.hasTable("o_xiaoyuPipelineEvent"))) {\n    await knex.schema.createTable("o_xiaoyuPipelineEvent", (table) => {\n      table.increments("id").primary(); table.string("runId").notNullable().index(); table.string("nodeId").index();\n      table.string("level").notNullable(); table.string("event").notNullable(); table.text("message").notNullable();\n      table.text("data"); table.bigInteger("createdAt").notNullable();\n    });\n  }\n'''


def patch_fixdb(text: str) -> str:
    return replace_once(text, '  // 添加新字段\n  await addColumn("o_prompt", "useData", "text");', pipeline_schema_code() + '\n  // 添加新字段\n  await addColumn("o_prompt", "useData", "text");', "fixDB schema")


def patch_database_types(text: str) -> str:
    text = replace_once(text, "  'videoRatio'?: string | null;\n}", "  'videoRatio'?: string | null;\n  'qualityMode'?: string | null;\n  'computePresetVersion'?: string | null;\n}\n// XIAOYU_P4: project policy", "project columns")
    definitions = '''\nexport interface o_xiaoyuPipelineRun {\n  id?: string; projectId?: number; scriptId?: number; status?: string; qualityMode?: string; policyVersion?: string;\n  startStage?: string; stopAfterStage?: string; currentStage?: string | null; progress?: number; pauseRequested?: number;\n  cancelRequested?: number; forceStages?: string; outputPath?: string | null; error?: string | null; createdAt?: number; updatedAt?: number;\n  startedAt?: number | null; completedAt?: number | null;\n}\nexport interface o_xiaoyuPipelineNode {\n  id?: string; runId?: string; stageKey?: string; orderNo?: number; status?: string; progress?: number; attempt?: number;\n  maxAttempts?: number; idempotencyKey?: string; inputHash?: string | null; result?: string | null; error?: string | null;\n  startedAt?: number | null; completedAt?: number | null; updatedAt?: number;\n}\nexport interface o_xiaoyuPipelineEvent {\n  id?: number; runId?: string; nodeId?: string | null; level?: string; event?: string; message?: string; data?: string | null; createdAt?: number;\n}\n'''
    text = replace_once(text, '\nexport interface DB {\n', definitions + '\nexport interface DB {\n', "DB definitions")
    text = replace_once(text, '  "o_videoTrack": o_videoTrack;\n}', '  "o_videoTrack": o_videoTrack;\n  "o_xiaoyuPipelineRun": o_xiaoyuPipelineRun;\n  "o_xiaoyuPipelineNode": o_xiaoyuPipelineNode;\n  "o_xiaoyuPipelineEvent": o_xiaoyuPipelineEvent;\n}', "DB aggregate")
    return text


def patch_socket(text: str, source: str) -> str:
    text = replace_once(text, 'import ResTool from "@/socket/resTool";\n', 'import ResTool from "@/socket/resTool";\nimport { runWithXiaoyuContext } from "@/xiaoyu/runtimeContext";\n// XIAOYU_P4: per-project socket context\n', f"{source} import")
    text = replace_once(text, '        await agent.runDecisionAI(ctx);', f'        await runWithXiaoyuContext({{ source: "{source}", projectId: Number(resTool.data.projectId), scriptId: Number(resTool.data.scriptId || 0) || undefined, stageRef: "agent" }}, () => agent.runDecisionAI(ctx));', f"{source} run")
    return text


def project_route(kind: str) -> str:
    id_schema = '    id: z.number(),\n' if kind == 'edit' else ''
    id_read = '    const id = Number(req.body.id);\n' if kind == 'edit' else '    const id = Date.now();\n'
    write = 'await u.db("o_project").where({ id }).update(data);' if kind == 'edit' else 'await u.db("o_project").insert({ ...data, id, createTime: Date.now(), userId: 1 });'
    return f'''import express from "express";\nimport u from "@/utils";\nimport {{ z }} from "zod";\nimport {{ success, error }} from "@/lib/responseFormat";\nimport {{ validateFields }} from "@/middleware/middleware";\nimport {{ getProductionPolicy }} from "@/xiaoyu/computeCenterClient";\n// XIAOYU_P4: quality-only project configuration\nconst router = express.Router();\nexport default router.post("/", validateFields({{\n{id_schema}    projectType: z.string(), name: z.string(), intro: z.string(), type: z.string(), artStyle: z.string(),\n    directorManual: z.string(), videoRatio: z.string(), qualityMode: z.enum(["quality", "standard", "economy"]),\n}}), async (req, res) => {{\n{id_read}    try {{\n      const policy = await getProductionPolicy(req.body.qualityMode);\n      if (!policy.production_ready) return res.status(409).send(error(`该模式暂不可生产，缺少：${{[...policy.missing_capabilities, ...policy.temporarily_unavailable_capabilities].join("、")}}`));\n      const data = {{\n        projectType: req.body.projectType, name: req.body.name, intro: req.body.intro, type: req.body.type, artStyle: req.body.artStyle,\n        directorManual: req.body.directorManual, videoRatio: req.body.videoRatio, qualityMode: req.body.qualityMode,\n        computePresetVersion: policy.policy_version, imageModel: "xiaoyu_compute_center:xy-image-auto",\n        videoModel: "xiaoyu_compute_center:xy-video-auto", imageQuality: req.body.qualityMode === "quality" ? "4K" : req.body.qualityMode === "economy" ? "1K" : "2K", mode: "singleImage",\n      }};\n      {write}\n      res.send(success({{ id, qualityMode: data.qualityMode, policyVersion: data.computePresetVersion }}, "项目已保存并锁定生产策略"));\n    }} catch (exception) {{\n      res.status(400).send(error(exception instanceof Error ? exception.message : String(exception), {{ supportWechat: "echo169369" }}));\n    }}\n}});\n'''


def patch_router(text: str) -> str:
    anchor = '        {\n          path: "/task",\n          component: () => import("@/views/task/index.vue"),\n        },\n'
    addition = anchor + '        {\n          path: "/xiaoyu",\n          component: () => import("@/views/xiaoyu/index.vue"),\n        },\n        {\n          path: "/xiaoyu-production",\n          component: () => import("@/views/xiaoyu/pipeline/index.vue"),\n        },\n        // XIAOYU_P4: simple production routes\n'
    return replace_once(text, anchor, addition, "web routes")


def patch_workbench(text: str) -> str:
    text = replace_once(text, '  { type: "btn", path: "/task", labelKey: "workbench.menu.taskCenter", icon: "i-view-list" },\n', '  { type: "btn", path: "/task", labelKey: "workbench.menu.taskCenter", icon: "i-view-list" },\n  { type: "btn", path: "/xiaoyu", labelKey: "小鱼智算中心", icon: "i-lightning" },\n  { type: "btn", path: "/xiaoyu-production", labelKey: "一键生产", icon: "i-play-one" },\n  // XIAOYU_P4: simplified production navigation\n', "workbench menu")
    return text


def patch_project_dialog(text: str) -> str:
    old_block = re.compile(r'''\s*<t-form-item :label="\$t\('workbench\.project\.dialog\.modelData'\)">.*?</t-form-item>\s*<t-form-item :label="\$t\('workbench\.project\.dialog\.videoModelData'\)">.*?</t-form-item>''', re.S)
    new_block = '''\n            <t-form-item label="生成质量">\n              <div class="xiaoyu-quality-grid">\n                <button v-for="option in QUALITY_OPTIONS" :key="option.value" type="button" class="xiaoyu-quality-card" :class="{ active: formState.qualityMode === option.value }" @click="formState.qualityMode = option.value">\n                  <strong>{{ option.label }}</strong><span>{{ option.description }}</span>\n                </button>\n              </div>\n              <!-- XIAOYU_P4: user chooses quality, system chooses models -->\n            </t-form-item>'''
    text, count = old_block.subn(new_block, text, count=1)
    if count != 1:
        raise RuntimeError("project dialog model block not found")
    text = text.replace('import modelSelect from "@/components/modelSelect.vue";\n', '')
    text = text.replace('  mode: string;\n}', '  mode: string;\n  qualityMode: "quality" | "standard" | "economy";\n  computePresetVersion?: string;\n}')
    text = text.replace('  mode: "",\n  directorManual: "",', '  mode: "singleImage",\n  qualityMode: "standard",\n  directorManual: "",')
    text = text.replace('  if (!formState.value.imageModel) return window.$message.warning($t("workbench.project.msg.enterImageModel"));\n  if (!formState.value.videoModel) return window.$message.warning($t("workbench.project.msg.enterVideoModel"));\n', '')
    text = text.replace('  if (!formState.value.imageQuality) return window.$message.warning($t("workbench.project.msg.enterProjectQuality"));\n  if (!formState.value.mode) return window.$message.warning($t("workbench.project.msg.selectMode"));\n', '')
    text = text.replace('      imageModel: formState.value.imageModel,\n      videoModel: formState.value.videoModel,\n', '      imageModel: "",\n      videoModel: "",\n      qualityMode: formState.value.qualityMode,\n')
    text = text.replace('      imageQuality: formState.value.imageQuality,\n      mode: formState.value.mode,', '      imageQuality: "",\n      mode: "singleImage",')
    text = text.replace('        imageModel: props.projectData.imageModel || "",\n        videoModel: props.projectData.videoModel || "",\n        imageQuality: props.projectData.imageQuality || "",', '        imageModel: props.projectData.imageModel || "",\n        videoModel: props.projectData.videoModel || "",\n        imageQuality: props.projectData.imageQuality || "",\n        qualityMode: props.projectData.qualityMode || "standard",')
    constants = '''\nconst QUALITY_OPTIONS = [\n  { value: "quality", label: "高质量", description: "精品生产，系统优先采用高质量模型和更多质量检查。" },\n  { value: "standard", label: "标准", description: "默认推荐，系统自动平衡质量、成本和速度。" },\n  { value: "economy", label: "省钱", description: "优先降低成本，画面质量与一致性不作保证。" },\n] as const;\n'''
    text = replace_once(text, 'const RATIO_OPTIONS = [\n', constants + '\nconst RATIO_OPTIONS = [\n', "quality constants")
    text = text.replace('</style>', '''\n.xiaoyu-quality-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; width: 100%; }\n.xiaoyu-quality-card { padding: 12px; border: 1px solid var(--td-component-border); border-radius: 10px; background: var(--td-bg-color-container); color: inherit; text-align: left; cursor: pointer; }\n.xiaoyu-quality-card strong, .xiaoyu-quality-card span { display: block; }\n.xiaoyu-quality-card span { margin-top: 6px; color: var(--td-text-color-secondary); font-size: 12px; line-height: 1.5; }\n.xiaoyu-quality-card.active { border: 2px solid var(--td-brand-color); background: var(--td-brand-color-1); }\n</style>''')
    if MARKER not in text:
        raise RuntimeError("project dialog marker missing")
    return text


def patch_project_index(text: str) -> str:
    text = text.replace('  directorManual: string;\n', '  directorManual: string;\n  qualityMode: "quality" | "standard" | "economy";\n  computePresetVersion?: string;\n')
    card_anchor = '        <t-tag shape="round" v-if="project.artStyle" style="align-self: flex-start">{{ project.artStyle }}</t-tag>\n'
    card_new = card_anchor + '        <t-tag shape="round" theme="primary">{{ qualityLabel(project.qualityMode) }}</t-tag>\n        <!-- XIAOYU_P4: project quality policy -->\n'
    text = replace_once(text, card_anchor, card_new, "project quality tag")
    script_anchor = 'const dialogShow = ref(false);\n'
    text = replace_once(text, script_anchor, script_anchor + 'const qualityLabel = (value?: string) => ({ quality: "高质量", standard: "标准", economy: "省钱" }[value || ""] || "标准");\n', "quality helper")
    return text


def patch_project_store(text: str) -> str:
    return replace_once(text, '  directorManual: string;\n', '  directorManual: string;\n  qualityMode: "quality" | "standard" | "economy";\n  computePresetVersion: string;\n  // XIAOYU_P4: immutable project production policy\n', "project store")


def patch_package(text: str) -> str:
    data = json.loads(text)
    data["name"] = "xiaoyu-ai-drama"
    data["version"] = "0.4.0"
    data["description"] = "小鱼Ai短剧生成系统：专业内核、简单操作、统一接入小鱼智算中心。"
    data["author"] = "小鱼 <echo169369>"
    rendered = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    return rendered.replace('{\n', '{\n  "_xiaoyu": "XIAOYU_P4",\n', 1)


def patch_builder(text: str) -> str:
    text = text.replace("appId: net.toonflow.www", "# XIAOYU_P4\nappId: com.xiaoyu.ai.drama")
    text = text.replace("productName: ToonFlow", "productName: 小鱼Ai短剧生成系统")
    text = text.replace("copyright: Copyright © 2026", "copyright: Copyright © 2026 小鱼")
    return text


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-root", required=True)
    parser.add_argument("--web-root", required=True)
    parser.add_argument("--compute-center-url", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    app_root = Path(args.app_root).resolve()
    web_root = Path(args.web_root).resolve()
    compute_url = validate_url(args.compute_center_url)
    validate_repo(app_root, APP_COMMIT, "桌面端")
    validate_repo(web_root, WEB_COMMIT, "Web端")
    if args.dry_run:
        print(json.dumps({"app": str(app_root), "web": str(web_root), "computeCenterUrl": compute_url, "valid": True}, ensure_ascii=False, indent=2))
        return

    overlay_root = Path(__file__).resolve().parents[1] / "toonflow-overlay"
    copy_overlay(overlay_root / "app", app_root, compute_url)
    copy_overlay(overlay_root / "web", web_root, compute_url)

    patch_file(app_root, "src/app.ts", "app:src/app.ts", patch_app)
    patch_file(app_root, "src/utils/vm.ts", "app:src/utils/vm.ts", patch_vm)
    patch_file(app_root, "src/utils/ai.ts", "app:src/utils/ai.ts", patch_ai)
    patch_file(app_root, "src/lib/fixDB.ts", "app:src/lib/fixDB.ts", patch_fixdb)
    patch_file(app_root, "src/types/database.d.ts", "app:src/types/database.d.ts", patch_database_types)
    patch_file(app_root, "src/socket/routes/scriptAgent.ts", "app:src/socket/routes/scriptAgent.ts", lambda t: patch_socket(t, "script-agent"))
    patch_file(app_root, "src/socket/routes/productionAgent.ts", "app:src/socket/routes/productionAgent.ts", lambda t: patch_socket(t, "production-agent"))
    patch_file(app_root, "package.json", "app:package.json", patch_package)
    patch_file(app_root, "electron-builder.yml", "app:electron-builder.yml", patch_builder)

    for relative, kind, key in [
        ("src/routes/project/addProject.ts", "add", "app:src/routes/project/addProject.ts"),
        ("src/routes/project/editProject.ts", "edit", "app:src/routes/project/editProject.ts"),
    ]:
        path = app_root / relative
        assert_original(path, key)
        if MARKER not in path.read_text("utf-8"):
            path.write_text(project_route(kind), "utf-8", newline="\n")

    patch_file(web_root, "src/router/index.ts", "web:src/router/index.ts", patch_router)
    patch_file(web_root, "src/pages/workbench/index.vue", "web:src/pages/workbench/index.vue", patch_workbench)
    patch_file(web_root, "src/views/project/components/projectDialog.vue", "web:src/views/project/components/projectDialog.vue", patch_project_dialog)
    patch_file(web_root, "src/views/project/index.vue", "web:src/views/project/index.vue", patch_project_index)
    patch_file(web_root, "src/stores/project.ts", "web:src/stores/project.ts", patch_project_store)

    manifest = {
        "version": "P4",
        "appCommit": APP_COMMIT,
        "webCommit": WEB_COMMIT,
        "computeCenterUrl": compute_url,
        "managedFiles": sorted(str(path.relative_to(app_root)) for path in app_root.rglob("*") if path.is_file() and ("xiaoyu" in str(path).lower() or MARKER in path.read_text("utf-8", errors="ignore"))),
    }
    (app_root / "data" / "xiaoyu-patch-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), "utf-8")
    print(json.dumps({"ok": True, "version": "P4", "appRoot": str(app_root), "webRoot": str(web_root)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

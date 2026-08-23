export async function assertProjectScript(db: any, projectId: number, scriptId: number): Promise<void> {
  const project = await db("o_project").where({ id: projectId }).first("id");
  if (!project) throw new Error(`项目不存在：${projectId}`);
  const script = await db("o_script").where({ id: scriptId, projectId }).first("id");
  if (!script) throw new Error(`剧本不存在或不属于当前项目：${scriptId}`);
}

export async function createUniqueVideoTrackId(db: any): Promise<number> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    const exists = await db("o_videoTrack").where({ id }).first("id");
    if (!exists) return id;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("生成视频轨道编号失败，请重试");
}

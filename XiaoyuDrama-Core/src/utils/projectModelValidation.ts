import { getModelRouteAvailability } from "@/xiaoyu/modelRouting";

function badRequest(message: string): Error {
  const error = new Error(message) as Error & { status?: number };
  error.status = 400;
  return error;
}

export async function validateProjectModelSelections(imageModel: unknown, videoModel: unknown): Promise<void> {
  const image = String(imageModel || "").trim();
  const video = String(videoModel || "").trim();
  const errors: string[] = [];

  if (image) {
    const route = await getModelRouteAvailability(image, "image");
    if (!route.ok) errors.push(`图片模型不可用：${route.reason}`);
  }
  if (video) {
    const route = await getModelRouteAvailability(video, "video");
    if (!route.ok) errors.push(`视频模型不可用：${route.reason}`);
  }

  if (errors.length) {
    throw badRequest(`${errors.join("；")}。可以清空对应模型后先保存项目，稍后重新配置。`);
  }
}

import db from "@/utils/db";
export const XIAOYU_MODEL_PREFIX="xiaoyu_compute_center:";
export const CUSTOM_POLICY_VERSION="custom-provider-v1";
export type ProjectProviderMode="xiaoyu"|"custom"|"mixed"|"unconfigured";
export function isXiaoyuModel(modelName:unknown):boolean{return String(modelName||"").startsWith(XIAOYU_MODEL_PREFIX);}
export function getProjectProviderMode(project:any):ProjectProviderMode{const imageModel=String(project?.imageModel||"").trim();const videoModel=String(project?.videoModel||"").trim();const selected=[imageModel,videoModel].filter(Boolean);if(!selected.length)return"unconfigured";const xiaoyuCount=selected.filter(isXiaoyuModel).length;if(xiaoyuCount===selected.length&&selected.length===2)return"xiaoyu";if(xiaoyuCount>0)return"mixed";return"custom";}
export async function getCustomAgentConfigurationState():Promise<{missing:string[];xiaoyuBound:string[]}>{const required=["scriptAgent","productionAgent","universalAi"];const rows=await db("o_agentDeploy").whereIn("key",required).select("key","modelName");const byKey=new Map(rows.map((row:any)=>[String(row.key),String(row.modelName||"").trim()]));const missing=required.filter(key=>!byKey.get(key));const xiaoyuBound=required.filter(key=>isXiaoyuModel(byKey.get(key)));return{missing,xiaoyuBound};}

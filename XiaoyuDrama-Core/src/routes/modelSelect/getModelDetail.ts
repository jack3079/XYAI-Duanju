import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success,error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router=express.Router();
export default router.post("/",validateFields({modelId:z.string()}),async(req,res)=>{const{modelId}=req.body;const[id,name]=modelId.split(/:(.+)/);const models=await u.vendor.getModelList(id);const findData=models.find((i:any)=>i.modelName==name);if(!findData)return res.status(404).send(error(`模型 ${modelId} 不存在或供应商未启用`));res.status(200).send(success(findData));});

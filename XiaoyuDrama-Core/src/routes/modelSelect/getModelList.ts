import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();
export default router.post("/",validateFields({type:z.enum(["text","image","video","all"])}),async(req,res)=>{const{type}=req.body;const dataList=await u.db("o_vendorConfig").select("id").where("enable",1);if(!dataList?.length)return res.status(200).send(success([]));const result=await Promise.all(dataList.map(async(data)=>{try{const vendorData=u.vendor.getVendor(data.id!);if(!vendorData)return[];const models=await u.vendor.getModelList(data.id!);const filtered=type==="all"?models.filter((item:{type:string})=>item.type!=="video"):models.filter((item:{type:string})=>item.type===type);return filtered.map((item:{name:string;modelName:string;type:string})=>({id:data.id,label:item.name,value:item.modelName,type:item.type,name:vendorData.name||data.id}));}catch(error){console.warn(`[modelSelect] 跳过无效供应商：${data.id}`,error);return[];}}));res.status(200).send(success(result.flat()));});

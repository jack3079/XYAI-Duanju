import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router=express.Router();
export default router.post("/",validateFields({agentUseMode:z.enum(["0","1"])}),async(req,res)=>{const{agentUseMode}=req.body;const existing=await u.db("o_setting").where("key","agentUseMode").first();if(existing)await u.db("o_setting").where("key","agentUseMode").update({value:agentUseMode});else await u.db("o_setting").insert({key:"agentUseMode",value:agentUseMode});res.status(200).send(success("保存设置成功"));});

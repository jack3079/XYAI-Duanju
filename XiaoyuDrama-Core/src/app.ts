// import "./logger";
import "./err";
import "./env";
import express,{Request,Response,NextFunction} from "express";
import { Server } from "socket.io";
import http from "node:http";
import expressWs from "express-ws";
import logger from "morgan";
import cors from "cors";
import buildRoute from "@/core";
import path from "path";
import fs from "fs";
import u from "@/utils";
import jwt from "jsonwebtoken";
import socketInit from "@/socket/index";
import { isEletron } from "@/utils/getPath";
import { ensureThumbnail,ThumbnailSize } from "@/utils/image";
import routerDefault from "@/router";
import { installXiaoyuProcessLogging,installXiaoyuRequestLogging } from "@/xiaoyu/maintenance/logger";
import buildXiaoyuRoutes from "@/xiaoyu/routes";
import { bootstrapXiaoyu } from "@/xiaoyu/bootstrap";
import { dbReady } from "@/utils/db";
const app=express();installXiaoyuProcessLogging();const server=http.createServer(app);
async function checkPermissions(){if(!isEletron())return true;const userDataPath=u.getPath();try{fs.mkdirSync(userDataPath,{recursive:true});const testFile=path.join(userDataPath,".access_test");fs.writeFileSync(testFile,"test");fs.unlinkSync(testFile);}catch(e){const{dialog,app}=require("electron");const{response}=await dialog.showMessageBox({type:"warning",title:"权限不足",message:"应用无法访问数据目录",detail:`无法读写以下目录：\n${userDataPath}\n\n请联系管理员授予权限，或以管理员身份运行本程序。`,buttons:["确认退出"],defaultId:0});if(response===0)app.quit();}}
export default async function startServe(randomPort:Boolean=false){await checkPermissions();await dbReady;await u.writeVersion();await bootstrapXiaoyu();const io=new Server(server,{cors:{origin:"*"},pingInterval:10000,pingTimeout:60000});socketInit(io);if(process.env.NODE_ENV==="dev")await buildRoute();expressWs(app);app.use(logger("dev"));app.get("/healthz",(_req,res)=>res.status(200).send({ok:true,service:"xiaoyu-ai-drama"}));installXiaoyuRequestLogging(app);app.use(cors({origin:"*"}));app.use(express.json({limit:"100mb"}));app.use(express.urlencoded({extended:true,limit:"100mb"}));const ossDir=u.getPath("oss");if(!fs.existsSync(ossDir))fs.mkdirSync(ossDir,{recursive:true});app.use("/oss",(req,res,next)=>{if(req.query.size){const size=req.query.size as string;const smallImageBaseDir=path.join(ossDir,"smallImage");const originalPath=path.join(ossDir,req.path);let sizeSubDir:string;let sizeOpts:ThumbnailSize|undefined;const dimensMatch=size.match(/^(\d+)x(\d+)$/i);const percentMatch=size.match(/^(\d+(?:\.\d+)?)\s*%?$/);if(dimensMatch){const w=parseInt(dimensMatch[1],10),h=parseInt(dimensMatch[2],10);sizeSubDir=`${w}x${h}`;sizeOpts={type:"dimensions",width:w,height:h};}else if(percentMatch){const pct=parseFloat(percentMatch[1]);sizeSubDir=`${percentMatch[1]}p`;sizeOpts={type:"percentage",value:pct};}else{return express.static(ossDir,{acceptRanges:false})(req,res,next);}const ext=path.extname(req.path),base=path.basename(req.path,ext),dir=path.dirname(req.path);const smallImagePath=path.join(smallImageBaseDir,dir,`${base}_${sizeSubDir}${ext}`);ensureThumbnail(originalPath,smallImagePath,sizeOpts).then(thumbnailPath=>thumbnailPath?res.sendFile(thumbnailPath):express.static(ossDir,{acceptRanges:false})(req,res,next));return;}next();},express.static(ossDir,{acceptRanges:false}));const skillsDir=u.getPath("skills");if(!fs.existsSync(skillsDir))fs.mkdirSync(skillsDir,{recursive:true});app.use("/skills",(req,res,next)=>{/\.(jpe?g|png|gif|webp|svg|ico|bmp)$/i.test(req.path)?next():res.status(403).end();},express.static(skillsDir,{acceptRanges:false}));const assetsDir=u.getPath("assets");if(!fs.existsSync(assetsDir))fs.mkdirSync(assetsDir,{recursive:true});app.use("/assets",express.static(assetsDir,{acceptRanges:false}));const webDir=u.getPath("web");if(fs.existsSync(webDir))app.use(express.static(webDir,{acceptRanges:false}));app.use(async(req,res,next)=>{const setting=await u.db("o_setting").where("key","tokenKey").select("value").first();if(!setting)return res.status(444).send({message:"服务器秘钥未配置，请联系管理员"});const{value:tokenKey}=setting;const rawToken=req.headers.authorization||(req.query.token as string)||"";const token=rawToken.replace("Bearer ","");if(req.path==="/api/login/login")return next();if(!token)return res.status(401).send({message:"未提供token"});try{(req as any).user=jwt.verify(token,tokenKey as string);next();}catch{return res.status(401).send({message:"无效的token"});}});await buildXiaoyuRoutes(app);await routerDefault(app);app.use((_,res)=>res.status(404).send({message:"API 404 Not Found"}));app.use((err:any,_:Request,res:Response,__:NextFunction)=>{console.error(err);const status=Number(err?.status||err?.statusCode||500);res.status(status).send({message:status>=500?"服务器内部错误":String(err?.message||"请求失败")});});const port=randomPort?0:10588;return new Promise(resolve=>{server.listen(port,()=>{const address=server.address();const realPort=typeof address==="string"?address:address?.port;console.log(`[服务启动成功]: http://localhost:${realPort}`);resolve(realPort);});});}
export function closeServe():Promise<void>{return new Promise((resolve,reject)=>server?server.close((err?:Error)=>err?reject(err):resolve()):resolve());}
const isElectron=typeof process.versions?.electron!=="undefined";if(!isElectron)startServe();

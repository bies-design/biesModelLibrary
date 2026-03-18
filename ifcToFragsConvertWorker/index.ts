import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
// import * as Minio from 'minio';
// import { Job, JobScheduler, Queue, Worker } from 'bullmq';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from './prisma/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// 引入核心套件 (ESM)
import * as FRAGS from "@thatopen/fragments";
// import * as WEBIFC from "web-ifc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 讀取上一層的 .env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

//初始化prisma
const adapter = new PrismaPg({ connectionString: process.env.POSTGRESDB_URI});
const prisma = new PrismaClient({ adapter });

// === 1. Redis 連線設定 ===
// 這是 BullMQ 用來連線 Redis 
const redisEndpoint: string = String(process.env.REDIS_HOST || 'localhost');
const redisportStr: string = String(process.env.REDIS_PORT);
const redisConnection = new IORedis({
    host: redisEndpoint,
    port: parseInt(redisportStr || '6379', 10),
    maxRetriesPerRequest: null, // BullMQ 要求必須設為 null
})

const IFC_BUCKET = process.env.S3_IFC_BUCKET;
const FRAG_BUCKET = process.env.S3_FRAGS_BUCKET;

// === 2. 初始化 IfcImporter ===
const serializer = new FRAGS.IfcImporter();
serializer.wasm.path = "/"

// bull module 是直接輔助node 使用和管理 Redis I/O 
// 這個 Queue 用來讓 Webhook 把任務丟進去
// 名稱按照ENV 設置，tus-server 和 ifc-convert-frags-server 同步
const ifcConversionQueue4jobs = String(process.env.IFC_CONVERSION_Q);
const conversionQueue = new Queue(ifcConversionQueue4jobs || 'ifc-conversion-queue', { 
    connection: redisConnection 
});

const str_Ifc2FragsConvertPort = String(process.env.IFC_FRAGS_CONVERT_WORKER_PORT);
const PORT = parseInt(str_Ifc2FragsConvertPort || "3005");

// === 3. 轉檔程序 ===
// bull module 是直接輔助node 使用和管理 Redis I/O 
// 會去檢查redis還有沒有工作，並在背景「一個接一個」執行任務；如同工人一樣
// 名稱按照ENV 設置，tus-server 和 ifc-convert-frags-server 同步
const ifcConversionQueue2Work = String(process.env.IFC_CONVERSION_Q);
const worker = new Worker(ifcConversionQueue2Work || 'ifc-conversion-queue', 
    path.join(__dirname, "sandboxed/ifcconverttask.ts"), {
    connection: redisConnection,
    concurrency: 1, // 🔥 關鍵！同時只能有 1 個任務在跑 (避免 OOM)
    // 延長任務超時保護鎖
    lockDuration: 120000, // 延長到 2 分鐘 (毫秒單位)
    lockRenewTime: 20000 // 每 20 秒嘗試續約一次
});

// === 4. 監聽 Worker 事件 (通知 Tus Server) ===

// 成功時通知
worker.on('completed', async (job, result) => {
    const { fileKey, fileName } = job.data;
    console.log(`📞 [Worker] Job ${job.id} 完成，通知 Tus Server...`);

    try {
        const tusServUrl = "http://" + String(process.env.TUS_SERVER_HOST) +
         ":" + String(process.env.TUS_SERVER_PORT) + "/notify/done";
        await fetch(tusServUrl || 'http://localhost:3003/notify/done', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fileKey: fileKey,
                fileName: fileName,
                status: 'success',
                size: result.totalSize.toString()
            })
        });
    } catch (e:any) {
        console.error("❌ [Worker] 無法通知 Server (Success):", e.message);
    }
});
// 失敗時通知
worker.on('failed', async (job, err) => {
    if(!job) return;
    const { fileKey, fileName, dbId } = job.data;
    console.error(`❌ [Worker] Job ${job.id} 失敗: ${err.message}`);

    if(dbId){
        try {
            await prisma.model.update({
                where:{id:dbId},
                data:{
                    status:'error',
                    errorMessage:err.message
                }
            });
            console.log(`📝 [Worker] Job Fail [DB] ${dbId} 狀態更新為 Error`);
        }catch(dbErr:any){
            console.error(`⚠️ [Worker] Job Fail [DB] ${dbId} 更新失敗狀態錯誤: ${dbErr.message}`);
        }
    }
    try {
        const tusServUrl = "http://" + String(process.env.TUS_SERVER_HOST) +
         ":" + String(process.env.TUS_SERVER_PORT) + "/notify/done";
        await fetch(tusServUrl || 'http://localhost:3003/notify/done', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fileKey: fileKey,
                fileName: fileName,
                status: 'error',
                message: err.message
            })
        });
    } catch (e:any) {
        console.error("❌ [Worker]  無法通知 Server (Error):", e.message);
    }
});

// === 5. 設定 Web Server(Webhook 入口) ===
const app = express();
app.use(cors());
app.use(bodyParser.json());

app.post('/webhook/convert', async(req, res) => {
    const { fileKey, fileName, dbId } = req.body;
    
    if (!fileKey || !fileName) {
        return res.status(400).send({ error: 'Missing fileKey or fileName' });
    }

    // 把任務加入佇列，然後馬上回應
    try {
        await conversionQueue.add('convert-job', { 
            fileKey, 
            fileName,
            dbId
        },{
            jobId: fileKey, //強制把 Job ID 設定成跟 fileKey 一樣！
            // 設定自動清理 (重要!!!!!!)
            removeOnComplete: {
                age: 3600, // 保留 1 小時內的紀錄 (秒)
                count: 100 // 或者最多保留最新的 100 筆
            },
            removeOnFail: {
                age: 24 * 3600, // 失敗的保留 24 小時讓我們查修
                count: 50
            }
        });

        console.log(`📨 [Worker] /webhook/convert 已將 ${fileName} 加入佇列等待處理(DB_ID: ${dbId})`);
        
        // 這裡回應 200，告訴 Tus Server "我收到了，正在排隊中"
        // 前端會顯示 "Converting..." (因為 Tus Server 尚未廣播 success)
        res.status(200).send({ status: 'Queued', message: 'Job added to queue' });

    } catch (err) {
        console.error("❌ [Worker] /webhook/convert 無法加入佇列:", err);
        res.status(500).send({ error: 'Queue Error' });
    }
});

// 拒絕其他所有請求 (GET, POST, etc.)
// app.all(/(.*)/, (req, res) => {
//     res.status(403).json({
//         success: false,
//         message: `${process.env.IFC_FRAGS_CONVERT_WORKER_HOST} 無法受理此請求 (Request Not Accepted)`,
//         timestamp: new Date().toISOString()
//     });
// });

app.listen(PORT, () => {
    console.log(`--------------------------------------------------`);
    console.log(`👷 IfcImporter Worker (ESM) Listening on port ${PORT}`);
    console.log(`👷 IfcImporter Work List on port ${redisConnection.options.port}`);
    console.log(`🐂 BullMQ Worker Started with Concurrency: 1`);
    console.log(`--------------------------------------------------`);
});
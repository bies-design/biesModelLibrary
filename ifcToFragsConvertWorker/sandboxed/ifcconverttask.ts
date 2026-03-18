import { SandboxedJob } from 'bullmq';
import * as Minio from 'minio';

// 載入工具套件
import { PrismaClient } from '../prisma/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// 引入核心套件 (ESM)
import * as FRAGS from "@thatopen/fragments";

// 環境變數
const IFC_BUCKET = process.env.S3_IFC_BUCKET;
const FRAG_BUCKET = process.env.S3_FRAGS_BUCKET;

const s3Endpoint: string = String(process.env.S3_HOST || 'localhost');
const s3portStr: string = String(process.env.S3_PORT); 
const minioClient = new Minio.Client({
    endPoint: s3Endpoint,               // 沒有 http:// or https:// 前墜，直接主機名稱或 IP
    port: parseInt(s3portStr || '9000', 10),
    useSSL: false,
    accessKey: process.env.S3_ACCESS_KEY,
    secretKey: process.env.S3_SECRET_KEY
});

let lastMinIOCheckTime = 0;

// 初始化工具
// === IfcImporter ===
const serializer = new FRAGS.IfcImporter();
serializer.wasm.path = "/"
// === Prisma ===
const adapter = new PrismaPg({ connectionString: process.env.POSTGRESDB_URI});
const prisma = new PrismaClient({ adapter });

// 輔助函式：同線程中，強制釋放 Event Loop
const yieldEventLoop = () => new Promise(resolve => setImmediate(resolve));

// === 拆解轉檔動作 ================
async function taskDownloadIFC(job:any, fileKey:any) {

    const stat = await minioClient.statObject(IFC_BUCKET as any, fileKey);
    const totalSize = stat.size;
    let downloadedSize = 0;

    console.log(`⬇️ [Convert Task] 透過 [MinIO] 下載 ...`);
    const fileStream = await minioClient.getObject(IFC_BUCKET as any, fileKey);
    const chunks: Buffer[] = [];

    for await (const chunk of fileStream) {
        chunks.push(chunk);
        downloadedSize += chunk.length;

        // 下載進度：0% ~ 40%
        const percentage = Math.round((downloadedSize / totalSize) * 40);

        // 簡單節流：每 5% 更新一次
        if (percentage % 10 === 0){
            await job.updateProgress(percentage);
        }

        // 每處理一個 chunk 稍微釋放一下，確保網路 I/O 不會完全鎖死
        await yieldEventLoop();
    }

    // 將所有碎片合併為單一 Buffer
    const fileBuffer = Buffer.concat(chunks);

    // 💡 關鍵：清空 chunks 陣列，釋放對碎片 Buffer 的引用
    chunks.length = 0; 

    console.log(`📦 [Convert Task] 下載完成，大小: ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB `);
    return {fileBuffer, totalSize};
}

async function taskConvertToFrag(job:any, fileBuffer:any) {
    console.log(`⚙️ [Convert Task] 開始進入 [Convert] 轉檔 (.frag)...`);
    // 定義節流變數，避免 Redis 被call爛
    let lastReportTime = 0;
    const start = performance.now();
    
    const modelData = await serializer.process({
        // 💡 這裡直接傳入 fileBuffer，Buffer 本身就是 Uint8Array，避免多餘拷貝
        // bytes: new Uint8Array(fileBuffer),
        bytes: fileBuffer, 
        progressCallback: async (progress)=>{
            // 🛑 關鍵：每次回呼都釋放一下 Event Loop，讓 BullMQ 有機會去跟 Redis 續約
            await yieldEventLoop();

            //progress 0-1
            const now = Date.now();
            // 節流：每 1 秒才允許更新一次 Redis
            if((now - lastReportTime) > 1000){
                lastReportTime = now;

                // 轉換階段進度映射：40% ~ 90%
                // 公式： 40 + (progress * 0.5)
                const totalProgress = Math.round(40 + (progress * 50));

                await job.updateProgress(totalProgress).catch((e:any) => console.error(e));
            }
            console.log(`[Convert Task] 正在進行${job.id}轉檔,總進度為${progress}`);
        }
    });
    const duration = (performance.now() - start) / 1000;
    console.log(`✅ [Convert Task] 透過 [Convert] 轉檔成功！耗時: ${duration.toFixed(2)}s`);

    return modelData;
}

async function taskUploadFrag(job:any, fileKey:any, modelData:any, dbId:any, totalSize:any) {
    // 手動更新到 90% (轉檔完成)
    await job.updateProgress(90);
    const fragKey = fileKey + '.frag'; 
    // const fragBuffer = Buffer.from(modelData);
    // 直接使用傳進來的 modelData，減少 1~2GB 的記憶體佔用

    // 檢查 Bucket 
    const bucketExists = await minioClient.bucketExists(FRAG_BUCKET as any);
    // 距離上次隨用檢查已經超過5分鐘，就會再次檢驗
    const now = Date.now();
    if (!lastMinIOCheckTime){
        lastMinIOCheckTime = Date.now();
    }
    const bucketNeedToCheck = ((lastMinIOCheckTime - now) > 300000)? true: false;
    if (!bucketExists && bucketNeedToCheck) {
        await minioClient.makeBucket(FRAG_BUCKET as any);
    }

    console.log(`⬆️ [Convert Task] 連線 [MinIO] 上傳 .frag 檔案: ${fragKey}`);
    // ✅ 將 Uint8Array 轉為 Buffer 但不複製記憶體 (零拷貝)
    const fragBuffer = Buffer.from(
        modelData.buffer, 
        modelData.byteOffset, 
        modelData.byteLength
    );
    await minioClient.putObject(FRAG_BUCKET as any, fragKey, fragBuffer);

    if(dbId){
        try{
            await prisma.model.update({
                where:{id:dbId},
                data:{
                    status:'completed',
                    size:totalSize.toString()
                }
            });
            console.log(`📝 [Convert Task] 連線 [DB] Model ${fragKey}狀態更新為 Completed`);
        }catch(e:any){
            console.error(`⚠️ [Convert Task] 連線 [DB] Model ${fragKey} 更新狀態失敗: ${e.message}`)
        }
    }

    // 完成！更新到 100%
    await job.updateProgress(100);

    return fragKey;
}

// 讓這個檔案會跑在獨立的 Process
export default async (job: SandboxedJob) => {
    // job.data 包含我們在 Webhook 裡丟進去的 { fileKey, fileName }
    const { fileKey, fileName, dbId } = job.data;

    // 執行轉檔步驟
    console.log(`🚀 [Job Start] 開始處理: ${fileName} (Key: ${fileKey})(DB_ID:${dbId})`);

    // 💡 頂層宣告，方便隨時手動釋放
    let rawData: Buffer | null = null;
    let modelData: Uint8Array | null = null;
    let totalSize = 0;

    try{
        // 1. 下載 IFC
        const res = await taskDownloadIFC(job, fileKey);
        rawData = res.fileBuffer;
        totalSize = res.totalSize;

        // 2. ⚙️ 轉換階段 (使用 progressCallback)
        // 直接傳入 rawData (Buffer 是 Uint8Array 的子類，通常不需要 new Uint8Array)
        modelData = await taskConvertToFrag(job, rawData);

        // 轉檔完立刻釋放原始檔案記憶體
        rawData = null as any;

        // 3. ⬆️ 上傳階段 (轉存成檔案，並上傳到MinIO)
        const fragKey = await taskUploadFrag(job, fileKey, modelData, dbId, totalSize);

        // 回收不需使用的暫存
        modelData = null as any;

        // 轉檔步驟完成
        console.log(`🎉 [Job Done] 任務完成！`);
        return { fileKey, fileName, fragKey, totalSize }; // 回傳結果給 Worker 事件
    } catch (error) {
        // 發生錯誤也要清空，否則下一個 Job 進來會直接 OOM
        rawData = null;
        modelData = null;
        throw error;
    }

};
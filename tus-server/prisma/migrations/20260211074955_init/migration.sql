-- CreateEnum
CREATE TYPE "ProcessStatus" AS ENUM ('uploading', 'processing', 'completed', 'error');

-- CreateTable
CREATE TABLE "Model" (
    "id" TEXT NOT NULL,
    "shortId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "uploader" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "status" "ProcessStatus" NOT NULL DEFAULT 'uploading',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "shortId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "keywords" TEXT[],
    "coverImage" TEXT NOT NULL,
    "images" TEXT[],
    "modelId" TEXT NOT NULL,
    "relatedPosts" TEXT[],
    "permission" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "team" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Model_shortId_key" ON "Model"("shortId");

-- CreateIndex
CREATE UNIQUE INDEX "Model_fileId_key" ON "Model"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "Post_shortId_key" ON "Post"("shortId");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

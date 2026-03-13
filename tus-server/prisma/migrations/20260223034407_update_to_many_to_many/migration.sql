/*
  Warnings:

  - You are about to drop the column `modelId` on the `Post` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Post" DROP CONSTRAINT "Post_modelId_fkey";

-- AlterTable
ALTER TABLE "Post" DROP COLUMN "modelId",
ADD COLUMN     "description" TEXT,
ADD COLUMN     "pdfId" TEXT[];

-- CreateTable
CREATE TABLE "_ModelToPost" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ModelToPost_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_ModelToPost_B_index" ON "_ModelToPost"("B");

-- AddForeignKey
ALTER TABLE "_ModelToPost" ADD CONSTRAINT "_ModelToPost_A_fkey" FOREIGN KEY ("A") REFERENCES "Model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ModelToPost" ADD CONSTRAINT "_ModelToPost_B_fkey" FOREIGN KEY ("B") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

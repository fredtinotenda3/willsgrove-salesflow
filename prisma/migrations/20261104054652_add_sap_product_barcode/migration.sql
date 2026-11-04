/*
  Warnings:

  - You are about to drop the column `description` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `inventoryUom` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `salesUom` on the `Product` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Product" DROP COLUMN "description",
DROP COLUMN "inventoryUom",
DROP COLUMN "salesUom",
ADD COLUMN     "barcode" TEXT;

-- CreateIndex
CREATE INDEX "Product_barcode_idx" ON "Product"("barcode");

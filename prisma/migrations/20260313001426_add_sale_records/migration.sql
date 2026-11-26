-- CreateTable
CREATE TABLE "Sale" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "recordNumber" INTEGER,
    "orderNumber" TEXT,
    "saleDate" DATETIME NOT NULL,
    "itemTitle" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "itemNumber" TEXT,
    "soldFor" REAL NOT NULL DEFAULT 0,
    "shipping" REAL NOT NULL DEFAULT 0,
    "eBayTax" REAL NOT NULL DEFAULT 0,
    "totalPrice" REAL NOT NULL DEFAULT 0,
    "shipToState" TEXT,
    "shipToCountry" TEXT,
    "promoted" BOOLEAN NOT NULL DEFAULT false,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

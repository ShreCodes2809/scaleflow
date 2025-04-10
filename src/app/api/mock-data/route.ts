import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { BlockService } from "@/lib/services/BlockService";
import { EmbeddingService } from "@/lib/services/EmbeddingService";
import {
  upsertEmbeddings,
  PineconeVector,
  PineconeMetadata
} from "@/lib/vectorDb/pinecone";
import {
  BlockTypeEnum,
  CellBlock,
  ColumnBlock,
  RowBlock,
  SheetBlock
} from "@/lib/types";
import { v4 as uuidv4 } from "uuid";

// --- Mock Data Generation Logic ---
const generateMockData = (numRows: number, numCols: number) => {
  const countries = ["CAN", "DEU", "USA", "GBR", "AUS"];
  const urls = [
    "https://company1.com",
    "https://company2.com",
    "https://company3.com",
    "https://company4.com",
    "https://company5.com"
  ];
  const peopleCounts = [35, 50, 90, 120, 200, 393, 12345];
  const linkedInPosts = [null];
  const webTrafficValues = [7423, 9821, 10321, 8745, 12500];
  const companyNames = [
    "Company One",
    "Company Two",
    "Company Three",
    "Company Four",
    "Company Five"
  ];

  const columns = [
    { name: "Country", type: "text" },
    { name: "URL", type: "text" },
    { name: "People Count", type: "number" },
    { name: "LinkedIn Posts", type: "text" },
    { name: "Web Traffic", type: "number" },
    { name: "Company Name", type: "text" }
  ].slice(0, numCols);

  const rows = [];
  for (let i = 0; i < numRows; i++) {
    const rowData: { [key: string]: string | number | null } = {};

    columns.forEach((col) => {
      if (col.name === "Country") {
        rowData[col.name] = countries[i % countries.length];
      } else if (col.name === "URL") {
        rowData[col.name] = urls[i % urls.length];
      } else if (col.name === "People Count") {
        rowData[col.name] = peopleCounts[i % peopleCounts.length];
      } else if (col.name === "LinkedIn Posts") {
        rowData[col.name] =
          linkedInPosts[Math.floor(Math.random() * linkedInPosts.length)];
      } else if (col.name === "Web Traffic") {
        rowData[col.name] = webTrafficValues[i % webTrafficValues.length];
      } else if (col.name === "Company Name") {
        rowData[col.name] = companyNames[i % companyNames.length];
      } else {
        rowData[col.name] = `Mock data for ${col.name}`;
      }
    });
    rows.push(rowData);
  }

  return { columns, rows };
};
// --- ---

export async function POST(request: NextRequest) {
  try {
    const requestBody = await request.json();

    const numRows = requestBody.numRows ?? 1000;
    const numCols = requestBody.numCols ?? 6; // Adjusted default to 6 columns
    if (numRows > 1000 || numCols > 10) {
      // Add limits
      return new NextResponse("Requested size too large", { status: 400 });
    }

    const blockService = new BlockService();
    const embeddingService = new EmbeddingService();
    const { columns: columnDefs, rows: rowData } = generateMockData(
      numRows,
      numCols
    );

    // 1. Create Sheet
    const sheet: Omit<
      SheetBlock,
      "id" | "created_at" | "updated_at" | "deleted_at"
    > = {
      type: BlockTypeEnum.SHEET,
      parent_id: null,
      organization_id: "rc_org_1",
      properties: { title: `Mock Sheet ${new Date().toISOString()}` },
      content: [], // Will be populated later if needed, rely on parent_id
      created_by: "rc_user_1"
    };
    const createdSheet = await blockService.createBlock(sheet as any);
    const sheetId = createdSheet.id;

    // 2. Create Columns
    const createdColumns: ColumnBlock[] = [];
    for (let i = 0; i < columnDefs.length; i++) {
      const colDef = columnDefs[i];
      const column: Omit<
        ColumnBlock,
        "id" | "created_at" | "updated_at" | "deleted_at"
      > = {
        type: BlockTypeEnum.COLUMN,
        parent_id: sheetId,
        organization_id: "rc_org_1",
        properties: { name: colDef.name, type: colDef.type, position: i },
        content: null,
        created_by: "rc_user_1"
      };
      const createdCol = await blockService.createBlock(column as any);
      createdColumns.push(createdCol as ColumnBlock);
    }

    // 3. Create Rows and Cells (and prepare embeddings)
    const cellsToEmbed: { text: string; metadata: PineconeMetadata }[] = [];
    for (const data of rowData) {
      const row: Omit<
        RowBlock,
        "id" | "created_at" | "updated_at" | "deleted_at"
      > = {
        type: BlockTypeEnum.ROW,
        parent_id: sheetId,
        organization_id: "rc_org_1",
        properties: { name: String(data["Company Name"]) }, // Store row name
        content: null,
        created_by: "rc_user_1"
      };
      const createdRow = await blockService.createBlock(row as any);
      const rowId = createdRow.id;

      for (const column of createdColumns) {
        const cellValue = String(data[column.properties.name] || ""); // Ensure cellValue is a string
        const cell: Omit<
          CellBlock,
          "id" | "created_at" | "updated_at" | "deleted_at"
        > = {
          type: BlockTypeEnum.CELL,
          parent_id: rowId,
          organization_id: "rc_org_1",
          properties: {
            value: cellValue,
            column: { id: column.id, name: column.properties.name }
          },
          content: null,
          created_by: "rc_user_1"
        };
        const createdCell = await blockService.createBlock(cell as any);

        // Prepare for embedding
        if (
          cellValue &&
          typeof cellValue === "string" &&
          cellValue.trim().length > 0
        ) {
          cellsToEmbed.push({
            text: cellValue,
            metadata: {
              blockId: createdCell.id,
              rowId: rowId,
              columnId: column.id,
              sheetId: sheetId,
              orgId: "rc_org_1",
              contentSnippet: cellValue.substring(0, 100) // Store snippet
            }
          });
        }
      }
    }

    // 4. Generate and Upsert Embeddings
    if (cellsToEmbed.length > 0) {
      console.log(`Generating embeddings for ${cellsToEmbed.length} cells...`);
      const embeddings = await embeddingService.generateEmbeddingsBatch(
        cellsToEmbed.map((c) => c.text)
      );
      const vectors: PineconeVector[] = cellsToEmbed
        .map((cell, index) => ({
          id: cell.metadata.blockId,
          values: embeddings[index],
          metadata: cell.metadata
        }))
        .filter((v) => v.values && v.values.length > 0); // Filter out potential zero vectors

      if (vectors.length > 0) {
        console.log(`Upserting ${vectors.length} vectors to Pinecone...`);
        await upsertEmbeddings(vectors);
        console.log("Embeddings upserted.");
      }
    }

    return NextResponse.json({
      message: `Successfully created mock sheet ${sheetId} with ${numRows} rows and ${numCols} columns.`,
      sheetId: sheetId
    });
  } catch (error: any) {
    console.error("[MOCK_DATA_POST]", error);
    return new NextResponse(`Internal Server Error: ${error.message}`, {
      status: 500
    });
  }
}

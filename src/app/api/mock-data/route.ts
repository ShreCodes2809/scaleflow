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
const generateMockData = (numRows: number) => {
  // Define possible values for each column based on the screenshot
  const productPortfolios = ["Research"];
  const urls = [
    "https://company1.com",
    "https://company2.com",
    "https://company3.com",
    "https://company4.com",
    "https://company5.com",
    "not_a_url",
    "12345"
  ];
  const companyNames = [
    "Company One",
    "Company Two",
    "Company Three",
    "Company Four",
    "Company Five",
    ""
  ];
  const countries = ["CAN", "DEU", "USA", "GBR", "AUS"];
  const webTrafficValues = [7423, 9821, 10321, 8745, 12500];
  const peopleCounts = [35, 50, 90, 120, 200, 393];
  const totalRaisedValues = [3000000, 5000000, 7000000, 8500000, 12000000];
  const fundingRounds = ["PRE_SEED", "SEED", "SERIES_A", "SERIES_B", "GRANT"];

  // Define columns based on the screenshot
  const columns = [
    { name: "Product Portfolios", type: "text" },
    { name: "URL", type: "text" },
    { name: "Company", type: "text" },
    { name: "Country", type: "text" },
    { name: "Web Traffic", type: "number" },
    { name: "People Count", type: "number" },
    { name: "Total Raised", type: "number" },
    { name: "Last Funding Round", type: "text" },
    { name: "Base Data", type: "text" }
  ];

  const rows = [];
  for (let i = 0; i < numRows; i++) {
    const rowData: { [key: string]: string | number | null } = {};

    // Generate consistent company data
    const companyIndex = i % companyNames.length;
    const countryIndex = i % countries.length;

    columns.forEach((col) => {
      if (col.name === "Product Portfolios") {
        rowData[col.name] = productPortfolios[0];
      } else if (col.name === "URL") {
        rowData[col.name] = urls[i % urls.length];
      } else if (col.name === "Company") {
        rowData[col.name] = companyNames[companyIndex];
      } else if (col.name === "Country") {
        rowData[col.name] = countries[countryIndex];
      } else if (col.name === "Web Traffic") {
        // Some rows might not have web traffic data
        rowData[col.name] =
          Math.random() > 0.1
            ? webTrafficValues[i % webTrafficValues.length]
            : null;
      } else if (col.name === "People Count") {
        rowData[col.name] = peopleCounts[i % peopleCounts.length];
      } else if (col.name === "Total Raised") {
        rowData[col.name] = totalRaisedValues[i % totalRaisedValues.length];
      } else if (col.name === "Last Funding Round") {
        rowData[col.name] = fundingRounds[i % fundingRounds.length];
      } else if (col.name === "Base Data") {
        rowData[col.name] = "{}"; // Based on the symbol in screenshot, appears to be empty data
      }
    });
    rows.push(rowData);
  }

  return { columns, rows };
};
// --- ---

// --- Helper for creating rich text representations ---
const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(amount);
};

// Add country code to full name mapping
const countryNames: { [key: string]: string } = {
  AUS: "Australia",
  USA: "United States",
  CAN: "Canada",
  GBR: "United Kingdom",
  DEU: "Germany"
};

const getFullCountryName = (countryCode: string) => {
  return countryNames[countryCode] || countryCode;
};

const generateRowText = (rowData: any, companyName: string) => {
  // Create a text representation of the entire row
  let text = `Information about ${companyName || "a company"}: `;

  if (rowData["Country"]) {
    const countryName = getFullCountryName(rowData["Country"]);
    text += `Located in ${countryName} (${rowData["Country"]}). `;

    // Add explicit geographic context for search
    if (rowData["Total Raised"]) {
      const amount =
        typeof rowData["Total Raised"] === "number"
          ? formatCurrency(rowData["Total Raised"])
          : rowData["Total Raised"];
      text += `Part of the ${countryName} funding ecosystem with ${amount} raised. `;
    }
  }

  if (rowData["People Count"]) {
    text += `Has ${rowData["People Count"]} employees. `;
  }

  if (rowData["Web Traffic"]) {
    text += `Receives ${rowData["Web Traffic"]} web visitors. `;
  }

  if (rowData["Total Raised"] && rowData["Last Funding Round"]) {
    const amount =
      typeof rowData["Total Raised"] === "number"
        ? formatCurrency(rowData["Total Raised"])
        : rowData["Total Raised"];
    text += `Raised ${amount} in ${rowData["Last Funding Round"]} funding round. `;
  } else if (rowData["Total Raised"]) {
    const amount =
      typeof rowData["Total Raised"] === "number"
        ? formatCurrency(rowData["Total Raised"])
        : rowData["Total Raised"];
    text += `Raised ${amount}. `;
  } else if (rowData["Last Funding Round"]) {
    text += `Completed a ${rowData["Last Funding Round"]} funding round. `;
  }

  if (rowData["URL"] && rowData["URL"].startsWith("http")) {
    text += `Website: ${rowData["URL"]}. `;
  }

  // Add specific phrases to help with country-based querying
  if (rowData["Country"]) {
    const countryName = getFullCountryName(rowData["Country"]);
    text += `This row contains funding data for a company in ${countryName}. `;
    text += `Use this for analyzing ${countryName} funding trends. `;
  }

  return text.trim();
};

const generateCellContextualText = (
  cellValue: string | number | null,
  columnName: string,
  rowData: any
) => {
  if (cellValue === null) return "";

  const companyName = rowData["Company"] || "the company";
  let countryInfo = "";

  // Add country context to all cells
  if (rowData["Country"]) {
    const countryName = getFullCountryName(rowData["Country"]);
    countryInfo = ` based in ${countryName}`;
  }

  // Add context based on column type
  if (columnName === "Total Raised") {
    const fundingRound = rowData["Last Funding Round"] || "a funding round";
    return `${companyName}${countryInfo} raised ${formatCurrency(
      Number(cellValue)
    )} in ${fundingRound}. This data point can be used for analyzing funding trends${
      countryInfo ? " in " + getFullCountryName(rowData["Country"]) : ""
    }.`;
  }

  if (columnName === "Last Funding Round") {
    const amount = rowData["Total Raised"]
      ? formatCurrency(Number(rowData["Total Raised"]))
      : "funding";
    return `${companyName}${countryInfo} completed a ${cellValue} round raising ${amount}. This shows the funding stage distribution${
      countryInfo ? " in " + getFullCountryName(rowData["Country"]) : ""
    }.`;
  }

  if (columnName === "People Count") {
    return `${companyName}${countryInfo} has ${cellValue} employees. This shows company size${
      countryInfo ? " in " + getFullCountryName(rowData["Country"]) : ""
    }.`;
  }

  if (columnName === "Web Traffic") {
    return `${companyName}${countryInfo} receives ${cellValue} visitors to their website. This shows popularity${
      countryInfo
        ? " of companies in " + getFullCountryName(rowData["Country"])
        : ""
    }.`;
  }

  if (columnName === "Country") {
    const countryName = getFullCountryName(String(cellValue));
    return `${companyName} is located in ${countryName} (${cellValue}). This data point can be used for geographic funding analysis in ${countryName}.`;
  }

  if (columnName === "Company") {
    return `Information about ${cellValue}: a company${
      countryInfo ? " based in " + getFullCountryName(rowData["Country"]) : ""
    } in the database.`;
  }

  // Generic fallback
  return `${columnName} for ${companyName}${countryInfo}: ${cellValue}`;
};

// --- ---

export async function POST(request: NextRequest) {
  try {
    const requestBody = await request.json();

    const numRows = requestBody.numRows ?? 100;
    if (numRows > 1000) {
      // Add limits
      return new NextResponse("Requested size too large", { status: 400 });
    }

    console.log(`Generating mock data with ${numRows} rows...`);
    const blockService = new BlockService();
    const embeddingService = new EmbeddingService();
    const { columns: columnDefs, rows: rowData } = generateMockData(numRows);

    // 1. Create Sheet
    const sheet: Omit<
      SheetBlock,
      "id" | "created_at" | "updated_at" | "deleted_at"
    > = {
      type: BlockTypeEnum.SHEET,
      parent_id: null,
      organization_id: "rc_org_1",
      properties: { title: `Research Companies ${new Date().toISOString()}` },
      content: [], // Will be populated later if needed, rely on parent_id
      created_by: "rc_user_1"
    };
    const createdSheet = await blockService.createBlock(sheet as any);
    const sheetId = createdSheet.id;
    console.log(`Created sheet with ID: ${sheetId}`);

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
    console.log(`Created ${createdColumns.length} columns`);

    // 3. Create Rows and Cells
    // Store cells by row for later embedding generation
    const rowsData: {
      rowId: string;
      rowData: any;
      cells: {
        cellId: string;
        columnId: string;
        columnName: string;
        value: string | number | null;
      }[];
    }[] = [];

    let totalCellsCreated = 0;

    for (const data of rowData) {
      const row: Omit<
        RowBlock,
        "id" | "created_at" | "updated_at" | "deleted_at"
      > = {
        type: BlockTypeEnum.ROW,
        parent_id: sheetId,
        organization_id: "rc_org_1",
        properties: { name: String(data["Company"] || "") },
        content: null,
        created_by: "rc_user_1"
      };
      const createdRow = await blockService.createBlock(row as any);
      const rowId = createdRow.id;

      // Track row and its cells
      const rowEntry: {
        rowId: string;
        rowData: any;
        cells: {
          cellId: string;
          columnId: string;
          columnName: string;
          value: string | number | null;
        }[];
      } = {
        rowId,
        rowData: { ...data },
        cells: []
      };

      for (const column of createdColumns) {
        const cellValue =
          data[column.properties.name] !== null
            ? String(data[column.properties.name] || "")
            : null;
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
        totalCellsCreated++;

        // Track cell in the row entry
        rowEntry.cells.push({
          cellId: createdCell.id,
          columnId: column.id,
          columnName: column.properties.name,
          value: data[column.properties.name]
        });
      }

      rowsData.push(rowEntry);
    }
    console.log(
      `Created ${rowsData.length} rows with ${totalCellsCreated} total cells`
    );

    // 4. Generate and Upsert Embeddings - NEW APPROACH
    console.log("Preparing embeddings with row-level context...");
    const cellsToEmbed: { text: string; metadata: PineconeMetadata }[] = [];
    const rowsToEmbed: { text: string; metadata: PineconeMetadata }[] = [];

    // Process each row to create both row-level and cell-level embeddings
    for (const row of rowsData) {
      const companyName = row.rowData["Company"] || "Unknown Company";

      // 1. Create a consolidated row text for row-level embedding
      const rowText = generateRowText(row.rowData, companyName);

      // Create row-level embedding
      rowsToEmbed.push({
        text: rowText,
        metadata: {
          blockId: row.rowId,
          rowId: row.rowId,
          sheetId: sheetId,
          orgId: "rc_org_1",
          contentSnippet: rowText.substring(0, 100),
          isRowLevel: true,
          // Include all column IDs associated with this row for filtering
          columnIds: row.cells.map((cell) => cell.columnId),
          // Include key data for quick filtering
          companyName: companyName,
          country: row.rowData["Country"],
          fundingRound: row.rowData["Last Funding Round"]
        }
      });

      // 2. Create contextual cell-level embeddings
      for (const cell of row.cells) {
        if (cell.value !== null && String(cell.value).trim() !== "") {
          // Generate contextual text for this cell
          const contextualText = generateCellContextualText(
            cell.value,
            cell.columnName,
            row.rowData
          );

          if (contextualText) {
            cellsToEmbed.push({
              text: contextualText,
              metadata: {
                blockId: cell.cellId,
                rowId: row.rowId,
                columnIds: row.cells.map((cell) => cell.columnId),
                sheetId: sheetId,
                orgId: "rc_org_1",
                contentSnippet: contextualText.substring(0, 100),
                columnName: cell.columnName,
                // Include related column values for better filtering
                companyName: companyName,
                country: row.rowData["Country"],
                fundingRound: row.rowData["Last Funding Round"]
              }
            });
          }
        }
      }
    }

    // Log some samples for debugging
    if (rowsToEmbed.length > 0) {
      console.log("Sample row embedding text:", rowsToEmbed[0].text);
      console.log("Sample row metadata:", rowsToEmbed[0].metadata);
    }

    if (cellsToEmbed.length > 0) {
      console.log("Sample cell embedding text:", cellsToEmbed[0].text);
      console.log("Sample cell metadata:", cellsToEmbed[0].metadata);
    }

    // First generate and upsert row-level embeddings
    if (rowsToEmbed.length > 0) {
      console.log(`Generating embeddings for ${rowsToEmbed.length} rows...`);
      const rowEmbeddings = await embeddingService.generateEmbeddingsBatch(
        rowsToEmbed.map((r) => r.text)
      );
      console.log(`Generated ${rowEmbeddings.length} row embeddings`);

      const rowVectors: PineconeVector[] = rowsToEmbed
        .map((row, index) => ({
          id: `row_${row.metadata.rowId}`, // Prefix with 'row_' to distinguish
          values: rowEmbeddings[index],
          metadata: row.metadata
        }))
        .filter((v) => v.values && v.values.length > 0);

      if (rowVectors.length > 0) {
        console.log(
          `Upserting ${rowVectors.length} row vectors to Pinecone...`
        );
        const result = await upsertEmbeddings(rowVectors);
        console.log("Row embeddings upsert result:", result);
      }
    }

    // Then generate and upsert cell-level embeddings
    if (cellsToEmbed.length > 0) {
      console.log(`Generating embeddings for ${cellsToEmbed.length} cells...`);

      // Process in batches to avoid memory issues with large datasets
      const BATCH_SIZE = 100;
      for (let i = 0; i < cellsToEmbed.length; i += BATCH_SIZE) {
        const batch = cellsToEmbed.slice(i, i + BATCH_SIZE);
        console.log(
          `Processing cell embedding batch ${i / BATCH_SIZE + 1}/${Math.ceil(
            cellsToEmbed.length / BATCH_SIZE
          )}`
        );

        const cellEmbeddings = await embeddingService.generateEmbeddingsBatch(
          batch.map((c) => c.text)
        );

        const cellVectors: PineconeVector[] = batch
          .map((cell, index) => ({
            id: cell.metadata.blockId,
            values: cellEmbeddings[index],
            metadata: cell.metadata
          }))
          .filter((v) => v.values && v.values.length > 0);

        if (cellVectors.length > 0) {
          console.log(
            `Upserting batch of ${cellVectors.length} cell vectors to Pinecone...`
          );
          const result = await upsertEmbeddings(cellVectors);
          console.log(`Batch ${i / BATCH_SIZE + 1} upsert result:`, result);
        }
      }

      console.log("All cell embeddings upserted.");
    }

    return NextResponse.json({
      message: `Successfully created mock sheet ${sheetId} with ${numRows} rows and ${columnDefs.length} columns.`,
      sheetId: sheetId,
      embeddingsCreated: {
        rows: rowsToEmbed.length,
        cells: cellsToEmbed.length
      }
    });
  } catch (error: any) {
    console.error("[MOCK_DATA_POST]", error);
    return new NextResponse(`Internal Server Error: ${error.message}`, {
      status: 500
    });
  }
}

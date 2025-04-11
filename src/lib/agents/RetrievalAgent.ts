import { BlockService } from "@/lib/services/BlockService";
import { EmbeddingService } from "@/lib/services/EmbeddingService";
import { queryEmbeddings, PineconeMetadata } from "@/lib/vectorDb/pinecone";
import { Evidence, CellBlock, BlockTypeEnum, Block } from "@/lib/types";
import { RetrievalPlan } from "./ReasoningAgent";

// Simple regex to check for UUID format
const UUID_REGEX =
  /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/;

export class RetrievalAgent {
  constructor(
    private blockService: BlockService,
    private embeddingService: EmbeddingService
  ) {}

  async retrieveEvidence(
    plan: RetrievalPlan[],
    sheetId: string
  ): Promise<Evidence[]> {
    // Store retrieved cells grouped by row ID
    const cellsByRow = new Map<string, CellBlock[]>();
    // Keep track of all fetched cell IDs to potentially avoid duplicate Evidence objects if needed later
    const retrievedCellIds = new Set<string>();

    console.log(
      `Starting retrieval with ${plan.length} plan steps for sheet ${sheetId}`
    );

    for (const step of plan) {
      console.log(
        `Retrieval Step: ${step.reasoning}`,
        JSON.stringify(step, null, 2)
      );
      let retrievedCellsForStep: CellBlock[] = [];

      try {
        if (step.type === "semantic" && step.query) {
          const queryEmbedding = await this.embeddingService.generateEmbedding(
            step.query
          );
          // Ensure orgId is included in the filter for security/scoping
          const vectorFilter: Partial<PineconeMetadata> = { sheetId };

          // Add column filters if specified in the plan
          if (step.filters.columnIds && step.filters.columnIds.length > 0) {
            console.log(
              `Adding column filter for: ${step.filters.columnIds.join(", ")}`
            );
            vectorFilter.columnIds = step.filters.columnIds;
          }

          // Add row filters if specified (and not "*")
          if (
            step.filters.rowIds &&
            step.filters.rowIds.length > 0 &&
            !step.filters.rowIds.includes("*")
          ) {
            console.log(
              `Adding row filter for ${step.filters.rowIds.length} rows`
            );
            vectorFilter.rowId = step.filters.rowIds[0];
          }

          const vectorResults = await queryEmbeddings(
            queryEmbedding,
            vectorFilter,
            30 // Increased to get more data per retrieval
          );

          console.log(
            `Semantic search returned ${vectorResults.length} results`
          );

          const blockIds = vectorResults.map((v) => v.id.replace("row_", ""));
          if (blockIds.length > 0) {
            // Fetch full block data from Supabase using IDs from vector search
            console.log(`Fetching ${blockIds.length} blocks from database`);
            const results = await Promise.all(
              blockIds.map((id) => this.blockService.getBlock(id))
            );

            // Ensure nulls are filtered out *before* type check
            retrievedCellsForStep = results.filter(
              (b) => b !== null && b.type === BlockTypeEnum.CELL
            ) as CellBlock[];

            console.log(
              `Retrieved ${retrievedCellsForStep.length} valid cells`
            );
          }
        } else if (step.type === "keyword" && step.keywords) {
          console.log(`Keyword search for: ${step.keywords.join(", ")}`);

          // Prepare search parameters
          const searchParams: any = {
            sheetId,
            contentKeywords: step.keywords,
            limit: 50 // Increased limit for keyword search
          };

          // Add column and row filters if specified
          if (step.filters.columnIds && step.filters.columnIds.length > 0) {
            searchParams.columnIds = step.filters.columnIds;
          }

          if (
            step.filters.rowIds &&
            step.filters.rowIds.length > 0 &&
            !step.filters.rowIds.includes("*")
          ) {
            searchParams.rowIds = step.filters.rowIds;
          }

          retrievedCellsForStep = await this.blockService.findBlocks(
            searchParams
          );
          console.log(
            `Keyword search returned ${retrievedCellsForStep.length} cells`
          );
        } else if (step.type === "specific" && step.blockIds) {
          // --- VALIDATION ADDED HERE ---
          const validBlockIds = step.blockIds.filter((id) =>
            UUID_REGEX.test(id)
          );
          const invalidIds = step.blockIds.filter(
            (id) => !validBlockIds.includes(id)
          );

          if (invalidIds.length > 0) {
            console.warn(
              `Skipping invalid block IDs in 'specific' retrieval step: ${invalidIds.join(
                ", "
              )}`
            );
          }
          // --- END VALIDATION ---

          console.log(`Fetching specific blocks: ${validBlockIds.join(", ")}`);

          if (validBlockIds.length > 0) {
            // Fetch specific blocks
            const results = await Promise.all(
              validBlockIds.map((id) => this.blockService.getBlock(id)) // Use validated IDs
            );
            // Ensure nulls are filtered out *before* type check
            retrievedCellsForStep = results.filter(
              (b) => b !== null && b.type === BlockTypeEnum.CELL
            ) as CellBlock[];
            console.log(
              `Retrieved ${retrievedCellsForStep.length} cells for specific block IDs`
            );
          } else {
            retrievedCellsForStep = []; // No valid IDs to fetch
          }
        }

        // --- Group fetched cells by their parent row ID ---
        console.log(
          `Step retrieved ${retrievedCellsForStep.length} cells total`
        );

        // Debug raw cell data
        retrievedCellsForStep.forEach((cell, idx) => {
          if (idx < 5) {
            // Log just a few cells to avoid flooding the console
            console.log(
              `Sample cell ${idx}: ` +
                `Column=${cell.properties?.column?.name || "unknown"}, ` +
                `Value=${cell.properties?.value || "empty"}, ` +
                `Row=${cell.parent_id}`
            );
          }
        });

        for (const cell of retrievedCellsForStep) {
          // Ensure cell and parent_id exist
          if (cell && cell.parent_id) {
            const rowId = cell.parent_id;
            if (!cellsByRow.has(rowId)) {
              cellsByRow.set(rowId, []);
            }
            // Avoid adding duplicate cells within the same row group for this step
            if (
              !cellsByRow
                .get(rowId)
                ?.some((existing) => existing.id === cell.id)
            ) {
              cellsByRow.get(rowId)?.push(cell);
              retrievedCellIds.add(cell.id); // Track overall retrieved cell IDs
            }
          } else {
            console.warn(
              "Retrieved cell missing or missing parent_id:",
              cell?.id
            );
          }
        }
      } catch (error) {
        console.error(`Error during retrieval step (${step.type}):`, error);
        // Continue to next step if one fails for resilience
      }
    } // End of loop through plan steps

    // --- Consolidate evidence per row ---
    const consolidatedEvidence: Evidence[] = [];
    const allRowIds = Array.from(cellsByRow.keys());

    console.log(`Consolidating evidence from ${allRowIds.length} unique rows`);

    // Process each row
    for (const rowId of allRowIds) {
      const rowCells = cellsByRow.get(rowId) || [];
      if (rowCells.length === 0) continue;

      // Debug output for the first few rows
      if (consolidatedEvidence.length < 3) {
        console.log(
          `ROW SAMPLE ${consolidatedEvidence.length + 1}: Row ID ${rowId} has ${
            rowCells.length
          } cells`
        );
        rowCells.forEach((cell) => {
          console.log(
            `  - Column: ${
              cell.properties?.column?.name || "unknown"
            }, Value: ${cell.properties?.value || "empty"}`
          );
        });
      }

      // Preserve table layout in the evidence content
      let combinedContent = "Row Data:\n";

      // Sort alphabetically by column name for consistency
      rowCells.sort((a, b) => {
        const nameA = a.properties?.column?.name ?? "";
        const nameB = b.properties?.column?.name ?? "";
        return nameA.localeCompare(nameB);
      });

      // Collect company name for better row identification
      let companyName = "";
      const companyCell = rowCells.find(
        (cell) => cell.properties?.column?.name === "Company"
      );
      if (companyCell && companyCell.properties?.value) {
        companyName = String(companyCell.properties.value);
      }

      combinedContent += `Company: ${companyName}\n`;

      // Add each cell with type hints
      rowCells.forEach((cell) => {
        const colName = cell.properties?.column?.name || `Unknown Column`;
        let cellValue =
          cell.properties?.value !== null
            ? String(cell.properties?.value)
            : "null";

        // Add numeric type hints for specific columns we know are numeric
        const numericColumns = ["Total Raised", "People Count", "Web Traffic"];
        const isNumericColumn = numericColumns.includes(colName);

        // Process numeric values with appropriate hints
        if (isNumericColumn && cellValue && cellValue.trim() !== "") {
          // Remove commas and convert to number
          const rawNumber = cellValue.replace(/,/g, "");
          const numericValue = Number(rawNumber);

          if (!isNaN(numericValue)) {
            // Show both formatted and raw number for clarity
            combinedContent += `- ${colName}: ${cellValue} [numeric:${numericValue}] [cell:${cell.id}]\n`;
          } else {
            combinedContent += `- ${colName}: ${cellValue} [cell:${cell.id}]\n`;
          }
        } else {
          combinedContent += `- ${colName}: ${cellValue} [cell:${cell.id}]\n`;
        }
      });

      consolidatedEvidence.push({
        blockId: rowId,
        content: combinedContent.trim(),
        rowId: rowId,
        sheetId: sheetId,
        // Use a representative column ID if available
        columnId: rowCells[0]?.properties?.column?.id,
        // Add metadata to help synthesis agent understand the structure
        metadata: {
          isRowData: true,
          companyName: companyName,
          columnCount: rowCells.length,
          columns: rowCells.map((c) => c.properties?.column?.name),
          hasNumericData: rowCells.some((c) =>
            ["Total Raised", "People Count", "Web Traffic"].includes(
              c.properties?.column?.name || ""
            )
          )
        }
      });
    }

    // Log sample of final evidence
    if (consolidatedEvidence.length > 0) {
      console.log("EVIDENCE SAMPLE:");
      console.log(consolidatedEvidence[0].content);
    }

    console.log(
      `Returning ${consolidatedEvidence.length} consolidated evidence items`
    );
    return consolidatedEvidence;
  }
}

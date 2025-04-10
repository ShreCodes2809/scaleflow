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
          // Add row/column filters if specified in the plan (requires metadata in Pinecone)
          // Example: if (step.filters.rowIds) vectorFilter.rowId = { $in: step.filters.rowIds };
          // Example: if (step.filters.columnIds) vectorFilter.columnId = { $in: step.filters.columnIds };

          const vectorResults = await queryEmbeddings(
            queryEmbedding,
            vectorFilter,
            15 // Increased slightly to get potentially more context per row
          );
          const blockIds = vectorResults.map((v) => v.id);
          console.log("Semantic search found blockIds:", blockIds);
          if (blockIds.length > 0) {
            // Fetch full block data from Supabase using IDs from vector search
            // TODO: Implement getBlocksBatch in BlockService for efficiency
            console.log("calling getBlock for blockIDs");
            const results = await Promise.all(
              blockIds.map((id) => this.blockService.getBlock(id))
            );
            console.log("Resultss:", results);
            // Ensure nulls are filtered out *before* type check
            retrievedCellsForStep = results.filter(
              (b) => b !== null && b.type === BlockTypeEnum.CELL
            ) as CellBlock[];
          }
        } else if (step.type === "keyword" && step.keywords) {
          console.log("calling findBlocks for keyword step", sheetId, step);
          retrievedCellsForStep = await this.blockService.findBlocks({
            sheetId,
            rowIds: step.filters.rowIds,
            columnIds: step.filters.columnIds,
            contentKeywords: step.keywords,
            limit: 25 // Limit keyword results
          });
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

          console.log("Valid block IDs:", validBlockIds);

          if (validBlockIds.length > 0) {
            // Fetch specific blocks
            // TODO: Implement getBlocksBatch in BlockService for efficiency
            const results = await Promise.all(
              validBlockIds.map((id) => this.blockService.getBlock(id)) // Use validated IDs
            );
            // Ensure nulls are filtered out *before* type check
            retrievedCellsForStep = results.filter(
              (b) => b !== null && b.type === BlockTypeEnum.CELL
            ) as CellBlock[];
            console.log(
              "Retrieved cells for specific step:",
              retrievedCellsForStep
            );
          } else {
            retrievedCellsForStep = []; // No valid IDs to fetch
          }
        }

        // --- Group fetched cells by their parent row ID ---
        console.log(`Step retrieved ${retrievedCellsForStep.length} cells.`);
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
        // Continue to next step if one fails? Or throw?
        // Consider logging the error and continuing for resilience.
      }
    } // End of loop through plan steps

    // --- NEW: Consolidate evidence per row ---
    const consolidatedEvidence: Evidence[] = [];
    const allRowIds = Array.from(cellsByRow.keys());

    console.log(`Consolidating evidence from ${allRowIds.length} unique rows.`);

    for (const rowId of allRowIds) {
      const rowCells = cellsByRow.get(rowId) || [];
      if (rowCells.length === 0) continue;

      // Combine cell data into a single content string for the row
      // Include inline citations for each piece of data
      let combinedContent = "";
      const cellSourcesForMetadata: string[] = []; // Optional: for metadata

      // Sort cells by column position if available, otherwise by creation time or ID?
      // Sorting helps present data consistently to the Synthesis agent.
      // Example: Sorting by column name if available
      rowCells.sort((a, b) => {
        const nameA = a.properties?.column?.name ?? "";
        const nameB = b.properties?.column?.name ?? "";
        return nameA.localeCompare(nameB);
      });

      rowCells.forEach((cell) => {
        // Try to get a meaningful column name, fallback to partial ID
        const colName =
          cell.properties?.column?.name ||
          `Col(${cell.properties?.column?.id?.substring(0, 4) ?? "N/A"})`;
        const cellValue = cell.properties?.value?.toString() ?? ""; // Use nullish coalescing
        // Add the data point with its inline citation
        combinedContent += `${colName}: ${cellValue} [cell:${cell.id}]\n`;
        cellSourcesForMetadata.push(`[cell:${cell.id}]`);
      });

      // Create one Evidence object per relevant row
      consolidatedEvidence.push({
        blockId: rowId, // Use rowId as the primary identifier for this evidence piece
        content: combinedContent.trim(), // The combined string with inline citations
        rowId: rowId,
        columnId: "multiple", // Indicate content comes from multiple columns
        sheetId: sheetId
        // Optional: Add citations for all contributing cells to metadata if needed elsewhere
        // metadata: { cellSources: cellSourcesForMetadata }
      });
    }

    console.log(
      `Consolidated into ${consolidatedEvidence.length} row-based evidence pieces.`,
      consolidatedEvidence
    );
    return consolidatedEvidence;
  }
}

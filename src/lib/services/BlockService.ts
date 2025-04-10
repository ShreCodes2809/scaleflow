// src/lib/services/BlockService.ts
import { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/db/supabase"; // Use the shared client
import {
  Block,
  BlockTypeEnum,
  CellBlock,
  ColumnBlock,
  RowBlock
} from "@/lib/types";
import { Database } from "@/lib/types/supabase"; // Generated types

// Define BlockData based on generated Supabase types if available
type BlockData = Database["public"]["Tables"]["blocks"]["Row"];

export class BlockService {
  private supabase: SupabaseClient<Database>;

  // Allow injecting supabase client for testing, otherwise use default
  constructor(client: SupabaseClient<Database> = supabase) {
    this.supabase = client;
  }

  // --- getBlock, createBlock, updateBlockProperties remain the same ---
  async getBlock(id: string): Promise<BlockData | null> {
    const { data, error } = await this.supabase
      .from("blocks")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      console.error(`Error fetching block ${id}:`, error);
      throw error;
    }
    return data;
  }

  async createBlock(
    block: Omit<
      BlockData,
      "id" | "created_at" | "updated_at" | "deleted_at"
    > & { id?: string }
  ): Promise<BlockData> {
    const now = new Date().toISOString();
    const blockToInsert = {
      ...block,
      created_at: now,
      updated_at: now,
      deleted_at: null
    };

    if (block.id) {
      blockToInsert.id = block.id;
    }

    const { data, error } = await this.supabase
      .from("blocks")
      .insert(blockToInsert)
      .select()
      .single();

    if (error) {
      console.error("Error creating block:", error);
      throw error;
    }
    return data;
  }

  async updateBlockProperties(
    id: string,
    properties: Record<string, any>
  ): Promise<BlockData | null> {
    const { data, error } = await this.supabase.rpc("update_block_properties", {
      p_block_id: id,
      p_properties: properties
    });

    if (error) {
      console.error(`Error updating properties for block ${id}:`, error);
      throw error;
    }
    return data?.[0] || null;
  }

  // --- getCellByColumnAndRow, getColumnsBySheetId remain the same ---
  async getCellByColumnAndRow(
    rowId: string,
    columnId: string
  ): Promise<CellBlock | null> {
    const { data, error } = await this.supabase
      .from("blocks")
      .select("*")
      .eq("type", BlockTypeEnum.CELL)
      .eq("parent_id", rowId)
      .eq("properties->column->>id", columnId) // Query JSONB property
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      console.error(
        `Error fetching cell for row ${rowId}, col ${columnId}:`,
        error
      );
      throw error;
    }
    return data as CellBlock | null; // Cast needed
  }

  async getColumnsBySheetId(sheetId: string): Promise<ColumnBlock[]> {
    const { data, error } = await this.supabase
      .from("blocks")
      .select("*")
      .eq("parent_id", sheetId)
      .eq("type", BlockTypeEnum.COLUMN)
      .is("deleted_at", null)
      .order("properties->>position"); // Order by position if stored

    if (error) {
      console.error(`Error fetching columns for sheet ${sheetId}:`, error);
      throw error;
    }
    return (data || []) as ColumnBlock[]; // Cast needed
  }

  // --- getRowsBySheetId, getCellsByRowId remain the same ---
  async getRowsBySheetId(sheetId: string): Promise<RowBlock[]> {
    const { data, error } = await this.supabase
      .from("blocks")
      .select("*")
      .eq("parent_id", sheetId)
      .eq("type", BlockTypeEnum.ROW)
      .is("deleted_at", null);

    // console.log("data in getRowsBySheetId", data); // Keep for debugging if needed

    if (error) {
      console.error(`Error fetching rows for sheet ${sheetId}:`, error);
      throw error;
    }
    // Ensure correct casting
    return (data || []) as RowBlock[];
  }

  async getCellsByRowId(rowId: string): Promise<CellBlock[]> {
    const { data, error } = await this.supabase
      .from("blocks")
      .select("*")
      .eq("parent_id", rowId)
      .eq("type", BlockTypeEnum.CELL)
      .is("deleted_at", null);

    if (error) {
      console.error(`Error fetching cells for row ${rowId}:`, error);
      throw error;
    }
    return (data || []) as CellBlock[]; // Cast needed
  }

  // *** UPDATED findBlocks Method ***
  async findBlocks(params: {
    sheetId: string;
    rowIds?: (string | "*")[];
    columnIds?: string[]; // Column names, not UUIDs
    contentKeywords?: string[];
    limit?: number;
  }): Promise<CellBlock[]> {
    console.log("calling findBlocks with params:", params);

    // Start building the query
    let query = this.supabase
      .from("blocks")
      .select("*")
      .eq("type", BlockTypeEnum.CELL) // Base filter 1: Must be a cell
      .is("deleted_at", null); // Base filter 2: Must not be deleted

    let actualRowIdsToFilter: string[] | null = null;

    // --- Logic to determine the actual row IDs to filter by ---
    if (params.rowIds && params.rowIds.length > 0) {
      const containsWildcard = params.rowIds.includes("*");
      const specificRowIds = params.rowIds.filter(
        (id) => id !== "*" && typeof id === "string"
      ) as string[];

      if (containsWildcard && specificRowIds.length === 0) {
        console.log("rowIds contains only '*', fetching all rows for sheet.");
        const rows = await this.getRowsBySheetId(params.sheetId);
        actualRowIdsToFilter = rows.map((r) => r.id);
      } else if (specificRowIds.length > 0) {
        console.log("Filtering by specific rowIds:", specificRowIds);
        actualRowIdsToFilter = specificRowIds;
      } else {
        console.warn(
          "rowIds was provided but empty after filtering '*', fetching all rows."
        );
        const rows = await this.getRowsBySheetId(params.sheetId);
        actualRowIdsToFilter = rows.map((r) => r.id);
      }
    } else {
      console.log("No rowIds provided, fetching all rows for sheet.");
      const rows = await this.getRowsBySheetId(params.sheetId);
      actualRowIdsToFilter = rows.map((r) => r.id);
    }

    // Apply the parent_id filter (ANDed with base filters)
    if (actualRowIdsToFilter && actualRowIdsToFilter.length > 0) {
      console.log("Applying filter for parent_id IN:", actualRowIdsToFilter);
      query = query.in("parent_id", actualRowIdsToFilter);
    } else {
      // If no rows belong to the sheet, no cells can match.
      console.log("No relevant rows found for the sheet, returning empty.");
      return [];
    }

    // *** FIX: Create a flat array of OR conditions ***
    const orConditions: string[] = [];

    // Add column filter conditions if provided
    if (params.columnIds && params.columnIds.length > 0) {
      console.log("Preparing column filter for:", params.columnIds);

      // Add each column name as a separate condition
      params.columnIds.forEach((columnName) => {
        orConditions.push(`properties->column->>name.eq.${columnName}`);
      });
    }

    // Add keyword filter conditions if provided
    if (params.contentKeywords && params.contentKeywords.length > 0) {
      console.log("Preparing keyword filters for:", params.contentKeywords);

      // Add each keyword as a separate condition
      params.contentKeywords.forEach((kw) => {
        orConditions.push(`properties->>value.ilike.%${kw}%`);
      });
    }

    // *** FIX: Apply the OR conditions as a single comma-separated string ***
    if (orConditions.length > 0) {
      const orFilterString = orConditions.join(",");
      console.log("Applying OR filters:", orFilterString);
      query = query.or(orFilterString);
    }

    // Apply limit
    if (params.limit) {
      console.log("Applying limit:", params.limit);
      query = query.limit(params.limit);
    }

    console.log("Executing Supabase query structure:", query);

    // Execute the query and print detailed results/errors
    const { data, error } = await query;

    if (error) {
      console.error("Error finding blocks during query execution:", error);
      console.error(
        "Supabase error details:",
        error.message,
        error.details,
        error.hint,
        error.code
      );
      throw error;
    }

    console.log("Queried data count in findBlocks:", data?.length ?? 0);
    if (data && data.length > 0) {
      console.log("Sample cell data:", {
        id: data[0].id,
        parent_id: data[0].parent_id,
        type: data[0].type,
        // Show a preview of properties to help debug
        properties: data[0].properties
          ? JSON.stringify(data[0].properties).substring(0, 100) + "..."
          : null
      });
    } else {
      console.log("No matching cells found. This could be because:");
      console.log("1. There are no cells with the specified keywords");
      console.log(
        "2. Column names might not match - expected:",
        params.columnIds
      );

      // To help debug, let's fetch a sample cell to see its structure
      try {
        const sampleCell = await this.supabase
          .from("blocks")
          .select("*")
          .eq("type", BlockTypeEnum.CELL)
          .is("deleted_at", null)
          .in("parent_id", actualRowIdsToFilter.slice(0, 1))
          .limit(1)
          .single();

        if (sampleCell.data) {
          console.log("Sample cell structure for debugging:", {
            id: sampleCell.data.id,
            parent_id: sampleCell.data.parent_id,
            properties: sampleCell.data.properties
          });
          console.log(
            "Column structure in sample cell:",
            sampleCell.data.properties
          );
        } else {
          console.log("No sample cell found to examine structure");
        }
      } catch (e) {
        console.log("Error fetching sample cell:", e);
      }
    }

    return (data || []) as CellBlock[];
  }

  // Add other methods like softDeleteBlock, updateCell etc. adapting from the reference if needed
}

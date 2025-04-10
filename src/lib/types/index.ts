// src/lib/types/index.ts

export enum BlockTypeEnum {
  SHEET = "SHEET",
  ROW = "ROW",
  COLUMN = "COLUMN",
  CELL = "CELL"
}

// Base Block structure matching Supabase schema
export interface Block {
  id: string;
  type: BlockTypeEnum;
  parent_id: string | null;
  organization_id: string;
  properties: Record<string, any>;
  content: string | string[] | null; // Allow string array for content
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// Specific Block types (examples)
export interface SheetBlock extends Block {
  type: BlockTypeEnum.SHEET;
  properties: {
    title: string;
  };
  content: string[]; // Array of row IDs
}

export interface RowBlock extends Block {
  type: BlockTypeEnum.ROW;
  // properties might hold row-specific metadata if needed
}

export interface ColumnBlock extends Block {
  type: BlockTypeEnum.COLUMN;
  properties: {
    name: string;
    type: string; // e.g., 'text', 'number', 'sentiment'
    position: number;
    width?: number;
  };
}

export interface CellBlock extends Block {
  type: BlockTypeEnum.CELL;
  properties: {
    value: any; // The actual cell content
    column: {
      id: string;
      name?: string; // Denormalized for convenience?
      column_type?: string;
    };
    // Optional: AI-related fields if applicable
    status?: "idle" | "processing" | "completed" | "error";
    error?: string;
    research?: any; // From original example
  };
}

// API Types
export interface MatrixQARequest {
  query: string;
  sheetId: string;
  conversationId?: string; // For multi-turn
}

export interface MatrixQAResponse {
  answer: string;
  citations: { blockId: string; contentSnippet?: string }[]; // Include snippet for UI hints
  conversationId: string;
  steps?: string[]; // Optional: Agent reasoning steps
}

// Agent Evidence Type
export interface Evidence {
  blockId: string;
  content: string;
  rowId: string;
  columnId: string;
  sheetId: string; // Add sheetId for context
  metadata?: Record<string, any>; // Other relevant info
}

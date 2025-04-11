// src/app/(main)/sheet/[sheetId]/page.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { notFound } from "next/navigation";
import { BlockService } from "@/lib/services/BlockService";
import { SheetGrid } from "@/components/sheet/SheetGrid";
import { QAChatInterface } from "@/components/qa/QAChatInterface";
import { CellBlock, RowBlock, ColumnBlock, SheetBlock } from "@/lib/types";

interface SheetData {
  sheet: SheetBlock;
  columns: ColumnBlock[];
  rows: RowBlock[];
  cells: CellBlock[][];
}

async function getSheetData(
  sheetId: string,
  orgId: string
): Promise<SheetData | null> {
  const blockService = new BlockService();
  try {
    const [sheetResult, columnsResult, rowsResult] = await Promise.all([
      blockService.getBlock(sheetId),
      blockService.getColumnsBySheetId(sheetId),
      blockService.getRowsBySheetId(sheetId)
    ]);

    const sheet = sheetResult as unknown as SheetBlock;
    if (!sheet || sheet.type !== "SHEET" || sheet.organization_id !== orgId) {
      console.warn(
        `Sheet not found or invalid: ${sheetId}, Org: ${orgId}`,
        sheet
      );
      return null;
    }

    const columns = columnsResult as ColumnBlock[];
    const rows = rowsResult as RowBlock[];

    const cellPromises = rows.map((row: RowBlock) =>
      blockService.getCellsByRowId(row.id)
    );
    const cellsByRowArrays = await Promise.all(cellPromises);

    const sortedColumns = [...columns].sort(
      (a, b) => (a.properties?.position ?? 0) - (b.properties?.position ?? 0)
    );

    const cellsByRowMap = new Map<string, Map<string, CellBlock>>();
    rows.forEach((row, index) => {
      const rowCells = cellsByRowArrays[index] || [];
      const cellMap = new Map<string, CellBlock>();
      rowCells.forEach((cell: CellBlock) => {
        if (cell.properties?.column?.id) {
          cellMap.set(cell.properties.column.id, cell);
        }
      });
      cellsByRowMap.set(row.id, cellMap);
    });

    const gridCells: CellBlock[][] = rows.map((row) => {
      const rowCellMap = cellsByRowMap.get(row.id);
      if (!rowCellMap) return [];
      return sortedColumns.map((col) => rowCellMap.get(col.id) as CellBlock);
    });

    return { sheet, columns: sortedColumns, rows, cells: gridCells };
  } catch (error) {
    console.error(`Error fetching data for sheet ${sheetId}:`, error);
    throw error;
  }
}

export default function SheetPage({ params }: { params: { sheetId: string } }) {
  const { sheetId } = params;
  const orgId = "rc_org_1";

  const [sheetData, setSheetData] = useState<SheetData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlightedCell, setHighlightedCell] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      setError(null);
      setHighlightedCell(null);
      try {
        const data = await getSheetData(sheetId, orgId);
        if (!data) {
          setError("Sheet not found or access denied.");
        } else {
          setSheetData(data);
        }
      } catch (err: any) {
        console.error("Client-side fetch error:", err);
        setError(`Failed to load sheet data: ${err.message}`);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [sheetId, orgId]);

  const handleCitationClick = useCallback((blockId: string) => {
    setHighlightedCell(blockId);

    setTimeout(() => {
      const element = document.getElementById(`cell-${blockId}`);
      if (element) {
        element.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "center"
        });
        element.classList.add("flash-highlight");
        setTimeout(() => {
          element.classList.remove("flash-highlight");
        }, 1500);
      }
    }, 100);
  }, []);

  if (isLoading) {
    return (
      <div className='flex justify-center items-center min-h-screen bg-[#121212] text-gray-300'>
        Loading sheet data...
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex justify-center items-center min-h-screen bg-[#121212] text-red-400'>
        Error: {error}
      </div>
    );
  }

  if (!sheetData) {
    notFound();
  }

  const { sheet, columns, rows, cells } = sheetData;

  return (
    <div className='flex flex-col h-screen overflow-hidden bg-[#121212] text-gray-200'>
      {/* Header with title */}
      <div className='p-4 border-b border-[#2d2d2d] bg-[#1a1a1a]'>
        <h2 className='text-xl font-semibold text-white'>
          {sheet.properties?.title || "Sheet"}
        </h2>
      </div>

      {/* Main content area with fixed height */}
      <div className='flex-grow grid grid-cols-1 lg:grid-cols-3 gap-4 p-4 h-[calc(100vh-64px)] overflow-hidden'>
        {/* Sheet Grid with fixed height */}
        <div className='lg:col-span-2 h-full overflow-hidden flex flex-col'>
          <SheetGrid
            columns={columns}
            rows={rows}
            cells={cells}
            highlightedCell={highlightedCell}
          />
        </div>

        {/* QA Chat with fixed height */}
        <div className='lg:col-span-1 h-full overflow-hidden'>
          <QAChatInterface
            sheetId={sheetId}
            onCitationClick={handleCitationClick}
          />
        </div>
      </div>
    </div>
  );
}

// src/app/(main)/sheet/[sheetId]/page.tsx
"use client"; // Ensure this is a Client Component

import { useState, useEffect, useCallback } from "react"; // Added useCallback
import { notFound } from "next/navigation";
import { BlockService } from "@/lib/services/BlockService";
import { SheetGrid } from "@/components/sheet/SheetGrid";
import { QAChatInterface } from "@/components/qa/QAChatInterface";
import { CellBlock, RowBlock, ColumnBlock, SheetBlock } from "@/lib/types";

// Define the structure of the data fetched server-side
interface SheetData {
  sheet: SheetBlock;
  columns: ColumnBlock[];
  rows: RowBlock[];
  cells: CellBlock[][]; // 2D array matching rows and sorted columns
}

// Fetch data function (can run server-side initially or client-side in useEffect)
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
      return sortedColumns.map(
        (col) => rowCellMap.get(col.id) as CellBlock // May be undefined
      );
    });

    return { sheet, columns: sortedColumns, rows, cells: gridCells }; // Return sorted columns
  } catch (error) {
    console.error(`Error fetching data for sheet ${sheetId}:`, error);
    // Re-throw or handle as appropriate for server/client context
    throw error; // Re-throwing allows catching in useEffect
  }
}

export default function SheetPage({ params }: { params: { sheetId: string } }) {
  const { sheetId } = params;
  const orgId = "rc_org_1"; // Replace with dynamic org ID if needed

  const [sheetData, setSheetData] = useState<SheetData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlightedCell, setHighlightedCell] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      setError(null);
      setHighlightedCell(null); // Reset highlight on new load
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

  // Use useCallback to memoize the handler function
  const handleCitationClick = useCallback((blockId: string) => {
    console.log("Handling citation click for:", blockId);
    setHighlightedCell(blockId); // Update state

    // Scroll after a short delay to allow the grid to potentially re-render
    // with the highlight applied and the element definitely present.
    setTimeout(() => {
      const element = document.getElementById(`cell-${blockId}`);
      if (element) {
        console.log("Scrolling to element:", element);
        element.scrollIntoView({
          behavior: "smooth",
          block: "center", // 'nearest', 'center', 'start', 'end'
          inline: "center" // 'nearest', 'center', 'start', 'end'
        });
        // Optional: Add a brief visual flash effect (independent of state highlight)
        element.classList.add("flash-highlight");
        setTimeout(() => {
          element.classList.remove("flash-highlight");
        }, 1500); // Duration of the flash
      } else {
        console.warn(
          `Element with ID cell-${blockId} not found for scrolling.`
        );
      }
    }, 100); // Small delay (adjust if needed)
  }, []); // Empty dependency array means this function is created once

  if (isLoading) {
    return (
      <div className='flex justify-center items-center min-h-screen'>
        Loading sheet data...
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex justify-center items-center min-h-screen text-red-500'>
        Error: {error}
      </div>
    );
  }

  if (!sheetData) {
    // This case implies !isLoading and !error but no data, likely the not found case
    notFound();
  }

  const { sheet, columns, rows, cells } = sheetData;

  return (
    // Use flex column layout for the whole page, ensuring height is managed
    <div className='flex flex-col h-screen overflow-hidden p-4 md:p-6 lg:p-8'>
      <h2 className='text-2xl font-semibold mb-4 flex-shrink-0'>
        {sheet.properties?.title || "Sheet"}
      </h2>

      {/* Main content area: Grid and Chat */}
      <div className='flex-grow grid grid-cols-1 lg:grid-cols-3 gap-6 overflow-hidden'>
        {/* Sheet Grid Area - Ensure it takes available space and scrolls */}
        <div className='lg:col-span-2 overflow-hidden border rounded-md flex flex-col'>
          {/* The SheetGrid component itself will handle internal scrolling */}
          <SheetGrid
            columns={columns}
            rows={rows}
            cells={cells}
            highlightedCell={highlightedCell} // Pass state down
          />
        </div>

        {/* QA Chat Area - Ensure it takes available space */}
        <div className='lg:col-span-1 flex flex-col h-full'>
          {/* QAChatInterface should manage its own internal layout/scrolling */}
          <QAChatInterface
            sheetId={sheetId}
            onCitationClick={handleCitationClick} // Pass memoized handler down
          />
        </div>
      </div>
    </div>
  );
}

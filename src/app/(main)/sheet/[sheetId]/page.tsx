// "use client";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { BlockService } from "@/lib/services/BlockService";
import { SheetGrid } from "@/components/sheet/SheetGrid";
import { QAChatInterface } from "@/components/qa/QAChatInterface";
import { CellBlock, RowBlock } from "@/lib/types";

// // Revalidate data periodically or on demand
// export const revalidate = 60; // Revalidate every 60 seconds

async function getSheetData(sheetId: string, orgId: string) {
  const blockService = new BlockService();
  try {
    // Fetch sheet, columns, rows, and all cells in parallel
    const [sheet, columns, rows] = await Promise.all([
      blockService.getBlock(sheetId),
      blockService.getColumnsBySheetId(sheetId),
      blockService.getRowsBySheetId(sheetId)
    ]);

    if (!sheet || sheet.type !== "SHEET" || sheet.organization_id !== orgId) {
      return null; // Not found or not authorized
    }

    // Fetch cells for all rows
    const cellPromises = rows.map((row: RowBlock) =>
      blockService.getCellsByRowId(row.id)
    );
    const cellsByRow = await Promise.all(cellPromises); // Array of cell arrays, one per row

    // Structure cells for the grid component (example: 2D array)
    // Match cells to columns based on column order for the grid
    const sortedColumns = [...columns].sort(
      (a, b) => (a.properties?.position ?? 0) - (b.properties?.position ?? 0)
    );
    const gridCells: CellBlock[][] = rows.map(
      (row: RowBlock, rowIndex: number) => {
        const rowCells = cellsByRow[rowIndex] || [];
        const cellMap = new Map(
          rowCells.map((c: CellBlock) => [c.properties?.column?.id, c])
        );
        return sortedColumns.map((col) => cellMap.get(col.id) as CellBlock); // May contain undefined if cell missing
      }
    );

    return { sheet, columns, rows, cells: gridCells };
  } catch (error) {
    console.error(`Error fetching data for sheet ${sheetId}:`, error);
    return null;
  }
}

export default async function SheetPage({
  params
}: {
  params: { sheetId: string };
}) {
  const { sheetId } = params;
  const orgId = "rc_org_1";

  const data = await getSheetData(sheetId, orgId);

  if (!data) {
    notFound(); // Render 404 page
  }

  const { sheet, columns, rows, cells } = data;

  // Client-side state for highlighting
  // This needs to be handled in a client component wrapper
  // For simplicity, we pass a dummy handler here.
  // In a real app, SheetGrid and QAChatInterface would likely be wrapped
  // in a parent client component managing the highlightedCell state.
  const handleCitationClick = (blockId: string) => {
    console.log("Citation clicked:", blockId);
    // In a client component: setHighlightedCell(blockId);
    // Find the element and scroll to it
    const element = document.getElementById(`cell-${blockId}`);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    // Temporary highlight effect (better done with state)
    element?.classList.add("bg-yellow-200", "ring-2", "ring-yellow-400");
    setTimeout(() => {
      element?.classList.remove("bg-yellow-200", "ring-2", "ring-yellow-400");
    }, 2000);
  };

  return (
    <div className='space-y-6'>
      <h2 className='text-2xl font-semibold'>
        {/* @ts-ignore */}
        {data.sheet.properties?.title || "Sheet"}
      </h2>

      {/* Wrap Grid and Chat in a Client Component if state needed */}
      {/* <SheetDisplayWrapper sheetId={sheetId} initialData={data} /> */}

      {/* Direct rendering for simplicity */}
      <div className='lg:grid lg:grid-cols-3 lg:gap-6'>
        <div className='lg:col-span-2'>
          <SheetGrid
            columns={columns}
            rows={rows}
            cells={cells}
            // highlightedCell={highlightedCell} // State managed by wrapper
          />
        </div>
        <div className='lg:col-span-1 mt-6 lg:mt-0'>
          {/* <QAChatInterface
            sheetId={sheetId}
            onCitationClick={handleCitationClick} // Pass handler down
          /> */}
        </div>
      </div>
    </div>
  );
}

// src/components/sheet/SheetGrid.tsx
"use client";

import React from "react";
import { CellBlock, ColumnBlock, RowBlock } from "@/lib/types";

interface SheetGridProps {
  columns: ColumnBlock[]; // Expect pre-sorted columns
  rows: RowBlock[];
  cells: CellBlock[][]; // Expect 2D array matching rows and sorted columns
  highlightedCell?: string | null;
}

export const SheetGrid: React.FC<SheetGridProps> = ({
  columns,
  rows,
  cells,
  highlightedCell
}) => {
  if (!columns.length || !rows.length) {
    return (
      <p className='p-4 text-gray-500 dark:text-gray-400'>
        No data to display.
      </p>
    );
  }

  return (
    <div className='flex flex-col h-full w-full overflow-hidden bg-[#1e1e1e] rounded-md'>
      {/* Table wrapper with fixed header and scrollable body */}
      <div className='flex-1 overflow-hidden'>
        <div className='overflow-auto h-full'>
          <table className='min-w-full border-collapse'>
            <thead className='bg-[#252525] sticky top-0 z-10'>
              <tr>
                <th className='sticky left-0 bg-[#252525] px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider border-b border-[#2d2d2d] z-20'>
                  Row
                </th>
                {columns.map((col) => (
                  <th
                    key={col.id}
                    scope='col'
                    className='px-3 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider border-b border-[#2d2d2d] whitespace-nowrap'
                    style={{ minWidth: col.properties?.width || 150 }}
                  >
                    {col.properties?.name || col.id}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className='bg-[#1e1e1e] divide-y divide-[#2d2d2d]'>
              {rows.map((row, rowIndex) => (
                <tr key={row.id} className='hover:bg-[#252525]'>
                  <td className='sticky left-0 bg-[#1e1e1e] hover:bg-[#252525] px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-300 border-b border-[#2d2d2d] z-10'>
                    {row.properties?.name || `${rowIndex + 1}`}
                  </td>
                  {columns.map((col, colIndex) => {
                    const cell = cells[rowIndex]?.[colIndex];
                    const cellId = cell?.id;
                    const isHighlighted =
                      !!cellId &&
                      !!highlightedCell &&
                      cellId === highlightedCell;

                    return (
                      <td
                        key={`${row.id}-${col.id}`}
                        id={cellId ? `cell-${cellId}` : undefined}
                        className={`px-3 py-2 text-sm text-gray-300 border-b border-[#2d2d2d] align-top whitespace-normal transition-colors duration-200 ease-in-out ${
                          isHighlighted ? "bg-purple-900 bg-opacity-30" : ""
                        }`}
                      >
                        {cell?.properties?.value?.toString() ?? ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

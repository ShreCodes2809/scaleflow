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
  // console.log("SheetGrid rendering, highlightedCell:", highlightedCell); // Keep for debugging

  if (!columns.length || !rows.length) {
    return <p className='p-4 text-gray-500'>No data to display.</p>;
  }

  return (
    <div className='overflow-auto h-full'>
      <table className='min-w-full divide-y divide-gray-200 border border-collapse'>
        <thead className='bg-gray-100 sticky top-0 z-10'>
          <tr>
            <th className='sticky left-0 bg-gray-100 px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase tracking-wider border-r border-b z-20'>
              Row
            </th>
            {columns.map((col) => (
              <th
                key={col.id}
                scope='col'
                className='px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase tracking-wider border-r border-b whitespace-nowrap'
                style={{ minWidth: col.properties?.width || 150 }}
              >
                {col.properties?.name || col.id}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className='bg-white divide-y divide-gray-200'>
          {rows.map((row, rowIndex) => (
            <tr key={row.id} className='hover:bg-gray-50'>
              <td className='sticky left-0 bg-white px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-700 border-r border-b z-10'>
                {row.properties?.name || `${rowIndex + 1}`}
              </td>
              {columns.map((col, colIndex) => {
                const cell = cells[rowIndex]?.[colIndex];
                const cellId = cell?.id;
                const isHighlighted =
                  !!cellId && !!highlightedCell && cellId === highlightedCell;

                // console.log(`Row ${rowIndex}, Col ${colIndex}, Cell ID: ${cellId}, Highlighted: ${isHighlighted}`); // Keep for debugging

                return (
                  <td
                    key={`${row.id}-${col.id}`}
                    id={cellId ? `cell-${cellId}` : undefined}
                    // Apply purple background if highlighted
                    className={`px-3 py-2 text-sm text-gray-800 border-r border-b align-top whitespace-normal transition-colors duration-200 ease-in-out ${
                      // Reduced duration slightly
                      isHighlighted
                        ? "bg-purple-200" // Use desired purple background shade
                        : // Optional: Add a ring for more emphasis if needed
                          // ? "bg-purple-200 ring-2 ring-purple-400 ring-inset"
                          "" // No extra classes if not highlighted
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
  );
};

"use client";

import React from "react";
import { CellBlock, ColumnBlock, RowBlock } from "@/lib/types";

interface SheetGridProps {
  columns: ColumnBlock[];
  rows: RowBlock[];
  cells: CellBlock[][]; // Assuming cells are pre-organized into a 2D array [rowIndex][colIndex]
  highlightedCell?: string | null; // blockId of the cell to highlight
}

export const SheetGrid: React.FC<SheetGridProps> = ({
  columns,
  rows,
  cells,
  highlightedCell
}) => {
  if (!columns.length || !rows.length) {
    return <p>No data to display.</p>;
  }

  // Sort columns by position if not already sorted
  const sortedColumns = [...columns].sort(
    (a, b) => (a.properties?.position ?? 0) - (b.properties?.position ?? 0)
  );

  return (
    <div className='overflow-x-auto'>
      <table className='min-w-full divide-y divide-gray-200 border'>
        <thead className='bg-gray-50'>
          <tr>
            {/* Add a placeholder for row headers/names if needed */}
            <th className='px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r'>
              Row
            </th>
            {sortedColumns.map((col) => (
              <th
                key={col.id}
                scope='col'
                className='px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r'
                style={{ minWidth: col.properties?.width || 150 }} // Apply width
              >
                {col.properties?.name || col.id}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className='bg-white divide-y divide-gray-200'>
          {rows.map((row, rowIndex) => (
            <tr key={row.id}>
              {/* Row header cell */}
              <td className='px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-900 border-r'>
                {row.properties?.name || `Row ${rowIndex + 1}`}
              </td>
              {sortedColumns.map((col, colIndex) => {
                // Find the correct cell based on rowId and columnId
                // This assumes the `cells` prop is structured correctly.
                // A more robust way might be to pass a Map<rowId, Map<colId, CellBlock>>
                const cell = cells[rowIndex]?.find(
                  (c) => c.properties?.column?.id === col.id
                );
                const cellId = cell?.id;
                const isHighlighted = cellId === highlightedCell;

                return (
                  <td
                    key={`${row.id}-${col.id}`}
                    className={`px-3 py-2 whitespace-normal text-sm text-gray-700 border-r ${
                      isHighlighted
                        ? "bg-yellow-200 ring-2 ring-yellow-400"
                        : ""
                    } transition-colors duration-300`}
                    id={`cell-${cellId}`} // Add ID for potential scrolling
                  >
                    {/* Render cell value - handle different types if necessary */}
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

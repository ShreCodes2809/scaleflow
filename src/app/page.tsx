// src/app/page.tsx
import Link from "next/link";
import { BlockService } from "@/lib/services/BlockService";
import { SheetBlock } from "@/lib/types";

// Revalidate data periodically or on demand if needed
// export const revalidate = 60; // Revalidate every 60 seconds

async function getSheets(): Promise<SheetBlock[]> {
  const blockService = new BlockService();
  const orgId = "rc_org_1"; // Replace with dynamic org ID if needed
  try {
    const sheets = await blockService.getAllSheetsWithRowCount(orgId);
    return sheets;
  } catch (error) {
    console.error("Error fetching sheets:", error);
    return []; // Return empty array on error
  }
}

export default async function HomePage() {
  const sheets = await getSheets();

  return (
    <div className='container mx-auto p-4 sm:p-8'>
      <h1 className='text-3xl font-bold mb-8 text-center'>
        Raycaster Matrix Agent - Sheets
      </h1>

      {sheets.length === 0 ? (
        <p className='text-center text-gray-500'>
          No sheets found. You can create one via the API or seeding script.
        </p>
      ) : (
        <div className='grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6'>
          {sheets.map((sheet) => (
            <Link
              href={`/sheet/${sheet.id}`}
              key={sheet.id}
              className='block p-0'
            >
              <div className='bg-white border rounded-lg shadow hover:shadow-md transition-shadow duration-200 overflow-hidden h-full flex flex-col'>
                <div className='p-4 flex-grow'>
                  <h2 className='text-lg font-semibold mb-2 truncate'>
                    {sheet.properties?.title || `Sheet ${sheet.id.slice(0, 8)}`}
                  </h2>
                  <p className='text-sm text-gray-500'>
                    ID: {sheet.id.substring(0, 8)}...
                  </p>
                </div>
                <div className='bg-gray-50 px-4 py-2 text-right text-xs text-gray-600 border-t'>
                  {/* @ts-ignore */}
                  {sheet.properties?.rowCount ?? "..."}{" "}
                  {/* @ts-ignore */}
                  {sheet.properties?.rowCount === 1 ? "row" : "rows"}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {/* Optional: Add a button/link to create a new sheet */}
      {/* <div className="mt-8 text-center">
        <button className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
          Create New Sheet (Mock Data)
        </button>
      </div> */}
    </div>
  );
}

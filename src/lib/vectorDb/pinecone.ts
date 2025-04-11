import { Pinecone } from "@pinecone-database/pinecone";

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY || ""
});

const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME || "");

export interface PineconeMetadata {
  blockId: string;
  rowId: string;
  sheetId: string;
  orgId: string;
  contentSnippet: string; // Store a snippet for context
  isRowLevel?: boolean; // Optional flag for row-level embeddings
  columnName?: string; // Optional column name for filtering
  columnIds?: string[]; // Single column ID instead of array
  companyName?: string; // Optional company name for filtering
  country?: string; // Optional country for filtering
  fundingRound?: string; // Optional funding round for filtering
}

export interface PineconeVector {
  id: string; // Use blockId
  values: number[];
  metadata: PineconeMetadata;
}

export async function upsertEmbeddings(vectors: PineconeVector[]) {
  if (!vectors || vectors.length === 0) return;
  try {
    // Batch upserts for efficiency
    const batchSize = 100;
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      await pineconeIndex.upsert(batch as any);
      console.log(`Upserted batch ${i / batchSize + 1}`);
    }
  } catch (error) {
    console.error("Error upserting embeddings to Pinecone:", error);
    throw error;
  }
}

export async function queryEmbeddings(
  embedding: number[],
  filter: Partial<PineconeMetadata> & { columnIds?: string[] }, // Allow columnIds for API compatibility
  topK: number = 5
): Promise<PineconeVector[]> {
  try {
    // Create a proper Pinecone filter
    const pineconeFilter: any = { ...filter };

    // Handle the columnIds special case
    if (pineconeFilter.columnIds) {
      // Instead of trying to match an array field, we'll use an $or condition
      // with individual columnName matches
      if (pineconeFilter.columnIds.length > 0) {
        console.log(
          `Filtering for columns: ${pineconeFilter.columnIds.join(", ")}`
        );

        // For debugging
        console.log("Original filter:", JSON.stringify(pineconeFilter));

        // Option 1: If we stored columnName, we can filter by that
        pineconeFilter.$or = pineconeFilter.columnIds.map(
          (columnId: string) => ({
            columnName: columnId // Using columnName that matches column ID names
          })
        );

        // Option 2: If we're using isRowLevel flag, we can search all row-level embeddings
        // which contain all columns (use only if option 1 doesn't work)
        pineconeFilter.$or = pineconeFilter.$or || [];
        pineconeFilter.$or.push({ isRowLevel: true });

        // Remove the original columnIds
        delete pineconeFilter.columnIds;

        console.log("Modified filter:", JSON.stringify(pineconeFilter));
      } else {
        // If empty column IDs, just remove it
        delete pineconeFilter.columnIds;
      }
    }

    // If no filter conditions remain, provide a minimal filter
    if (Object.keys(pineconeFilter).length === 0) {
      pineconeFilter.sheetId = filter.sheetId; // Always filter by sheet at minimum
    }

    console.log("Final Pinecone query filter:", JSON.stringify(pineconeFilter));

    const queryResponse = await pineconeIndex.query({
      vector: embedding,
      filter: pineconeFilter,
      topK: topK,
      includeMetadata: true,
      includeValues: false // Usually don't need vectors back
    });

    console.log(`Query returned ${queryResponse.matches?.length || 0} matches`);

    return (queryResponse.matches?.map((match) => ({
      id: match.id,
      values: [], // Not requested
      metadata: match.metadata as unknown as PineconeMetadata,
      score: match.score // Include score for debugging
    })) || []) as any;
  } catch (error) {
    console.error("Error querying embeddings from Pinecone:", error);

    // Provide a graceful fallback
    console.log("Attempting fallback query with minimal filter...");
    try {
      // Try with just the sheet ID as filter
      const fallbackFilter = { sheetId: filter.sheetId };
      const fallbackResponse = await pineconeIndex.query({
        vector: embedding,
        filter: fallbackFilter,
        topK: topK,
        includeMetadata: true,
        includeValues: false
      });

      console.log(
        `Fallback query returned ${
          fallbackResponse.matches?.length || 0
        } matches`
      );

      return (fallbackResponse.matches?.map((match) => ({
        id: match.id,
        values: [], // Not requested
        metadata: match.metadata as unknown as PineconeMetadata,
        score: match.score
      })) || []) as any;
    } catch (fallbackError) {
      console.error("Fallback query also failed:", fallbackError);
      // Return empty result instead of throwing
      return [];
    }
  }
}

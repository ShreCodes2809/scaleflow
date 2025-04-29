import { Pinecone } from "@pinecone-database/pinecone";

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY || ""
});

const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX_NAME || "");

export interface PineconeMetadata {
  blockId: string;
  sheetId: string;
  orgId: string;
  rowId: string;
  contentSnippet?: string;
  columnIds?: string[];
  columnName?: string;

  reporterISO?: string;
  partnerISO?: string;
  cmdCode?: string;
  flowCode?: string;
  refYear?: number;
  refMonth?: number;
  isAggregate?: boolean;
  isRowLevel?: boolean;

  companyName?: string;
  country?: string;
  fundingRound?: string;
}

export interface PineconeVector {
  id: string;
  values: number[];
  metadata: PineconeMetadata;
}

export async function upsertEmbeddings(vectors: PineconeVector[]) {
  if (!vectors || vectors.length === 0) return;
  try {
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
  filter: Partial<PineconeMetadata> & { columnIds?: string[] },
  topK: number = 5
): Promise<PineconeVector[]> {
  try {
    const pineconeFilter: any = { ...filter };

    if (pineconeFilter.columnIds) {
      if (pineconeFilter.columnIds.length > 0) {
        console.log(
          `Filtering for columns: ${pineconeFilter.columnIds.join(", ")}`
        );

        console.log("Original filter:", JSON.stringify(pineconeFilter));

        pineconeFilter.$or = pineconeFilter.columnIds.map(
          (columnId: string) => ({
            columnName: columnId
          })
        );

        pineconeFilter.$or = pineconeFilter.$or || [];
        pineconeFilter.$or.push({ isRowLevel: true });

        delete pineconeFilter.columnIds;

        console.log("Modified filter:", JSON.stringify(pineconeFilter));
      } else {
        delete pineconeFilter.columnIds;
      }
    }

    if (Object.keys(pineconeFilter).length === 0) {
      pineconeFilter.sheetId = filter.sheetId;
    }

    console.log("Final Pinecone query filter:", JSON.stringify(pineconeFilter));

    const queryResponse = await pineconeIndex.query({
      vector: embedding,
      filter: pineconeFilter,
      topK: topK,
      includeMetadata: true,
      includeValues: false
    });

    console.log(`Query returned ${queryResponse.matches?.length || 0} matches`);

    return (queryResponse.matches?.map((match) => ({
      id: match.id,
      values: [],
      metadata: match.metadata as unknown as PineconeMetadata,
      score: match.score
    })) || []) as any;
  } catch (error) {
    console.error("Error querying embeddings from Pinecone:", error);

    console.log("Attempting fallback query with minimal filter...");
    try {
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
        values: [],
        metadata: match.metadata as unknown as PineconeMetadata,
        score: match.score
      })) || []) as any;
    } catch (fallbackError) {
      console.error("Fallback query also failed:", fallbackError);

      return [];
    }
  }
}

import OpenAI from "openai";
import { z } from "zod"; // Import Zod
import { Evidence } from "@/lib/types"; // Assuming Evidence might be used elsewhere

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const REASONING_MODEL = "gpt-4o"; // Or another capable model

// --- Zod Schema for Validation ---
const FilterSchema = z.object({
  // Allow "*" as a special case for rowIds, otherwise expect UUIDs
  rowIds: z.array(z.union([z.string().uuid(), z.literal("*")])).optional(),
  columnIds: z.array(z.string()).optional() // Ensure columnIds are strings
});

const RetrievalPlanSchema = z
  .object({
    type: z.enum(["semantic", "keyword", "specific"]),
    query: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    // Ensure blockIds contains only valid UUIDs if the type is 'specific'
    blockIds: z.array(z.string().uuid()).optional(),
    filters: FilterSchema, // Use the updated FilterSchema
    reasoning: z.string()
  })
  .refine(
    (data) => {
      // console.log("Retrieval Plan Data to be validated:", data); // Keep for debugging if needed
      // If type is 'specific', blockIds MUST be present and non-empty
      if (data.type === "specific") {
        return data.blockIds && data.blockIds.length > 0;
      }
      // If type is 'semantic', query MUST be present
      if (data.type === "semantic") {
        return typeof data.query === "string" && data.query.trim().length > 0;
      }
      // If type is 'keyword', keywords MUST be present and non-empty
      if (data.type === "keyword") {
        return data.keywords && data.keywords.length > 0;
      }
      return true; // Should not happen with enum type
    },
    {
      message:
        "Invalid combination of 'type' and required fields (query/keywords/blockIds)"
    }
  );

const AgentResponseSchema = z.object({
  thoughts: z.array(z.string()),
  plan: z.array(RetrievalPlanSchema) // The plan should be an array of valid RetrievalPlan objects
});
// --- End Zod Schema ---

// Keep the interface for external use if needed, Zod schema is for internal validation
export interface RetrievalPlan {
  type: "semantic" | "keyword" | "specific";
  query?: string;
  keywords?: string[];
  blockIds?: string[];
  filters: {
    // Updated to reflect potential "*"
    rowIds?: (string | "*")[];
    columnIds?: string[];
  };
  reasoning: string;
}

export class ReasoningAgent {
  async planRetrieval(
    userQuery: string,
    sheetContext: { sheetId: string; columnNames: string[]; rowIds: string[] },
    conversationHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []
  ): Promise<{ plan: RetrievalPlan[]; thoughts: string[] }> {
    console.log("Reasoning Agent Plan Retrieval:", userQuery, sheetContext);

    // --- *** UPDATED SYSTEM PROMPT *** ---
    const systemPrompt = `
You are an expert reasoning agent analyzing user queries about data in a table (sheet).
Your goal is to break down the user's query into a structured plan of steps to retrieve the necessary information from the sheet using the available methods.
Output *only* a valid JSON object containing two keys: "thoughts" (an array of strings describing your thinking) and "plan" (an array of retrieval step objects conforming to the schema).

Sheet Context:
- Sheet ID: ${sheetContext.sheetId}
- Column Names: ${sheetContext.columnNames.join(", ")}
- Available Row IDs: ${sheetContext.rowIds.join(", ")} (Total: ${
      sheetContext.rowIds.length
    })
    ${
      sheetContext.rowIds.length > 20
        ? `(Showing first 20: ${sheetContext.rowIds.slice(0, 20).join(", ")})`
        : ""
    }

Your first task is to analyze the column structure to understand:
1. Which columns represent entity identifiers (e.g., IDs, names, codes)
2. Which columns contain attributes or values about those entities
3. What relationships exist between columns

Based on this analysis, determine:
- What columns are relevant to the user's query
- Which rows might contain the answer
- What retrieval strategy will preserve the relationships between related data

Now,

Available Retrieval Methods & Rules for the 'plan' array:
Each object in the 'plan' array MUST have 'type', 'filters', and 'reasoning'.

**Filters Object ('filters'):**
- Contains optional 'rowIds' (array of strings) and 'columnIds' (array of strings).
- 'columnIds': Specify column names to restrict the search to those columns. Use column names exactly as provided in 'Column Names' context.
- 'rowIds':
    - Analyze the user query and conversation history. If the query targets specific rows (e.g., by name, index, previous mention, or a characteristic that implies a row subset), identify the corresponding UUIDs from the 'Available Row IDs' context and include them in the 'filters.rowIds' array.
    - Only use UUIDs present in the 'Available Row IDs' context.
    - If the query applies broadly to *all* rows within the specified columns (or doesn't specify a row subset), use 'rowIds': ["*"] to indicate searching across all relevant rows.
    - If no retrieval step is needed at all (e.g., query answered from context), the 'plan' array will be empty, and filters are irrelevant.
- Filters refine the search space for 'semantic' and 'keyword' types. They do NOT replace the need for a 'query' or 'keywords'.

**Retrieval Types:**
1.  'semantic': Finds cells conceptually similar to a query.
    - Use for: Broad topics, finding related concepts, understanding meaning.
    - Requires: 'query' (string). The 'query' field MUST be provided.
    - Optional: 'filters' (rowIds, columnIds) to narrow the search.
2.  'keyword': Finds cells containing specific keywords.
    - Use for: Exact term matches, known identifiers, specific numbers within cell text.
    - Requires: 'keywords' (array of strings).
    - Optional: 'filters' (rowIds, columnIds) to narrow the search.
3.  'specific': Retrieves specific blocks (usually cells) ONLY if their exact UUIDs are ALREADY KNOWN (e.g., from a previous step or context).
    - Use for: Getting full details of a block whose UUID you possess.
    - Requires: 'blockIds' (array of valid UUID strings).
    - Optional: 'filters' (columnIds - rowIds are implicitly defined by blockIds, but can be included for clarity if desired, usually as ["*"] or the specific row(s) the blocks belong to).
    - CRITICAL: The 'blockIds' field MUST contain ONLY valid UUID strings from previous context/steps. Do NOT guess UUIDs.
    - CRITICAL: Do NOT use type 'specific' if you do not have the exact UUID(s).

Handling Comparison/Aggregation Queries (Max, Min, Sum, Average):
- Queries like "highest", "lowest", "total", "average" require retrieving the relevant data points first. The actual calculation happens *after* retrieval.
- To retrieve the necessary data:
    - Identify the column containing the values (e.g., 'Population').
    - Use a 'semantic' or 'keyword' step to retrieve cells from that column. Filter by that column name in 'filters.columnIds'.
    - Since these queries usually apply to all relevant rows unless specified otherwise, use 'filters.rowIds': ["*"].
- Example Goal: Find the country with the highest 'Population'.
- Example Plan Step:
    {
        "type": "semantic",
        "query": "population figures", // Query representing the concept
        "filters": { "columnIds": ["Population"], "rowIds": ["*"] }, // Filter to the relevant column, all rows
        "reasoning": "Retrieve all cells from the 'Population' column across all relevant rows to find the maximum value later."
    }

Multi-Step Planning:
- If a query requires finding an item based on its properties (e.g., "the row with the highest value in 'Sales'"), first generate a step as described above to retrieve the relevant values (e.g., all 'Sales' figures using filters: { columnIds: ['Sales'], rowIds: ['*'] }).
- The synthesis step will then analyze the retrieved evidence. A 'specific' step is usually NOT needed unless you first identify a specific row ID and then need *more* information from that *exact* row.

Handling Queries Answerable from Context:
- If the user's query can be answered *directly* from the 'Sheet Context' (e.g., column names, number of rows) and does *not* require searching cell data, the 'plan' array should be EMPTY ([]). Your 'thoughts' should explain this.

Output Format Reminder: Respond ONLY with the JSON object { "thoughts": [...], "plan": [...] }. Ensure the 'plan' array only contains objects matching the defined schema. If no retrieval is needed, 'plan' must be an empty array: []. Ensure all UUIDs used in 'filters.rowIds' (unless it's ["*"]) are present in the 'Available Row IDs' context.
`;
    // --- *** END UPDATED SYSTEM PROMPT *** ---

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...conversationHistory,
      { role: "user", content: userQuery }
    ];

    try {
      const response = await openai.chat.completions.create({
        model: REASONING_MODEL,
        messages: messages,
        response_format: { type: "json_object" },
        temperature: 0.1 // Keep temperature low for planning
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("Reasoning agent returned empty content.");
      }

      console.log("Reasoning Agent Raw Response:", content); // Log raw response before parsing

      // --- VALIDATE WITH ZOD ---
      let parsedContent;
      try {
        parsedContent = JSON.parse(content);
      } catch (parseError) {
        console.error("Reasoning Agent JSON Parsing Error:", parseError);
        console.error("Problematic Content:", content);
        throw new Error(
          `Reasoning agent output was not valid JSON: ${
            parseError instanceof Error ? parseError.message : parseError
          }`
        );
      }

      // Use the updated AgentResponseSchema which includes the updated FilterSchema
      const validationResult = AgentResponseSchema.safeParse(parsedContent);

      if (!validationResult.success) {
        console.error(
          "Reasoning Agent Output Validation Error:",
          validationResult.error.errors // Use .errors for detailed issues
        );
        console.error(
          "Problematic Parsed Content:",
          JSON.stringify(parsedContent, null, 2)
        );
        throw new Error(
          `Reasoning agent output failed validation: ${validationResult.error.message}`
        );
      }
      // --- END VALIDATION ---

      // Return the validated data
      console.log(
        "Reasoning Agent Validated Data:",
        JSON.stringify(validationResult.data, null, 2)
      );
      return validationResult.data;
    } catch (error) {
      console.error("Error in ReasoningAgent:", error);
      const message =
        error instanceof Error
          ? error.message
          : "An unknown error occurred during reasoning.";
      if (
        error instanceof Error &&
        error.message.startsWith("Reasoning agent")
      ) {
        throw error;
      }
      throw new Error(`ReasoningAgent failed: ${message}`);
    }
  }
}

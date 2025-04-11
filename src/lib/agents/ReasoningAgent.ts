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

    // --- *** UPDATED SYSTEM PROMPT WITH IMPROVED COLUMN UNDERSTANDING *** ---
    const systemPrompt = `
You are an expert reasoning agent analyzing user queries about data in a table (sheet).
Your goal is to break down the user's query into a structured plan of steps to retrieve the necessary information from the sheet using the available methods.
Output *only* a valid JSON object containing two keys: "thoughts" (an array of strings describing your thinking) and "plan" (an array of retrieval step objects conforming to the schema).

Sheet Context:
- Sheet ID: ${sheetContext.sheetId}
- Column Names: ${sheetContext.columnNames.join(", ")}
- Available Row IDs: ${
      sheetContext.rowIds.length > 0
        ? `${sheetContext.rowIds.length} rows available`
        : "No rows available"
    }
${
  sheetContext.rowIds.length > 0
    ? `(First row ID sample: ${sheetContext.rowIds[0]})`
    : ""
}

IMPORTANT COLUMN STRUCTURE UNDERSTANDING:
Based on the column names, here's how to interpret the data:
- "Product Portfolios": The type of product or service category (e.g., "Research")
- "URL": Website link for the company
- "Company": Company name (e.g., "Company One", "Company Two")
- "Country": Country code where the company is located (e.g., "USA", "CAN")
- "Web Traffic": Numeric value indicating website visitors
- "People Count": Numeric value showing number of employees
- "Total Raised": Numeric value of funding raised (in currency)
- "Last Funding Round": Type of funding round (e.g., "SEED", "SERIES_A")
- "Base Data": Additional metadata

For queries about funding, trends, maximums, or minimums, focus on:
- "Total Raised" for funding amount questions
- "Last Funding Round" for funding stage questions
- "People Count" for team size questions
- "Web Traffic" for visitor metrics

Your first task is to analyze the column structure to understand:
1. Which columns represent entity identifiers (e.g., Company, URL)
2. Which columns contain numeric values (e.g., Total Raised, People Count, Web Traffic)
3. Which columns contain categorical data (e.g., Country, Last Funding Round)

Available Retrieval Methods & Rules for the 'plan' array:
Each object in the 'plan' array MUST have 'type', 'filters', and 'reasoning'.

**Filters Object ('filters'):**
- Contains optional 'rowIds' (array of strings) and 'columnIds' (array of strings).
- 'columnIds': Specify column names to restrict the search to those columns. Use column names exactly as provided in 'Column Names' context.
- 'rowIds':
    - For most queries, especially those about maximums, minimums, or trends, use 'rowIds': ["*"] to search across ALL rows.
    - If the query targets specific rows (e.g., by name, index, previous mention), identify the corresponding UUIDs and include them.
    - If the query applies broadly to all rows, use 'rowIds': ["*"].

**Retrieval Types:**
1.  'semantic': Finds cells conceptually similar to a query.
    - Use for: Broad topics, finding related concepts, understanding meaning.
    - Requires: 'query' (string). The 'query' field MUST be provided.
    - Optional: 'filters' (rowIds, columnIds) to narrow the search.
2.  'keyword': Finds cells containing specific keywords.
    - Use for: Exact term matches, known identifiers, specific numbers within cell text.
    - Requires: 'keywords' (array of strings).
    - Optional: 'filters' (rowIds, columnIds) to narrow the search.
3.  'specific': Retrieves specific blocks (usually cells) ONLY if their exact UUIDs are ALREADY KNOWN.
    - Use for: Getting full details of a block whose UUID you possess.
    - Requires: 'blockIds' (array of valid UUID strings).
    - Optional: 'filters' (columnIds - rowIds are implicitly defined by blockIds).
    - CRITICAL: The 'blockIds' field MUST contain ONLY valid UUID strings from previous context/steps.

CRITICAL FOR NUMERICAL QUERIES (MAX/MIN/TRENDS):
- For questions about "maximum", "highest", "top", "largest", "minimum", "lowest", etc.:
  1. ALWAYS use rowIds: ["*"] to retrieve ALL rows
  2. Include ALL relevant columns that might contain the values
  3. For funding related queries, ALWAYS include "Total Raised" and "Last Funding Round" columns
  4. For people/team size queries, ALWAYS include "People Count" and "Company" columns
  5. For traffic metrics, ALWAYS include "Web Traffic" and "Company" columns
  6. For trend analysis, include ALL rows and the relevant column(s)

- Example for "company with highest funding":
  {
    "type": "semantic",
    "query": "company funding amounts",
    "filters": { 
      "rowIds": ["*"],  // <- CRITICAL: must retrieve ALL rows
      "columnIds": ["Company", "Total Raised", "Last Funding Round"] 
    },
    "reasoning": "Need to retrieve all companies with their funding amounts to find the highest"
  }

- Example for "funding round trends":
  {
    "type": "semantic",
    "query": "funding rounds and amounts for all companies",
    "filters": { 
      "rowIds": ["*"],
      "columnIds": ["Company", "Total Raised", "Last Funding Round"] 
    },
    "reasoning": "Need all funding round data to analyze trends across different rounds"
  }

Output Format Reminder: Respond ONLY with the JSON object { "thoughts": [...], "plan": [...] }.
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

      console.log("Reasoning Agent Raw Response:", content);

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
          validationResult.error.errors
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

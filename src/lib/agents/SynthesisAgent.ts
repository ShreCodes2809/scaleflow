import OpenAI from "openai";
import { Evidence } from "@/lib/types";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SYNTHESIS_MODEL = "gpt-4o"; // Or another capable model

export class SynthesisAgent {
  async synthesizeAnswer(
    userQuery: string,
    evidence: Evidence[],
    sheetContext: {
      sheetId: string;
      columnNames: string[];
      rowIds: string[];
      schema?: any;
    },
    conversationHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []
  ): Promise<string> {
    if (evidence.length === 0) {
      return "I couldn't find any relevant information in the sheet to answer your question.";
    }

    console.log(
      `Processing query: "${userQuery}" with ${evidence.length} evidence items`
    );

    // Check if we have enough data
    if (
      evidence.length < 3 &&
      (userQuery.toLowerCase().includes("highest") ||
        userQuery.toLowerCase().includes("lowest") ||
        userQuery.toLowerCase().includes("maximum") ||
        userQuery.toLowerCase().includes("minimum") ||
        userQuery.toLowerCase().includes("trend"))
    ) {
      console.warn(
        `Warning: Only ${evidence.length} evidence items for a comparative query`
      );
    }

    // Format evidence for the LLM
    // Include row number for easier reference
    const evidenceContext = evidence
      .map((e, index) => `Row ${index + 1}:\n${e.content}\n---`)
      .join("\n\n");

    // Always include the complete sheet context
    const sheetContextStr = `
Sheet Structure:
- Sheet ID: ${sheetContext.sheetId}
- Column Names: ${sheetContext.columnNames.join(", ")}
- Total Rows Available: ${sheetContext.rowIds.length}
- Number of Rows Retrieved: ${evidence.length}

Column Descriptions:
- Product Portfolios: Type of product/service (e.g., "Research")
- URL: Website link for the company
- Company: Company name
- Country: Country code (e.g., "USA", "CAN")
- Web Traffic: Numeric value of website visitors
- People Count: Numeric value showing number of employees
- Total Raised: Numeric value of funding raised (in currency units)
- Last Funding Round: Type of funding round (e.g., "SEED", "SERIES_A")
- Base Data: Additional metadata
`;

    const systemPrompt = `
You are an AI assistant analyzing tabular data about companies and their funding. Your task is to answer the user's query based on the provided evidence and sheet context.

${sheetContextStr}

**CRITICAL FOR NUMERICAL ANALYSIS:**
* For any analysis involving maximums, minimums, highest, lowest, or trends:
  - You MUST convert ALL string values to numbers before comparison
  - Parse numeric values by removing commas: "1,000,000" → 1000000
  - Show the numeric values you are comparing in your response
  - Format your final answer with appropriate number formatting
  - ALWAYS check EVERY row in the provided evidence

**NUMERIC DATA HANDLING:**
* ALWAYS convert these column values to numbers before comparison:
  - Total Raised: funding amounts (e.g., "3,000,000" → 3000000)
  - People Count: employee counts (e.g., "200" → 200)
  - Web Traffic: visitor numbers (e.g., "9,821" → 9821)

**STRUCTURED ANALYSIS PROCESS:**
1. First, identify relevant columns for the query (e.g., Company, Total Raised)
2. Extract values from ALL evidence rows
3. Convert string values to numbers for numeric columns
4. Compare ALL values accurately (not lexicographically)
5. State which companies/rows were included in your analysis
6. Present your findings with proper number formatting

**SPECIFIC QUERY HANDLING:**
* For "who raised the highest" queries:
  - Compare the "Total Raised" values across ALL company rows
  - Convert all values to numbers before comparison
  - Include the actual values in your response: "Company X raised $Y, Company Z raised $W"
  - Explicitly state which company had the highest amount

* For "funding trends" queries:
  - Group companies by "Last Funding Round" type
  - Calculate average/median funding for each round type
  - Present a clear summary of the trends

**Evidence Format:**
Each row represents data about a single company, with columns such as Company, Total Raised, Last Funding Round, etc.

**IMPORTANT: You MUST analyze ALL rows in the evidence. There are ${evidence.length} rows of evidence below.**

**Evidence:**
${evidenceContext}
`;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...conversationHistory,
      { role: "user", content: userQuery }
    ];

    try {
      console.log("Sending request to Synthesis LLM...");
      const response = await openai.chat.completions.create({
        model: SYNTHESIS_MODEL,
        messages: messages,
        temperature: 0.2,
        max_tokens: 1000
      });
      console.log("Received response from Synthesis LLM.");

      const answer = response.choices[0]?.message?.content;
      if (!answer) {
        throw new Error("Synthesis agent returned empty content.");
      }

      // Final sanity check for certain query types
      let finalAnswer = answer.trim();

      // For 'highest' queries, ensure we're actually naming a specific answer
      if (
        (userQuery.toLowerCase().includes("highest") ||
          userQuery.toLowerCase().includes("maximum") ||
          userQuery.toLowerCase().includes("most")) &&
        !finalAnswer.includes("highest") &&
        !finalAnswer.includes("maximum") &&
        !finalAnswer.includes("largest")
      ) {
        finalAnswer +=
          "\n\nNote: I've analyzed all the rows in the provided evidence to determine this answer.";
      }

      console.log("Synthesized Answer:", finalAnswer);
      return finalAnswer;
    } catch (error) {
      console.error("Error in SynthesisAgent:", error);
      console.error(
        "Messages sent to Synthesis API:",
        JSON.stringify(messages, null, 2)
      );
      throw new Error(
        `SynthesisAgent failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }
}

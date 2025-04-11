# Technical Proposal: 
# Raycaster Matrix Agent - QnA Feature

![](https://raw.githubusercontent.com/jaymalave/raycaster-qna/refs/heads/main/public/arch.png)





### Architecture Overview

The system follows a modern web architecture leveraging Next.js for both frontend and backend API routes, Supabase for the primary data store, Pinecone for vector embeddings, OpenAI for LLM reasoning and embeddings, and LangChain with the Vercel AI SDK for streaming synthesis and UI integration.

*   **Frontend (Browser UI):** Built with React and Next.js (`app` router). Uses Tailwind CSS for styling and the Vercel `ai/react` package (`useChat` hook) to handle streaming chat interactions. It displays the sheet data (`SheetGrid`), the chat interface (`QAChatInterface`), and handles citation clicks for highlighting (`SheetPageClient`).
*   **Backend API (`/api/matrix-qa`):** A Next.js API route that serves as the entry point for Q&A requests. It orchestrates the process via the `MatrixQAService`.
*   **Core Service (`MatrixQAService`):** The central orchestrator. It manages conversation state, performs schema analysis, invokes AI agents for reasoning and retrieval, sets up the LangChain streaming synthesis pipeline, and formats the final streaming response with metadata.
*   **AI Agents:**
    *   `ReasoningAgent`: Analyzes the user query, sheet schema, and conversation history to create a multi-step plan for data retrieval.
    *   `RetrievalAgent`: Executes the retrieval plan using semantic search (Pinecone), keyword search (Supabase), or specific ID lookups (Supabase) and consolidates the findings into structured `Evidence`.
    *   `SynthesisAgent`: Synthesizes a final answer based on the user query, retrieved evidence, and conversation history.(Acts as a separate agent for non streaming responses, incorporated in Matrix QA Service post retrieval for streaming responses)
*   **Data Services:**
    *   `BlockService`: Provides an abstraction layer for interacting with the `blocks` table in Supabase (CRUD operations, specialized queries like `findBlocks`).
    *   `EmbeddingService`: Generates text embeddings using the OpenAI API.
*   **Data Stores:**
    *   `Supabase`: PostgreSQL database storing the core block data (Sheets, Rows, Columns, Cells).
    *   `Pinecone`: Vector database storing embeddings of row and cell content for semantic search.
*   **External Services:**
    *   `OpenAI`: Provides LLMs (GPT-4o) for reasoning/synthesis and embedding models.
    *   `Clerk`: Handles user authentication.

## End-to-End Data Flow (Streaming Q&A)

1.  **User Input:** The user types a query into the `QAChatInterface` component.
2.  **Frontend Request:** The `useChat` hook sends a POST request to `/api/matrix-qa` containing the current messages, `sheetId`, and `conversationId`.
3.  **API Route Handling:** The `/api/matrix-qa` route receives the request and instantiates `MatrixQAService`. It calls `processStreamingQuery`.
4.  **Orchestration (`MatrixQAService.processStreamingQuery`):**
    a.  **Conversation State:** Retrieves or initializes conversation state (including history and potentially cached schema) from the in-memory `conversationStore`.
    b.  **Schema Analysis:** If not cached, fetches columns and sample rows via `BlockService` -> Supabase. Infers column types and structure (`SchemaInfo`) and caches it.
    c.  **Reasoning:** Calls `ReasoningAgent.planRetrieval` with the user query, sheet context (including schema), and history. The agent interacts with OpenAI (GPT-4o) to generate a structured `plan` (list of retrieval steps) and `thoughts`.
    d.  **Retrieval:** Calls `RetrievalAgent.retrieveEvidence` with the `plan` and `sheetId`.
        *   The agent iterates through the plan steps.
        *   For `semantic` steps: Generates query embedding via `EmbeddingService` -> OpenAI, queries `Pinecone` with filters, gets block IDs, fetches full cell data via `BlockService` -> Supabase.
        *   For `keyword`/`specific` steps: Uses `BlockService.findBlocks` or `BlockService.getBlock` -> Supabase.
        *   Consolidates retrieved cells into row-based `Evidence` objects, formatting content with `[cell:ID]` markers.
    e.  **Streaming Synthesis Setup(In case of streaming):**
        *   Prepares the consolidated `Evidence` context string.
        *   Initializes LangChain components: `ChatOpenAI` (streaming enabled), `PromptTemplate` (including instructions, evidence, history, query), `StringOutputParser`.
        *   Creates a `RunnableSequence` (the LangChain chain).
        *   Initializes the `LangChainStream` from the Vercel AI SDK, providing handlers.
    f.  **Initiate Streaming:** Invokes the LangChain chain (`chain.invoke`) with the query and evidence context, passing the `LangChainStream` handlers as callbacks. This call *starts* the interaction with the OpenAI streaming API but doesn't wait for it to finish.
    g.  **Metadata Extraction:** Extracts citation details (`blockId`, `contentSnippet`) directly from the `Evidence` objects used for synthesis.
    h.  **Return Stream:** Immediately returns an object containing the `stream` (from `LangChainStream`) and the extracted `metadata` (citations, conversationId, steps) to the API route.
5.  **API Route Response:** The API route constructs a `StreamingTextResponse`, passing the `stream` as the body and encoding the `metadata` into the `X-Metadata` HTTP header as a JSON string.
6.  **Frontend Handling:**
    a.  The `useChat` hook receives the `StreamingTextResponse`.
    b.  It reads the `X-Metadata` header and parses the JSON to get citations and steps.
    c.  It consumes the streaming body chunk by chunk, updating the assistant's message content in the UI (`QAChatInterface`).
    d.  The `QAChatInterface` uses the parsed citations to render `Citation` components inline or alongside the message. Agent steps can also be displayed.
7.  **Citation Interaction:** If the user clicks a `Citation` component:
    a.  The `onClick` handler in `QAChatInterface` calls `onCitationClick` passed down from `SheetPageClient`.
    b.  `SheetPageClient` updates the `highlightedCell` state.
    c.  It scrolls the `SheetGrid` to the corresponding cell (`cell-${blockId}`) and applies a temporary visual highlight (`flash-highlight` CSS class).

## API Design

*   **Endpoint:** `/api/matrix-qa`
*   **Method:** `POST`
*   **Request Body (`MatrixQARequest`):**
    ```json
    {
      "messages": [
        { "role": "user", "content": "What are the general capital heavy fund raise trends?" },
        { "role": "assistant", "content": "Company X raised $12M [cell:uuid1]." },
        { "role": "user", "content": "What about in Canada?" }
      ],
      "sheetId": "sheet_uuid_abc",
      "conversationId": "conv_uuid_123" // Optional, generated if not provided
    }
    ```
*   **Success Response:**
    *   **Status Code:** `200 OK`
    *   **Headers:**
        *   `Content-Type: text/plain; charset=utf-8`
        *   `X-Metadata: application/json` (Contains stringified JSON below)
            ```json
            {
              "citations": [
                { "blockId": "cell_uuid_xyz", "contentSnippet": "Company: Company One" },
                { "blockId": "cell_uuid_pqr", "contentSnippet": "Total Raised: 12000000" }
              ],
              "conversationId": "conv_uuid_123",
              "steps": [
                "Analyzing table structure...",
                "Planning retrieval with schema awareness...",
                "Reasoning: Need to find maximum 'Total Raised' across all companies.",
                "Plan generated with 1 steps.",
                "Retrieving initial evidence...",
                "Retrieved 5 initial evidence pieces.",
                "Synthesizing answer..."
              ]
            }
            ```
    *   **Body:** A plain text stream representing the assistant's response chunks.
*   **Error Response:**
    *   **Status Code:** `400 Bad Request` (e.g., missing `sheetId`), `500 Internal Server Error`.
    *   **Body:** May contain an error message (potentially streamed or in metadata).

## AI System Design

*   **Reasoning (`ReasoningAgent`):**
    *   **Model:** OpenAI `gpt-4o` (chosen for strong reasoning and JSON mode support).
    *   **Prompt:** Includes system role definition, sheet context (ID, column names/descriptions, row count/IDs, schema info), conversation history, explicit instructions on available retrieval types (`semantic`, `keyword`, `specific`) and their usage (especially filter rules like `rowIds: ["*"]` for aggregations), emphasis on column understanding, and strict JSON output format (`{ "thoughts": [], "plan": [] }`). Zod schema validation is applied to the LLM output.
    *   **Input:** User query, sheet context object, conversation history.
    *   **Output:** `{ thoughts: string[], plan: RetrievalPlan[] }`.
*   **Retrieval (`RetrievalAgent`):**
    *   **Strategy:** Hybrid approach executing the `plan` from the Reasoning Agent.
        *   *Semantic:* Generates embeddings (`text-embedding-3-small`), queries Pinecone with vector + metadata filters (`sheetId`, `orgId`, potentially `columnIds` via `$or`/`isRowLevel`, `rowId`). Fetches full block data from Supabase based on Pinecone results.
        *   *Keyword:* Uses Supabase `ILIKE` queries via `BlockService.findBlocks` with filters.
        *   *Specific:* Uses Supabase primary key lookup via `BlockService.getBlock`.
    *   **Evidence Consolidation:** Groups retrieved `CellBlock`s by their `parent_id` (row ID). Formats the content for each row clearly, including column names, values, and crucially, the `[cell:ID]` marker for citation. Adds metadata (`isRowData`, `companyName`, etc.) to the `Evidence` object.
*   **Synthesis (Streaming via LangChain in `MatrixQAService`):**
    *   **Model:** `ChatOpenAI` configured with `gpt-4o` and `streaming: true`.
    *   **Prompt (`PromptTemplate`):** Instructs the LLM to act as an AI assistant analyzing tabular data, emphasizing reliance *only* on the provided `Evidence`. Explains the evidence format (row-based structure, `[cell:ID]` markers). Includes the formatted `Evidence` context, conversation history, and the user query.
    *   **Process:** Uses a `RunnableSequence` combining the prompt, the streaming LLM, and an output parser. The sequence is invoked with the query and evidence, and the output is piped through `LangChainStream` handlers to the frontend.
*   **Embeddings (`EmbeddingService` & Mock Data Script):**
    *   **Model:** OpenAI `text-embedding-3-small` (1024 dimensions).
    *   **Strategy (Mock Data):** Generates *contextual* embeddings:
        *   *Row-level:* Creates a descriptive text summary of the entire row (`generateRowText`), embeds it, and stores it in Pinecone with `id: row_<rowId>` and metadata `isRowLevel: true`.
        *   *Cell-level:* Creates descriptive text for each *individual cell* within the context of its row (`generateCellContextualText`), embeds it, and stores it in Pinecone with `id: <cellId>`.
    *   **Storage:** Pinecone index stores vectors with associated `PineconeMetadata` (blockId, rowId, sheetId, orgId, contentSnippet, columnName, etc.).

## Data Model

*   **Supabase (`blocks` table):**
    *   `id` (uuid, PK)
    *   `type` (enum: SHEET, ROW, COLUMN, CELL)
    *   `parent_id` (uuid, FK to blocks.id, nullable for SHEET)
    *   `organization_id` (string/uuid)
    *   `properties` (jsonb): Stores type-specific data (e.g., `{ "title": "..." }` for SHEET, `{ "value": "...", "column": { "id": "...", "name": "..." } }` for CELL).
    *   `content` (text, nullable): Potentially used for text blocks, currently null/unused for sheet components.
    *   Standard timestamp/audit fields (`created_at`, `updated_at`, `created_by`, `deleted_at`).
*   **Pinecone:**
    *   Stores vectors (1024 dimensions).
    *   Vector ID: `cell_uuid` or `row_uuid`.
    *   Metadata: `PineconeMetadata` interface (blockId, rowId, sheetId, orgId, contentSnippet, isRowLevel, columnName, companyName, country, fundingRound, columnIds).

## Key Technologies

*   **Framework:** Next.js 14+ (App Router)
*   **UI:** React 18+, Tailwind CSS
*   **AI/LLM:** OpenAI (GPT-4o, text-embedding-3-small), LangChain
*   **Streaming/Chat:** Vercel AI SDK (`ai/react`, `LangChainStream`)
*   **Database:** Supabase (PostgreSQL)
*   **Vector Database:** Pinecone
*   **Language:** TypeScript

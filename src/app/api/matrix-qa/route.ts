import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { MatrixQAService } from "@/lib/services/MatrixQAService";
import { MatrixQARequest } from "@/lib/types";

export async function POST(request: Request) {
  try {
   

    const body = (await request.json()) as MatrixQARequest;

    if (!body.query || !body.sheetId) {
      return new NextResponse("Missing query or sheetId", { status: 400 });
    }

    const qaService = new MatrixQAService();
    const response = await qaService.processQuery(body);

    return NextResponse.json(response);
  } catch (error: any) {
    console.error("[MATRIX_QA_POST]", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

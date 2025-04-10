"use client";
import { QAChatInterface } from "@/components/qa/QAChatInterface";
import Image from "next/image";

export default function Home() {
  return (
    <div className='grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]'>
      <h1>Raycaster Matrix Agent</h1>
      <QAChatInterface
        sheetId='db0de564-4d98-4351-8020-802d29bcde50'
        onCitationClick={() => {}}
      />
    </div>
  );
}

import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";
import { getSessionEmployee } from "@/lib/auth";
import { canEditAssignmentCatalog } from "@/lib/invariants";

const mono = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Профили должностей",
  description: "Справочник должностей и профилей программистов 1С",
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const themeBoot = `try{var t=localStorage.getItem('pp-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const employee = await getSessionEmployee();
  const catalog = employee ? canEditAssignmentCatalog(employee) : false;
  return (
    <html lang="ru" data-theme="dark" className={mono.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body className={mono.className}>
        <Header employee={employee} catalog={catalog} />
        <main className="mx-auto max-w-[1440px] px-5 py-8">{children}</main>
      </body>
    </html>
  );
}

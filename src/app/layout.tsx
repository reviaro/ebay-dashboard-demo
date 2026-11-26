import type { Metadata } from "next";
import Sidebar from "@/components/Sidebar";
import StoreProvider from "@/components/StoreProvider";
import { ThemeProvider } from "@/components/ThemeProvider";
import { DemoProvider } from "@/components/DemoProvider";
import DemoBanner from "@/components/DemoBanner";
import DemoRouteContent from "@/components/DemoRouteContent";
import { isDemoMode } from "@/lib/demo/server";
// Same families/weights as the original app, bundled by npm and served locally.
import "@fontsource/fira-sans/latin-300.css";
import "@fontsource/fira-sans/latin-400.css";
import "@fontsource/fira-sans/latin-500.css";
import "@fontsource/fira-sans/latin-600.css";
import "@fontsource/fira-sans/latin-700.css";
import "@fontsource/fira-code/latin-400.css";
import "@fontsource/fira-code/latin-500.css";
import "@fontsource/fira-code/latin-600.css";
import "@fontsource/fira-code/latin-700.css";
import "./globals.css";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return isDemoMode()
    ? { title: "Northstar Sample Parts | Read-only Demo", description: "Explore a fictional auto-parts store. Synthetic data, cached insights, and read-only dashboards as of September 30, 2026." }
    : { title: "eBay Auto Parts Dashboard", description: "AI-Powered Market Analysis and Store Management" };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const demo = isDemoMode();
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased bg-slate-950">
        <ThemeProvider>
          <DemoProvider demo={demo}>
            <StoreProvider>
              <div className="flex min-h-screen md:h-screen md:overflow-hidden">
                <Sidebar />
                <main id="main-content" className="flex-1 min-w-0 overflow-y-auto bg-slate-950 px-3 pb-6 pt-16 md:p-6">
                  {demo && <DemoBanner />}
                  {demo ? <DemoRouteContent>{children}</DemoRouteContent> : children}
                </main>
              </div>
            </StoreProvider>
          </DemoProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next"

import { WorkspaceProvider } from "@/components/WorkspaceProvider"

import "./globals.css"

export const metadata: Metadata = {
  title: "Finance Superbrain",
  description: "Operator-grade market intelligence workspace",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const apiUrl =
    process.env.API_URL ??
    process.env.INTERNAL_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:3001"

  return (
    <html lang="en" className="h-full">
      <head>
        <meta name="finance-superbrain-api-url" content={apiUrl} />
      </head>
      <body className="h-full">
        <WorkspaceProvider>{children}</WorkspaceProvider>
      </body>
    </html>
  )
}

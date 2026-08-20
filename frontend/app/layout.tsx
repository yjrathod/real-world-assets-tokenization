import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RWA | Tokenization Prototype",
  description: "A beginner-friendly real-world asset tokenization prototype.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

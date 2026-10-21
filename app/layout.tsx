import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShelfSense",
  description: "Taste-to-shelf book agent — turns the movies and music you love into a book on the shelf.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <a className="brand" href="/">
            ShelfSense
          </a>
          <a href="/">Find a book</a>
          <a href="/compare">A/B test</a>
          <a href="/owner">Owner</a>
          <a href="/provenance">Qloo log</a>
          <a href="/status">Status</a>
        </nav>
        {children}
      </body>
    </html>
  );
}

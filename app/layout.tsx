import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:1111";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;

  return {
    title: "Middle-earth — An Interactive Atlas",
    description: "Explore the realms, legends, and journeys of Middle-earth through an immersive interactive map.",
    icons: { icon: "/favicon.png", shortcut: "/favicon.png" },
    openGraph: {
      title: "Middle-earth — An Interactive Atlas",
      description: "Every path has a story. Choose where yours begins.",
      type: "website",
      images: [{ url: image, width: 1729, height: 910, alt: "Middle-earth — An Interactive Atlas" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Middle-earth — An Interactive Atlas",
      description: "Every path has a story. Choose where yours begins.",
      images: [image],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

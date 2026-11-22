import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Analytics } from "@vercel/analytics/next";
import { Fraunces, Geist } from "next/font/google";
import { clerkAppearance } from "@/components/auth/clerkAppearance";
import { FeedbackFloater } from "@/components/feedback/FeedbackFloater";
import { PRODUCT_NAME } from "@/components/landing/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["SOFT", "opsz"],
});

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: "Upload a paper or a book. Claude turns the questions in it into diagrams you can play with.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${fraunces.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <ClerkProvider appearance={clerkAppearance}>
          {children}
          <FeedbackFloater />
          <Analytics />
        </ClerkProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist, Inter, Plus_Jakarta_Sans, Source_Sans_3 } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
const geist = Geist({ subsets: ["latin"], display: "swap", variable: "--font-geist" });
const sourceSans = Source_Sans_3({ subsets: ["latin"], display: "swap", variable: "--font-source-sans" });
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], display: "swap", variable: "--font-plus-jakarta" });

export const metadata: Metadata = {
  title: {
    default: "Self-Service Kiosk Ordering and POS | PlaceURorder",
    template: "%s | PlaceURorder",
  },
  description: "Help guests order faster with PlaceURorder self-service kiosks, counter POS, kitchen displays, and real-time restaurant operations tools.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${geist.variable} ${sourceSans.variable} ${inter.variable} ${jakarta.variable}`}><body>{children}</body></html>;
}

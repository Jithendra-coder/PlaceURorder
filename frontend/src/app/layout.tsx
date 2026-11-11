import type { Metadata } from "next";
import { Geist, Inter, Plus_Jakarta_Sans, Source_Sans_3 } from "next/font/google";
import "./globals.css";
// Astryx styles load once, here, so every route paints with them from the first frame. Per-layout imports let a
// client-side navigation (for example landing to sign-in) paint before the stylesheet arrived.
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";
import "@astryxdesign/theme-neutral/fonts.css";

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

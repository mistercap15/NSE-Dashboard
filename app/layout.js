import "../styles/globals.css";
import { Providers } from "./providers";
import Footer from "./components/Footer";

export const metadata = {
  title: "NSE Ranking System",
  description: "Monthly F&O Stock Seasonality & Ranking Dashboard",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="scanlines">
        <Providers>{children}</Providers>
        <Footer />
      </body>
    </html>
  );
}

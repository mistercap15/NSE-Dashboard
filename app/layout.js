import "../styles/globals.css";

export const metadata = {
  title: "NSE Ranking System",
  description: "Monthly F&O Stock Seasonality & Ranking Dashboard",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="scanlines">{children}</body>
    </html>
  );
}

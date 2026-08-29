import "./globals.css";

export const metadata = {
  title: "漁光閃閃｜線上點餐",
  description: "漁光閃閃線上點餐系統"
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
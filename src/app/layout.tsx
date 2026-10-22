import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ChromaCut AI — Interval & Color Visual Prompt Video Editor',
  description:
    'Select a time interval, mark regions with colors on screen, and instruct AI to edit your video.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

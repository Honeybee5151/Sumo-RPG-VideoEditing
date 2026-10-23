import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sumo VideoEditor',
  description:
    'Sumo VideoEditor — Select a time interval, mark regions with colors on screen, and instruct AI to edit your video.',
  icons: {
    icon: '/sumo-icon.png',
    shortcut: '/sumo-icon.png',
    apple: '/sumo-icon.png',
  },
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

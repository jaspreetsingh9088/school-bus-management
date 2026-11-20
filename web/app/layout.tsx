import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'School Bus — Admin',
  description: 'School bus tracking and management',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

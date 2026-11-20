'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { APK_URL, clearSession, getToken, getUser, SessionUser, STATUS_LABEL, STATUS_TONE } from '@/lib/api';

export const Map = dynamic(() => import('./LeafletMap'), {
  ssr: false,
  loading: () => <div className="map" style={{ display: 'grid', placeItems: 'center', color: '#5f6b7a' }}>Loading map…</div>,
});

export function Pill({ status }: { status: string }) {
  return <span className={`pill ${STATUS_TONE[status] ?? 'muted'}`}>{STATUS_LABEL[status] ?? status}</span>;
}

const NAV: [string, [string, string, string][]][] = [
  ['Today', [['/dashboard/', '◉', 'Live view'], ['/trips/', '⇄', 'Trips']]],
  ['People', [['/students/', '☺', 'Students'], ['/parents/', '⌂', 'Parents'], ['/staff/', '☰', 'Drivers & staff']]],
  ['Setup', [['/routes/', '↝', 'Routes'], ['/stops/', '●', 'Stops'], ['/buses/', '▭', 'Buses'], ['/schools/', '▲', 'Schools']]],
];

/** Page frame with navigation. Sends anyone not logged in to /login. */
export function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    if (!getToken()) router.replace('/login/');
    else setUser(getUser());
  }, [router]);

  if (!user) return null;
  return (
    <div className="layout">
      <nav className="side">
        <div className="logo"><span>🚌</span> School Bus</div>
        {NAV.map(([section, items]) => (
          <div key={section} className="navgroup">
            <div className="navlabel">{section}</div>
            {items.map(([href, ico, label]) => (
              <Link key={href} href={href} className={path?.startsWith(href) || (href === '/routes/' && path?.startsWith('/route-detail')) || (href === '/trips/' && path?.startsWith('/trip/')) ? 'on' : ''}>
                <span className="ico">{ico}</span>{label}
              </Link>
            ))}
          </div>
        ))}
        <div className="grow" />
        <a className="apk" href={APK_URL}>Download Android app</a>
        <div className="who">
          {user.name}<br />{user.companyName}<br />
          <a href="#" onClick={(e) => { e.preventDefault(); clearSession(); router.replace('/login/'); }}>Log out</a>
        </div>
      </nav>
      <main>{children}</main>
    </div>
  );
}

export function ErrorNote({ error }: { error?: string | null }) {
  return error ? <div className="alert bad">{error}</div> : null;
}

/** Simple form state helper. */
export function useForm<T extends Record<string, string>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const bind = (key: keyof T) => ({
    value: values[key],
    onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value })),
  });
  return { values, setValues, bind, reset: () => setValues(initial) };
}

/** Drops empty strings so optional fields aren't sent. */
export function clean(obj: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v !== undefined && v !== null));
}

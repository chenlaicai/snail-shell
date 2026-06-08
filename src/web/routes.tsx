import type { RouteObject } from 'react-router-dom';
import { SkillPage } from './pages/SkillPage.js';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <h1>Home</h1> },
      { path: 'skills', element: <SkillPage /> },
    ],
  },
];

function Layout() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b p-4">
        <div className="flex gap-4">
          <a href="/" className="font-bold">Snail Shell</a>
          <a href="/skills">Skills</a>
        </div>
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

import { Outlet } from 'react-router-dom';
